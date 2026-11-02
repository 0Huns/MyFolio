import { Keychain, Credentials, Native } from '../../platform/native';
import { Candle, BrokerAccount, BrokerProvider, Market, Holding, NormalizedBalance, NormalizedTrade, Progress } from '../../domain/models';
import { usSessionStart, usTradeDay } from '../../domain/marketTime';
import { AppError, Obj, dict, fmtKST, HttpError, num, parseISO, sleep, str } from '../../utils';
import { url } from '../http';

import { tossRequest, waitForTossStream } from './tossRequests';

type ClientSession = { issuing?: Promise<string>; token?: string; expires?: number; rejected?: string; requests: Map<string, Promise<Obj>> };
const sessions = new Map<string, ClientSession>();

/** 토스증권 Open API (OAuth2 client credentials, accountSeq auto-discovered). */
export class TossProvider implements BrokerProvider {
  private base = 'https://openapi.tossinvest.com';
  private accountSeq?: string;

  private session: ClientSession;
  constructor(private account: BrokerAccount, private cred: Credentials) {
    const id = JSON.stringify([cred.key, cred.secret]);
    let session = sessions.get(id);
    if (!session) { session = { requests: new Map() }; sessions.set(id, session); }
    this.session = session;
  }

  /** Responses come either bare or wrapped as `{ result: ... }` / `{ error: {...} }`. */
  private unwrap(obj: unknown): Obj {
    const d = dict(obj);
    if (Array.isArray(d.result)) return { items: d.result };
    if (d.result && typeof d.result === 'object') return d.result;
    return d;
  }

  private items(d: Obj, keys: string[]): Obj[] {
    for (const k of keys) if (Array.isArray(d[k])) return d[k];
    return [];
  }

  async token(): Promise<string> {
    const session = this.session;
    if (session.issuing) return session.issuing;
    const task = (async () => {
      const cached = session.token && (session.expires ?? 0) > Date.now() + 60_000
        ? session.token : await Keychain.token(this.account.id);
      if (session.rejected && (!cached || session.rejected === cached)) {
        throw new AppError('토스: token-revoked — 다른 기기에서 새 토큰을 발급했습니다. 같은 API 클라이언트의 최신 토큰을 공유해야 합니다. 자동 재발급은 중단했습니다.');
      }
      if (cached) return cached;
      const basic = await Native.base64(`${this.cred.key}:${this.cred.secret}`);
      const { json } = await tossRequest(this.cred.key, '/oauth2/token', this.base + '/oauth2/token', {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      });
      const d = this.unwrap(json);
      const tok = str(d.access_token ?? d.accessToken);
      if (!tok) throw new AppError('토스 토큰 발급 실패');
      const expires = Date.now() + (num(d.expires_in ?? d.expiresIn) || 3600) * 1000;
      await Keychain.saveToken(this.account.id, tok, expires);
      session.token = tok;
      session.expires = expires;
      session.rejected = undefined;
      return tok;
    })();
    session.issuing = task;
    try { return await task; } finally { if (session.issuing === task) session.issuing = undefined; }
  }

  private get(path: string, params: [string, string][] = [], withAccount = true): Promise<Obj> {
    const target = url(this.base, path, params);
    const key = `${withAccount ? this.account.id : ''}:${target}`;
    const running = this.session.requests.get(key);
    if (running) return running;
    const task = this.request(path, target, withAccount);
    this.session.requests.set(key, task);
    void task.then(() => this.session.requests.delete(key), () => this.session.requests.delete(key));
    return task;
  }

  private async request(path: string, target: string, withAccount: boolean): Promise<Obj> {
    const accountSeq = withAccount ? await this.seq() : undefined;
    for (let attempt = 0; ; attempt++) {
      const token = await this.token();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (accountSeq) headers['X-Tossinvest-Account'] = accountSeq;
      try {
        const { json } = await tossRequest(this.cred.key, path, target, { headers });
        const e = dict(dict(json).error);
        if (Object.keys(e).length) throw new AppError(`토스: ${str(e.message)} (${str(e.code)})`);
        return this.unwrap(json);
      } catch (e) {
        if (e instanceof HttpError && e.code === 'token-revoked') {
          this.session.rejected = token;
          throw new AppError('토스: token-revoked — 다른 기기에서 인증이 갱신됐습니다. 맥·아이폰이 같은 최신 토큰을 공유해야 하므로 자동 재발급하지 않습니다.');
        }
        // Renew only an expired token, once. Revoked/invalid credentials must not trigger a device-to-device loop.
        if (e instanceof HttpError && e.code === 'expired-token' && attempt === 0) {
          if (!this.session.token || this.session.token === token) {
            this.session.token = undefined;
            await Keychain.dropToken(this.account.id);
          }
          continue;
        }
        throw e;
      }
    }
  }

