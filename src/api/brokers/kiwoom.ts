import { Keychain, Credentials } from '../../platform/native';
import { BrokerAccount, BrokerProvider, NormalizedBalance, NormalizedTrade, Progress } from '../../domain/models';
import { AppError, DAY, Fmt, Obj, dict, fmtKST, list, num, parseKST, sleep, startOfDayKST, str, weekdayKST } from '../../utils';
import { http } from '../http';

/** 키움증권 REST API. Fill history is queried day by day (API hard limit ≈ 2 months). */
export class KiwoomProvider implements BrokerProvider {
  constructor(private account: BrokerAccount, private cred: Credentials) {}

  private get base() { return this.account.isPaper ? 'https://mockapi.kiwoom.com' : 'https://api.kiwoom.com'; }

  private async token(): Promise<string> {
    const cached = await Keychain.token(this.account.id);
    if (cached) return cached;
    const { json } = await http(this.base + '/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({ grant_type: 'client_credentials', appkey: this.cred.key, secretkey: this.cred.secret }),
    });
    const tok = str(json.token);
    if (!tok) throw new AppError(`키움 토큰 발급 실패: ${str(json.return_msg)}`);
    await Keychain.saveToken(this.account.id, tok, parseKST(str(json.expires_dt)) ?? Date.now() + 12 * 3600_000);
    return tok;
  }

  private async post(apiId: string, body: Obj, nextKey = ''): Promise<[Obj, string]> {
    const tok = await this.token();
    const { json, headers } = await http(this.base + '/api/dostk/acnt', {
      method: 'POST',
      headers: {
        'content-type': 'application/json;charset=UTF-8',
        authorization: `Bearer ${tok}`,
        'api-id': apiId,
        'cont-yn': nextKey ? 'Y' : 'N',
        'next-key': nextKey,
      },
      body: JSON.stringify(body),
    });
    const d = dict(json);
    const code = str(d.return_code);
    if (code && code !== '0') {
      if (str(d.return_msg).includes('token')) await Keychain.dropToken(this.account.id);
      throw new AppError(`키움 ${apiId}: ${str(d.return_msg)}`);
    }
    return [d, headers.get('cont-yn') === 'Y' ? headers.get('next-key') ?? '' : ''];
  }

  private code = (s: string) => (s.startsWith('A') ? s.slice(1) : s);

  async fetchBalance(): Promise<NormalizedBalance> {
    const out: NormalizedBalance = { holdings: [], cashKRW: 0 };
    let next = '';
    do {
      const [d, more] = await this.post('kt00018', { qry_tp: '1', dmst_stex_tp: 'KRX' }, next);
      for (const r of list(d.acnt_evlt_remn_indv_tot)) {
        if (num(r.rmnd_qty) <= 0) continue;
        out.holdings.push({
          ticker: this.code(str(r.stk_cd)), name: str(r.stk_nm), assetType: 'stock', market: 'krx',
          quantity: num(r.rmnd_qty), avgPrice: num(r.pur_pric), lastPrice: Math.abs(num(r.cur_prc)),
        });
      }
      next = more;
      if (next) await sleep(200);
    } while (next);

    await sleep(200);
    try {
      const [d] = await this.post('kt00001', { qry_tp: '3' });
      out.cashKRW = num(d.d2_entra) || num(d.entr);
    } catch {}
    return out;
  }

  async fetchTrades(from: number, to: number, progress: Progress): Promise<NormalizedTrade[]> {
    const result: NormalizedTrade[] = [];
    const start = startOfDayKST(Math.max(from, to - 60 * DAY));
    for (let day = startOfDayKST(to); day >= start; day -= DAY) {
      const wd = weekdayKST(day);
      if (wd === 0 || wd === 6) continue;
      const ymd = fmtKST(day, 'yyyyMMdd');
      progress(`${Fmt.date(day)} 체결 조회 중…`);
      let next = '';
      do {
        const [d, more] = await this.post('kt00009', {
          ord_dt: ymd, stk_bond_tp: '1', mrkt_tp: '0', sell_tp: '0',
          qry_tp: '1', stk_cd: '', fr_ord_no: '', dmst_stex_tp: '%',
        }, next);
        for (const r of list(d.acnt_ord_cntr_prst_array)) {
          const qty = num(r.cntr_qty);
          if (qty <= 0) continue;
          const kind = str(r.io_tp_nm) + str(r.trde_tp) + str(r.sell_tp);
          const time = (str(r.cntr_tm) || str(r.ord_tm)).replace(/\D/g, '').slice(0, 6);
          result.push({
            orderId: `kw-${ymd}-${str(r.ord_no)}`,
            ticker: this.code(str(r.stk_cd)), name: str(r.stk_nm), assetType: 'stock', market: 'krx',
            side: kind.includes('매도') ? 'sell' : 'buy',
            date: parseKST(ymd + time) ?? day,
            quantity: qty, price: Math.abs(num(r.cntr_uv)), fee: 0, tax: 0,
          });
        }
        next = more;
        await sleep(200);
      } while (next);
    }
    return result;
  }
}
