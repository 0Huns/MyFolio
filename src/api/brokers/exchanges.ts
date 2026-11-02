import { Credentials, Native } from '../../platform/native';
import { BrokerProvider, NormalizedBalance, NormalizedTrade, Progress } from '../../domain/models';
import { Prices } from '../prices';
import { AppError, DAY, Fmt, Obj, dict, isoUTC, list, num, parseISO, sleep, str, uuid } from '../../utils';
import { http } from '../http';
import { jwtHS256 } from '../jwt';

/** Upbit and Bithumb (v1 API) share JWT auth and response shapes. */
export class UpbitStyleProvider implements BrokerProvider {
  constructor(private kind: 'upbit' | 'bithumb', private cred: Credentials) {}

  private get base() { return this.kind === 'upbit' ? 'https://api.upbit.com' : 'https://api.bithumb.com'; }
  private get label() { return this.kind === 'upbit' ? '업비트' : '빗썸'; }

  /** `query` is the raw (unencoded) query string; its SHA512 goes into the JWT. */
  private async get(path: string, query = ''): Promise<any> {
    const payload: Obj = { access_key: this.cred.key, nonce: uuid() };
    if (this.kind === 'bithumb') payload.timestamp = Date.now();
    if (query) {
      payload.query_hash = await Native.sha512Hex(query);
      payload.query_hash_alg = 'SHA512';
    }
    const jwt = await jwtHS256(payload, this.cred.secret);
    const encoded = query.replace(/\[\]/g, '%5B%5D').replace(/:/g, '%3A');
    const { json } = await http(this.base + path + (query ? '?' + encoded : ''), { headers: { Authorization: `Bearer ${jwt}` } });
    const e = dict(dict(json).error);
    if (Object.keys(e).length) throw new AppError(`${this.label}: ${str(e.message)} (${str(e.name)})`);
    return json;
  }

  async fetchBalance(): Promise<NormalizedBalance> {
    const out: NormalizedBalance = { holdings: [], cashKRW: 0 };
    for (const r of list(await this.get('/v1/accounts'))) {
      const cur = str(r.currency).toUpperCase();
      const qty = num(r.balance) + num(r.locked);
      if (cur === 'KRW') { out.cashKRW = qty; continue; }
      const unit = str(r.unit_currency).toUpperCase();
      if (qty <= 0 || (unit && unit !== 'KRW')) continue;
      out.holdings.push({ ticker: cur, name: cur, assetType: 'crypto', market: 'crypto', quantity: qty, avgPrice: num(r.avg_buy_price), lastPrice: 0 });
    }
    // Fill current prices so valuation/sorting works before the live price loop runs.
    const tickers = out.holdings.map(h => h.ticker);
    const prices = this.kind === 'upbit' ? await Prices.upbit(tickers) : await Prices.bithumb(tickers);
    out.holdings.forEach(h => (h.lastPrice = prices[h.ticker] ?? 0));
    out.holdings = out.holdings.filter(h => h.lastPrice > 0 || h.avgPrice > 0); // drop worthless dust
    return out;
  }

  async fetchTrades(from: number, to: number, progress: Progress): Promise<NormalizedTrade[]> {
    const orders: Obj[] = [];
    if (this.kind === 'upbit') {
      // closed-orders allows at most a 7-day window; walk oldest → newest
      let idx = 1;
      for (let start = from; start < to; start += 7 * DAY, idx++) {
        const end = Math.min(to, start + 7 * DAY);
        progress(`구간 ${idx} 조회 중… (${Fmt.date(start)}~${Fmt.date(end)})`);
        orders.push(...list(await this.get('/v1/orders/closed',
          `states[]=done&states[]=cancel&start_time=${isoUTC(start)}&end_time=${isoUTC(end)}&limit=1000&order_by=asc`)));
        await sleep(200);
      }
    } else {
      for (let page = 1; ; page++) {
        progress(`페이지 ${page} 조회 중…`);
        const rows = list(await this.get('/v1/orders', `state=done&page=${page}&limit=100&order_by=desc`));
        orders.push(...rows);
        const times = rows.map(r => parseISO(str(r.created_at)) ?? 0);
        if (rows.length < 100 || Math.min(...times) < from) break;
        await sleep(200);
      }
    }

    const result: NormalizedTrade[] = [];
    const executed = orders.filter(o => num(o.executed_volume) > 0 && str(o.market).startsWith('KRW-'));
    for (let i = 0; i < executed.length; i++) {
      const o = executed[i];
      const date = parseISO(str(o.created_at));
      if (!date || date < from) continue;
      const vol = num(o.executed_volume);
      let funds = num(o.executed_funds);
      if (!funds) {
        if (str(o.ord_type) === 'limit') funds = num(o.price) * vol;
        else {
          // Market orders carry no fill price → read the order detail.
          if (i % 5 === 0) progress(`체결 상세 조회 중… (${i + 1}/${executed.length})`);
          try {
            const detail = dict(await this.get('/v1/order', `uuid=${str(o.uuid)}`));
            funds = list(detail.trades).reduce((s, t) => s + num(t.funds), 0);
          } catch {}
          await sleep(120);
        }
      }
      const ticker = str(o.market).slice(4);
      result.push({
        orderId: str(o.uuid), ticker, name: ticker, assetType: 'crypto', market: 'crypto',
        side: str(o.side) === 'ask' ? 'sell' : 'buy', date,
        quantity: vol, price: funds > 0 ? funds / vol : num(o.price), fee: num(o.paid_fee), tax: 0,
      });
    }
    return result;
  }
}