  reserveStream() { return waitForTossStream(this.cred.key); }

  private async seq(): Promise<string> {
    if (this.accountSeq) return this.accountSeq;
    const d = await this.get('/api/v1/accounts', [], false);
    const list = this.items(d, ['items', 'accounts']);
    // Pension / overseas-derivatives accounts can come first — prefer the regular brokerage account.
    const first = list.find(a => str(a.accountType) === 'BROKERAGE') ?? list[0];
    if (!first) throw new AppError('토스: 조회 가능한 계좌가 없습니다.');
    this.accountSeq = str(first.accountSeq);
    return this.accountSeq;
  }

  // MARK: market data (no account header needed)

  /** Last prices for KRX codes / US tickers, keyed by symbol. */
  async prices(symbols: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (let i = 0; i < symbols.length; i += 200) {
      const d = await this.get('/api/v1/prices', [['symbols', symbols.slice(i, i + 200).join(',')]], false);
      for (const r of this.items(d, ['items', 'prices'])) if (num(r.lastPrice) > 0) out[str(r.symbol)] = num(r.lastPrice);
    }
    return out;
  }

  async usdKrw(): Promise<number> {
    const d = await this.get('/api/v1/exchange-rate', [['baseCurrency', 'USD'], ['quoteCurrency', 'KRW']], false);
    // Intraday reference rate. Do not use for Toss daily-fixing valuation or historical P&L.
    const rate = Number(d.midRate);
    if (!(rate > 0) || !Number.isFinite(rate)) throw new AppError('토스 매매기준율 응답이 올바르지 않습니다.');
    return rate;
  }

  /** OHLC candles, oldest first; pages back (200 per call) until `count` candles, optionally only bars before `beforeMs`. */
  async candles(symbol: string, interval: '1m' | '1d', count: number, beforeMs?: number, signal?: AbortSignal): Promise<Candle[]> {
    const out: Candle[] = [];
    // Internal intraday candles use start timestamps; Toss's cursor and rows use end timestamps.
    const offset = interval === '1m' ? 60_000 : 0;
    let before = beforeMs ? new Date(beforeMs + offset - 1).toISOString() : '';
    while (out.length < count) {
      if (signal?.aborted) return [];
      const q: [string, string][] = [['symbol', symbol], ['interval', interval], ['count', String(Math.min(200, count - out.length))], ['adjusted', 'true']];
      if (before) q.push(['before', before]);
      const d = await this.get('/api/v1/candles', q, false);
      if (signal?.aborted) return [];
      const rows = this.items(d, ['candles', 'items']);
      for (const r of rows) {
        const t = parseISO(str(r.timestamp));
        const c = num(r.closePrice);
        if (t && c > 0) out.push({ t: t - offset, o: num(r.openPrice) || c, h: num(r.highPrice) || c, l: num(r.lowPrice) || c, c });
      }
      before = str(d.nextBefore);
      if (!rows.length || !before) break;
      await sleep(150);
    }
    return [...new Map(out.map(c => [c.t, c])).values()].sort((a, b) => a.t - b.t);
  }

  async dailyCloses(symbol: string, days: number): Promise<{ date: number; close: number }[]> {
    return (await this.candles(symbol, '1d', days)).map(c => ({ date: c.t, close: c.c }));
  }

  private baseCache: Record<string, { start: number; base: number }> = {};

