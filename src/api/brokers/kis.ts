import { Keychain, Credentials } from '../../platform/native';
import { BrokerAccount, BrokerProvider, NormalizedBalance, NormalizedTrade, Progress } from '../../domain/models';
import { AppError, DAY, Fmt, Obj, dict, fmtKST, list, num, parseKST, sleep, str } from '../../utils';
import { http, url } from '../http';

/** 한국투자증권 Open API (domestic + overseas balance / fills). */
export class KISProvider implements BrokerProvider {
  constructor(private account: BrokerAccount, private cred: Credentials) {}

  private get base() {
    return this.account.isPaper ? 'https://openapivts.koreainvestment.com:29443' : 'https://openapi.koreainvestment.com:9443';
  }
  private get digits() { return this.account.accountNumber.replace(/\D/g, ''); }
  private get cano() { return this.digits.slice(0, 8); }
  private get prdt() { return this.digits.length >= 10 ? this.digits.slice(-2) : '01'; }
  /** Paper-trading TR IDs swap the leading letter for "V". */
  private tr(real: string) { return this.account.isPaper ? 'V' + real.slice(1) : real; }

  private async token(): Promise<string> {
    const cached = await Keychain.token(this.account.id);
    if (cached) return cached;
    const { json } = await http(this.base + '/oauth2/tokenP', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', appkey: this.cred.key, appsecret: this.cred.secret }),
    });
    const tok = str(json.access_token);
    if (!tok) throw new AppError(`KIS 토큰 발급 실패: ${str(json.error_description)}`);
    const exp = parseKST(str(json.access_token_token_expired)) ?? Date.now() + 20 * 3600_000;
    await Keychain.saveToken(this.account.id, tok, exp);
    return tok;
  }

  private async get(path: string, trId: string, params: [string, string][], cont = ''): Promise<[Obj, string]> {
    const tok = await this.token();
    const { json, headers } = await http(url(this.base, path, params), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Bearer ${tok}`,
        appkey: this.cred.key,
        appsecret: this.cred.secret,
        tr_id: trId,
        tr_cont: cont,
        custtype: 'P',
      },
    });
    const d = dict(json);
    if (str(d.rt_cd) !== '0') {
      if (str(d.msg_cd) === 'EGW00123') await Keychain.dropToken(this.account.id); // expired token
      throw new AppError(`KIS: ${str(d.msg1)} (${str(d.msg_cd)})`);
    }
    return [d, headers.get('tr_cont') ?? ''];
  }

  /** Follows tr_cont pagination; `ctx` names the continuation keys (100 for domestic, 200 for overseas). */
  private async paginate(path: string, trId: string, params: [string, string][], ctx: '100' | '200', each: (d: Obj) => void) {
    let fk = '', nk = '', cont = '';
    for (;;) {
      const [d, next] = await this.get(path, trId, [...params, [`CTX_AREA_FK${ctx}`, fk], [`CTX_AREA_NK${ctx}`, nk]], cont);
      each(d);
      fk = str(d[`ctx_area_fk${ctx}`]);
      nk = str(d[`ctx_area_nk${ctx}`]);
      if (next !== 'F' && next !== 'M') break;
      cont = 'N';
      await sleep(300);
    }
  }

  async fetchBalance(): Promise<NormalizedBalance> {
    if (this.cano.length !== 8) throw new AppError('계좌번호 (8자리)를 확인해 주세요.');
    const out: NormalizedBalance = { holdings: [], cashKRW: 0 };
    await this.paginate('/uapi/domestic-stock/v1/trading/inquire-balance', this.tr('TTTC8434R'), [
      ['CANO', this.cano], ['ACNT_PRDT_CD', this.prdt], ['AFHR_FLPR_YN', 'N'], ['OFL_YN', ''],
      ['INQR_DVSN', '02'], ['UNPR_DVSN', '01'], ['FUND_STTL_ICLD_YN', 'N'],
      ['FNCG_AMT_AUTO_RDPT_YN', 'N'], ['PRCS_DVSN', '00'],
    ], '100', d => {
      for (const r of list(d.output1)) {
        if (num(r.hldg_qty) <= 0) continue;
        out.holdings.push({
          ticker: str(r.pdno), name: str(r.prdt_name), assetType: 'stock', market: 'krx',
          quantity: num(r.hldg_qty), avgPrice: num(r.pchs_avg_pric), lastPrice: num(r.prpr),
        });
      }
      const o2 = list(d.output2)[0];
      if (o2) out.cashKRW = num(o2.prvs_rcdl_excc_amt); // D+2 예수금
    });

    // Overseas (US) — accounts without overseas trading return an error; ignore it.
    try {
      await this.paginate('/uapi/overseas-stock/v1/trading/inquire-balance', this.tr('TTTS3012R'), [
        ['CANO', this.cano], ['ACNT_PRDT_CD', this.prdt], ['OVRS_EXCG_CD', 'NASD'], ['TR_CRCY_CD', 'USD'],
      ], '200', d => {
        for (const r of list(d.output1)) {
          if (num(r.ovrs_cblc_qty) <= 0) continue;
          out.holdings.push({
            ticker: str(r.ovrs_pdno), name: str(r.ovrs_item_name), assetType: 'stock', market: 'us',
            quantity: num(r.ovrs_cblc_qty), avgPrice: num(r.pchs_avg_pric), lastPrice: num(r.now_pric2),
          });
        }
      });
    } catch (e) {
      console.log('KIS overseas balance skipped', e);
    }
    return out;
  }

  /** 3-month sliding windows, newest → oldest. */
  async fetchTrades(from: number, to: number, progress: Progress): Promise<NormalizedTrade[]> {
    const result: NormalizedTrade[] = [];
    const recentBoundary = Date.now() - 90 * DAY;
    let end = to;
    let idx = 1;
    while (end > from) {
      const start = Math.max(from, end - 89 * DAY);
      progress(`구간 ${idx} 조회 중… (${Fmt.date(start)}~${Fmt.date(end)})`);
      await this.paginate('/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
        this.tr(start >= recentBoundary ? 'TTTC0081R' : 'CTSC9215R'), [
          ['CANO', this.cano], ['ACNT_PRDT_CD', this.prdt],
          ['INQR_STRT_DT', fmtKST(start, 'yyyyMMdd')], ['INQR_END_DT', fmtKST(end, 'yyyyMMdd')],
          ['SLL_BUY_DVSN_CD', '00'], ['INQR_DVSN', '00'], ['PDNO', ''], ['CCLD_DVSN', '01'],
          ['ORD_GNO_BRNO', ''], ['ODNO', ''], ['INQR_DVSN_3', '00'], ['INQR_DVSN_1', ''], ['EXCG_ID_DVSN_CD', 'KRX'],
        ], '100', d => {
          for (const r of list(d.output1)) {
            const qty = num(r.tot_ccld_qty);
            if (qty <= 0) continue;
            const amt = num(r.tot_ccld_amt);
            result.push({
              orderId: `kis-${str(r.ord_dt)}-${str(r.odno)}`,
              ticker: str(r.pdno), name: str(r.prdt_name), assetType: 'stock', market: 'krx',
              side: str(r.sll_buy_dvsn_cd) === '01' ? 'sell' : 'buy',
              date: parseKST(str(r.ord_dt) + str(r.ord_tmd)) ?? end,
              quantity: qty, price: amt > 0 ? amt / qty : num(r.avg_prvs), fee: 0, tax: 0,
            });
          }
        });
      end = start - DAY;
      idx++;
      await sleep(300);
    }

    // Overseas fills
    try {
      let end2 = to;
      while (end2 > from) {
        const start = Math.max(from, end2 - 89 * DAY);
        progress(`해외 체결 조회 중… (${Fmt.date(start)}~${Fmt.date(end2)})`);
        await this.paginate('/uapi/overseas-stock/v1/trading/inquire-ccnl', this.tr('TTTS3035R'), [
          ['CANO', this.cano], ['ACNT_PRDT_CD', this.prdt], ['PDNO', '%'],
          ['ORD_STRT_DT', fmtKST(start, 'yyyyMMdd')], ['ORD_END_DT', fmtKST(end2, 'yyyyMMdd')],
          ['SLL_BUY_DVSN', '00'], ['CCLD_NCCS_DVSN', '01'], ['OVRS_EXCG_CD', '%'],
          ['SORT_SQN', 'DS'], ['ORD_DT', ''], ['ORD_GNO_BRNO', ''], ['ODNO', ''],
        ], '200', d => {
          for (const r of list(d.output)) {
            if (num(r.ft_ccld_qty) <= 0) continue;
            result.push({
              orderId: `kiso-${str(r.ord_dt)}-${str(r.odno)}`,
              ticker: str(r.pdno), name: str(r.prdt_name), assetType: 'stock', market: 'us',
              side: str(r.sll_buy_dvsn_cd) === '01' ? 'sell' : 'buy',
              date: parseKST(str(r.ord_dt) + str(r.ord_tmd)) ?? end2,
              quantity: num(r.ft_ccld_qty), price: num(r.ft_ccld_unpr3), fee: 0, tax: 0,
            });
          }
        });
        end2 = start - DAY;
        await sleep(300);
      }
    } catch (e) {
      console.log('KIS overseas trades skipped', e);
    }
    return result;
  }
}