/** 코인원 v2.1 private API. */
export class CoinoneProvider implements BrokerProvider {
  private base = 'https://api.coinone.co.kr';
  constructor(private cred: Credentials) {}

  private async post(path: string, extra: Obj = {}): Promise<Obj> {
    const json = JSON.stringify({ ...extra, access_token: this.cred.key, nonce: uuid() });
    const payload = await Native.base64(json);
    const { json: res } = await http(this.base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-COINONE-PAYLOAD': payload,
        'X-COINONE-SIGNATURE': await Native.hmacHex('sha512', this.cred.secret, payload),
      },
      body: json,
    });
    const d = dict(res);
    if (str(d.result) !== 'success') throw new AppError(`코인원 오류 (${str(d.error_code)})`);
    return d;
  }

  async fetchBalance(): Promise<NormalizedBalance> {
    const out: NormalizedBalance = { holdings: [], cashKRW: 0 };
    for (const r of list((await this.post('/v2.1/account/balance/all')).balances)) {
      const cur = str(r.currency).toUpperCase();
      const qty = num(r.available) + num(r.limit);
      if (cur === 'KRW') { out.cashKRW = qty; continue; }
      if (qty <= 0) continue;
      out.holdings.push({ ticker: cur, name: cur, assetType: 'crypto', market: 'crypto', quantity: qty, avgPrice: num(r.average_price), lastPrice: 0 });
    }
    const prices = await Prices.coinone();
    out.holdings.forEach(h => (h.lastPrice = prices[h.ticker] ?? 0));
    out.holdings = out.holdings.filter(h => h.lastPrice > 0 || h.avgPrice > 0);
    return out;
  }

  async fetchTrades(from: number, to: number, progress: Progress): Promise<NormalizedTrade[]> {
    const result: NormalizedTrade[] = [];
    for (let start = from; start < to; start += 30 * DAY) {
      const end = Math.min(to, start + 30 * DAY);
      progress(`${Fmt.date(start)}~${Fmt.date(end)} 조회 중…`);
      let toTs = end;
      for (;;) {
        const rows = list((await this.post('/v2.1/order/completed_orders/all', { size: 100, from_ts: start, to_ts: toTs })).completed_orders);
        for (const r of rows) {
          if (str(r.quote_currency).toUpperCase() !== 'KRW') continue;
          const price = num(r.price), fee = num(r.fee);
          const ticker = str(r.target_currency).toUpperCase();
          result.push({
            orderId: `co-${str(r.trade_id)}`, ticker, name: ticker, assetType: 'crypto', market: 'crypto',
            side: r.is_ask ? 'sell' : 'buy', date: num(r.timestamp), quantity: num(r.qty), price,
            fee: str(r.fee_currency).toUpperCase() === 'KRW' ? fee : fee * price, tax: 0,
          });
        }
        const minTs = Math.min(...rows.map(r => num(r.timestamp)));
        if (rows.length < 100 || minTs <= start) break;
        toTs = minTs - 1;
        await sleep(200);
      }
      await sleep(200);
    }
    return result;
  }
}