  /**
   * Toss's base price for today's change of US stocks: the official regular close (Toss daily candle) of the last
   * trading day before the current one (NY 20:00 → 20:00; weekends → Friday's). During the day market the current
   * day has no candle yet, so "the candle before the latest" would reach a day too far back.
   */
  async usBasePrices(symbols: string[], now = Date.now()): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    const start = usSessionStart(now);
    const day = usTradeDay(start);
    for (const sym of symbols) {
      const c = this.baseCache[sym];
      if (c?.start === start) { out[sym] = c.base; continue; }
      try {
        // 1d candle timestamps are the trading day's NY midnight, so usTradeDay maps them to their own date.
        const bars = (await this.candles(sym, '1d', 5)).filter(b => usTradeDay(b.t) < day);
        const base = bars[bars.length - 1]?.c ?? 0;
        if (base > 0) { this.baseCache[sym] = { start, base }; out[sym] = base; }
      } catch {}
      await sleep(100);
    }
    return out;
  }

  private prevCache: Record<string, { at: number; prev: number }> = {};

  /**
   * Previous session's close per symbol (the candle before the latest one), for today's change.
   * Changes once a day, so cache for 10 minutes instead of fetching candles on every price refresh.
   */
  async prevCloses(symbols: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const sym of symbols) {
      const c = this.prevCache[sym];
      if (c && Date.now() - c.at < 10 * 60_000) { out[sym] = c.prev; continue; }
      try {
        const closes = await this.dailyCloses(sym, 2);
        if (closes.length >= 2) {
          this.prevCache[sym] = { at: Date.now(), prev: closes[closes.length - 2].close };
          out[sym] = this.prevCache[sym].prev;
        }
      } catch {}
      await sleep(100);
    }
    return out;
  }

  private market(symbol: string, country = '', exchange = ''): Market {
    const ex = exchange.toUpperCase();
    if (['KOSPI', 'KOSDAQ', 'KONEX'].includes(ex) || ex.startsWith('KR') || country.toUpperCase() === 'KR') return 'krx';
    if (country || exchange) return 'us';
    return /^\d+$/.test(symbol) ? 'krx' : 'us';
  }

  async fetchBalance(): Promise<NormalizedBalance> {
    const d = await this.get('/api/v1/holdings');
    // This API exposes cash buying power, not total deposits. Keep each currency separately.
    // Fail the balance update if either request fails, preserving the previous successful balance.
    const krw = await this.get('/api/v1/buying-power', [['currency', 'KRW']]);
    const usd = await this.get('/api/v1/buying-power', [['currency', 'USD']]);
    for (const balance of [krw, usd]) {
      if (balance.cashBuyingPower == null || !Number.isFinite(Number(balance.cashBuyingPower))) {
        throw new AppError('토스: 현금 매수가능금액 응답이 누락되었어요. 이전 잔액을 유지합니다.');
      }
    }
    const money = (raw: unknown, label: string, nullable = false) => {
      if (nullable && raw === null) return 0;
      if (raw == null || String(raw).trim() === '' || !Number.isFinite(Number(raw))) throw new AppError(`토스: ${label} 누락. 이전 잔고를 유지합니다.`);
      return Number(raw);
    };
    const pair = (raw: unknown, label: string) => {
      const value = dict(raw);
      return { krw: money(value.krw, label), usd: money(value.usd, label, true) };
    };
    const at = Date.now();
    const schedules: Record<string, Holding['valuationCommission']> = {};
    // Optional account-specific rate: a failure must not discard the official balance.
    try {
      const response = await this.get('/api/v1/commissions');
      const day = fmtKST(at, 'yyyy-MM-dd');
      for (const r of this.items(response, ['items'])) {
        const rate = Number(r.commissionRate);
        const startDate = r.startDate == null ? undefined : str(r.startDate);
        const endDate = r.endDate == null ? undefined : str(r.endDate);
        if (r.commissionRate == null || String(r.commissionRate).trim() === '' || !Number.isFinite(rate) || rate < 0 || rate >= 1) continue;
        if ([startDate, endDate].some(date => date != null && !/^\d{4}-\d{2}-\d{2}$/.test(date))) continue;
        if ((startDate && startDate > day) || (endDate && endDate < day)) continue;
        if (r.marketCountry === 'KR' || r.marketCountry === 'US') schedules[r.marketCountry] = { rate, startDate, endDate };
      }
    } catch { /* Keep snapshot costs fixed when the applicable commission rate is unknown. */ }
    const out: NormalizedBalance = {
      holdings: [], cashKRW: num(krw.cashBuyingPower), cashUSD: num(usd.cashBuyingPower),
      valuation: {
        value: pair(dict(d.marketValue).amountAfterCost, '합산 평가금액'),
        purchase: pair(d.totalPurchaseAmount, '합산 투자원금'),
        profit: pair(dict(d.profitLoss).amountAfterCost, '합산 평가손익'), at,
      },
    };
    for (const r of this.items(d, ['items', 'holdings'])) {
      if (num(r.quantity) <= 0) continue;
      const sym = str(r.symbol);
      const rawNet = dict(r.marketValue).amountAfterCost;
      if (rawNet == null || String(rawNet).trim() === '' || !Number.isFinite(Number(rawNet))) {
        throw new AppError(`토스: ${sym}의 수수료·세금 공제 후 평가금액이 누락되었습니다. 이전 잔고를 유지합니다.`);
      }
      out.holdings.push({
        ticker: sym, name: str(r.name) || sym, assetType: 'stock', market: this.market(sym, str(r.marketCountry)),
        quantity: num(r.quantity), avgPrice: num(r.averagePurchasePrice), lastPrice: num(r.lastPrice),
        amountAfterCost: Number(rawNet), valuationAt: at,
        valuationCommission: schedules[str(r.marketCountry)],
        brokerCost: r.cost == null ? undefined : {
          commission: money(dict(r.cost).commission, '수수료'),
          tax: dict(r.cost).tax == null ? 0 : money(dict(r.cost).tax, '세금'),
        },
        purchaseAmount: money(dict(r.marketValue).purchaseAmount, '종목 매입금액'),
        profitAfterCost: money(dict(r.profitLoss).amountAfterCost, '종목 평가손익'),
      });
    }
    return out;
  }

  async fetchTrades(from: number, to: number, progress: Progress): Promise<NormalizedTrade[]> {
    const orders: Obj[] = [];
    let cursor = '';
    do {
      progress(`주문 ${orders.length}건 조회 중…`);
      const q: [string, string][] = [['status', 'CLOSED'], ['from', fmtKST(from)], ['to', fmtKST(to)], ['limit', '100']];
      if (cursor) q.push(['cursor', cursor]);
      const d = await this.get('/api/v1/orders', q);
      orders.push(...this.items(d, ['orders', 'items']));
      cursor = d.hasNext ? str(d.nextCursor) : '';
      await sleep(200);
    } while (cursor);

    // Keep every order with fills: CANCELED / REJECTED / REPLACED orders can be partially filled (per the spec, check
    // execution.filledQuantity). *_REJECTED rows are separate records of a refused cancel/modify; the original order
    // keeps its fills, so skip them to avoid counting the same execution twice.
    const filled = orders.filter(o => {
      const s = str(o.status).toUpperCase();
      return s !== 'CANCEL_REJECTED' && s !== 'REPLACE_REJECTED' && num(dict(o.execution).filledQuantity) > 0;
    });
    progress(`${filled.length}건 처리 중…`);

    // Orders carry no name/exchange → enrich via the stock master in chunks of 200.
    const info: Record<string, Obj> = {};
    const symbols = [...new Set(filled.map(o => str(o.symbol)))];
    for (let i = 0; i < symbols.length; i += 200) {
      try {
        const d = await this.get('/api/v1/stocks', [['symbols', symbols.slice(i, i + 200).join(',')]]);
        for (const s of this.items(d, ['items', 'stocks'])) info[str(s.symbol)] = s;
      } catch {}
      await sleep(200);
    }

    return filled.map(o => {
      const e = dict(o.execution);
      const sym = str(o.symbol);
      const s = info[sym] ?? {};
      const qty = num(e.filledQuantity);
      const avg = num(e.averageFilledPrice);
      return {
        orderId: str(o.orderId), ticker: sym, name: str(s.name) || str(s.englishName) || sym,
        assetType: 'stock', market: this.market(sym, '', str(s.market)),
        side: str(o.side).toUpperCase().startsWith('S') ? 'sell' : 'buy',
        date: parseISO(str(e.filledAt)) ?? parseISO(str(o.orderedAt)) ?? Date.now(),
        quantity: qty, price: avg > 0 ? avg : qty > 0 ? num(e.filledAmount) / qty : 0,
        fee: num(e.commission), tax: num(e.tax),
      } as NormalizedTrade;
    });
  }
}

export type StreamStatus = 'live' | 'waiting' | 'connecting' | 'failed';

/**
 * Realtime trades for a set of symbols over Toss's websocket (wss://openapi-ws.tossinvest.com/ws/v1).
 * Declares grouped trade subscriptions, pings every 60 s (server drops clients silent for 180 s),
 * and reconnects with exponential backoff; permanent authentication failures stop retries.
 */
export class TossTradeStream {
  private ws?: WebSocket;
  private ping?: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;
  private failures = 0;
  private stopped = false;
  private declarationTimer?: ReturnType<typeof setTimeout>;
  private lastPong = 0;

  constructor(
    private client: TossProvider,
    private symbols: { market: 'kr' | 'us'; symbol: string }[],
    private onTrade: (symbol: string, price: number, at: number) => void,
    private onStatus: (symbol: string, s: StreamStatus) => void,
  ) {}

  private status(status: StreamStatus) {
    this.symbols.forEach(s => this.onStatus(s.symbol, status));
  }

  start() {
    this.connect();
    return () => this.stop();
  }

  stop() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.declarationTimer) clearTimeout(this.declarationTimer);
    if (this.ping) clearInterval(this.ping);
    const ws = this.ws;
    this.ws = undefined;
    ws?.close();
  }

  private async connect() {
    if (this.stopped) return;
    if (!this.failures) this.status('connecting');
    let token: string;
    try {
      await this.client.reserveStream();
      if (this.stopped) return;
      // REST exposes the precise auth/rate-limit error that RN's handshake error often hides.
      await this.client.prices([this.symbols[0].symbol]);
      token = await this.client.token();
    } catch (e) {
      if ((e instanceof HttpError && [400, 401, 403].includes(e.status)) || String(e).includes('token-revoked')) {
        this.status('failed'); return;
      }
      return this.reconnect();
    }
    if (this.stopped) return;
    const ws = new WebSocket('wss://openapi-ws.tossinvest.com/ws/v1', undefined, { headers: { Authorization: `Bearer ${token}` } });
    this.ws = ws;
    const declare = () => {
      if (this.stopped || this.ws !== ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify((['kr', 'us'] as const).map(market => ({ type: `trade:${market}`, codes: this.symbols.filter(s => s.market === market).map(s => s.symbol) })).filter(s => s.codes.length)));
    };
    ws.onopen = () => {
      if (this.stopped || this.ws !== ws) { ws.close(); return; }
      this.lastPong = Date.now();
      declare();
      this.ping = setInterval(() => {
        if (this.ws !== ws || ws.readyState !== 1) return;
        if (Date.now() - this.lastPong >= 150_000) { ws.close(); return; }
        ws.send('PING');
      }, 60_000);
    };
    ws.onmessage = e => {
      if (this.stopped || this.ws !== ws) return;
      let f: Obj;
      try { f = dict(JSON.parse(String(e.data))); } catch { return; }
      if (f.type === 'pong') this.lastPong = Date.now();
      else if (f.type === 'subscriptions') {
        this.failures = 0;
        this.symbols.forEach(s => this.onStatus(s.symbol, Array.isArray(f.subscribed) && f.subscribed.includes(`trade:${s.market}:${s.symbol}`) ? 'waiting' : 'failed'));
      }
      else if (f.type === 'message') {
        const d = dict(f.data);
        const symbol = this.symbols.find(s => f.topic === `trade:${s.market}:${s.symbol}`)?.symbol;
        if (symbol && num(d.price) > 0) {
          this.onStatus(symbol, 'live');
          this.onTrade(symbol, num(d.price), parseISO(str(d.timestamp)) ?? Date.now());
        }
      } else if (f.type === 'error') {
        if (dict(f.error).code === 'rate-limit-exceeded') {
          if (this.declarationTimer) clearTimeout(this.declarationTimer);
          this.declarationTimer = setTimeout(declare, 1100 + Math.random() * 250);
        } else if (['server-shutdown', 'internal-error'].includes(dict(f.error).code)) ws.close();
        else this.status('failed');
      }
    };
    ws.onerror = () => {}; // onclose follows
    ws.onclose = () => {
      if (this.ws !== ws) return;
      if (this.ping) clearInterval(this.ping);
      if (this.declarationTimer) clearTimeout(this.declarationTimer);
      this.reconnect();
    };
  }

  private reconnect() {
    if (this.stopped) return;
    this.ws = undefined;
    this.failures++;
    this.status('failed'); // keep REST fallback alive while retrying the socket
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(5, this.failures - 1)) * (0.8 + Math.random() * 0.4);
    this.retry = setTimeout(() => this.connect(), delay);
  }
}
