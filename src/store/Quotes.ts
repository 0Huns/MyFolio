import {
  StreamStatus,
  TossProvider,
  TossTradeStream,
} from '../api/brokers/toss';
import { Prices } from '../api/prices';
import { ChartRange, groupBars } from '../domain/chart';
import { Candle, Market, identity } from '../domain/models';
import { account } from '../domain/portfolio';
import { DAY } from '../utils';
import { AppState } from './AppState';
import { BrokerClients } from './BrokerClients';
import { ExchangeRates } from './ExchangeRates';
import { History } from './History';

/** Source bars (1-minute or daily), how many make one bar (roughly, for sizing requests), and bars per load. */
const BAR_SPEC: Record<
  ChartRange,
  { src: '1m' | '1d'; per: number; batch: number }
> = {
  m1: { src: '1m', per: 1, batch: 120 },
  m3: { src: '1m', per: 3, batch: 120 },
  m5: { src: '1m', per: 5, batch: 120 },
  d: { src: '1d', per: 1, batch: 120 },
  w: { src: '1d', per: 5, batch: 60 },
  mo: { src: '1d', per: 21, batch: 36 },
};

/** Current prices, the live trade stream and chart bars. */
export class Quotes {
  running = false;
  private epoch = 0;
  private stopStream?: () => void;
  private signature = '';
  private client?: TossProvider;
  private frame?: number;
  status = new Map<string, StreamStatus>();
  private liveRevision: Record<string, number> = {};
  private liveTradeAt: Record<string, number> = {};
  private feeds = new Set<{
    symbol: string;
    market: 'kr' | 'us';
    onTrade: (p: number, t: number) => void;
    onStatus: (s: StreamStatus) => void;
  }>();
  private refreshing?: Promise<void>;

  constructor(
    private state: AppState,
    private clients: BrokerClients,
    private rates: ExchangeRates,
    private history: History,
  ) {}

  /**
   * One page of chart bars, oldest first: the newest page, or the page just before `before` (ms, the oldest bar loaded)
   * when scrolling back. Built from 1-minute or daily bars (all Toss and Upbit offer). Toss when connected (stocks),
   * Upbit for crypto, otherwise Yahoo. An empty result means there is no older data.
   */
  async candles(
    m: { ticker: string; market: Market },
    range: ChartRange,
    before?: number,
    signal?: AbortSignal,
  ): Promise<Candle[]> {
    const { src, per, batch } = BAR_SPEC[range];
    // A page plus one bar of slack, since the oldest grouped bar may be partial.
    const need = (batch + 2) * per;
    let rows: Candle[] = [];
    const toss = m.market !== 'crypto' ? await this.clients.toss() : null;
    if (toss) {
      rows = await toss.candles(m.ticker, src, need, before, signal);
    }
    if (signal?.aborted) return [];
    if (!rows.length && m.market === 'crypto')
      rows = await Prices.upbitCandles(m.ticker, src, need, before);
    if (!rows.length && !toss) {
      const to = before ? before - 1 : Date.now();
      // 1-minute bars: one ≤8-day window (Yahoo's limit); daily: calendar days ≈ trading days × 1.5.
      const from =
        src === '1m' ? to - 7 * DAY : to - Math.ceil(need * 1.5 + 7) * DAY;
      for (const sym of Prices.yahooSymbols(m.ticker, m.market)) {
        rows = await Prices.yahooCandles(sym, src, from, to);
        if (rows.length) break;
      }
    }
    if (before) rows = rows.filter(x => x.t < before);
    let bars = groupBars(rows, range);
    // The oldest grouped bar (3/5-minute, week, month) may be cut off by the request size — drop it; the next page has it whole.
    if (per > 1 && bars.length > 1 && rows.length >= need) bars = bars.slice(1);
    return bars.slice(-batch);
  }

  stop() {
    this.epoch++;
    this.stopStream?.();
    this.stopStream = undefined;
    this.signature = '';
    this.status.clear();
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }

  /** One socket shared by the portfolio and detail page; remaining symbols keep REST polling. */
  async reconcile() {
    if (!this.running) return;
    const epoch = ++this.epoch;
    let client: TossProvider | null;
    try {
      client = await this.clients.toss();
    } catch {
      client = null;
    }
    if (epoch !== this.epoch || !this.running) return;
    const all = new Map<string, { symbol: string; market: 'kr' | 'us' }>();
    // Keep the visible detail subscribed even when holdings exceed the 100-topic limit.
    for (const feed of this.feeds) all.set(feed.symbol, feed);
    for (const h of this.state.data.holdings)
      if (h.market !== 'crypto') {
        const symbol = h.market === 'us' ? h.ticker.toUpperCase() : h.ticker;
        if (!all.has(symbol))
          all.set(symbol, { symbol, market: h.market === 'krx' ? 'kr' : 'us' });
      }
    const symbols = [...all.values()].slice(0, 100);
    const signature = symbols
      .map(s => `${s.market}:${s.symbol}`)
      .sort()
      .join(',');
    if (
      client &&
      this.stopStream &&
      this.client === client &&
      signature === this.signature
    )
      return;
    this.stopStream?.();
    this.stopStream = undefined;
    this.status.clear();
    this.signature = signature;
    this.client = client ?? undefined;
    if (!client || !symbols.length) {
      this.feeds.forEach(f => f.onStatus('failed'));
      return;
    }
    this.stopStream = new TossTradeStream(
      client,
      symbols,
      (symbol, price, at) => {
        const key = identity('stock', symbol);
        if (at >= (this.liveTradeAt[key] ?? 0)) {
          this.state.prices[key] = price;
          this.liveTradeAt[key] = at;
          this.liveRevision[key] = (this.liveRevision[key] ?? 0) + 1;
        }
        this.feeds.forEach(f => {
          if (f.symbol === symbol) f.onTrade(price, at);
        });
        if (this.frame === undefined)
          this.frame = requestAnimationFrame(() => {
            this.frame = undefined;
            this.state.lastPriceRefresh = Date.now();
            this.state.emitPrices();
          });
      },
      (symbol, status) => {
        this.status.set(symbol, status);
        this.feeds.forEach(f => {
          if (f.symbol === symbol) f.onStatus(status);
        });
      },
    ).start();
  }

  async liveTrades(
    m: { ticker: string; market: Market },
    onTrade: (price: number, at: number) => void,
    onStatus: (s: StreamStatus) => void,
  ) {
    if (m.market === 'crypto') return null;
    const feed = {
      symbol: m.market === 'us' ? m.ticker.toUpperCase() : m.ticker,
      market: (m.market === 'krx' ? 'kr' : 'us') as 'kr' | 'us',
      onTrade,
      onStatus,
    };
    this.feeds.add(feed);
    onStatus(this.status.get(feed.symbol) ?? 'connecting');
    void this.reconcile();
    return () => {
      this.feeds.delete(feed);
      void this.reconcile();
    };
  }

  /** One-off current price for polling (Toss when connected, otherwise the public sources). */
  async quote(m: { ticker: string; market: Market }): Promise<number | null> {
    const toss = m.market !== 'crypto' ? await this.clients.toss() : null;
    if (toss) return (await toss.prices([m.ticker]))[m.ticker] ?? null;
    if (m.market === 'crypto')
      return (await Prices.upbit([m.ticker]))[m.ticker.toUpperCase()] ?? null;
    if (m.market === 'krx')
      return (await Prices.naver([m.ticker]))[m.ticker] ?? null;
    return (
      (await Prices.yahooQuote(m.ticker.replace(/\./g, '-')))?.price ?? null
    );
  }

  private isLivePrice(key: string) {
    return (
      key.startsWith('sec:') &&
      this.status.get(key.slice(4)) === 'live' &&
      this.liveTradeAt[key] != null
    );
  }

  /** Quote snapshots must not replace an active trade feed with a different/older last-price source. */
  setLivePrice(identityKey: string, price: number) {
    if (this.isLivePrice(identityKey)) return;
    this.state.prices[identityKey] = price;
    this.state.emitPrices();
  }

  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const task = this.refreshOnce();
    this.refreshing = task;
    void task.then(
      () => {
        this.refreshing = undefined;
      },
      () => {
        this.refreshing = undefined;
      },
    );
    return task;
  }

  private async refreshOnce() {
    const revision = { ...this.liveRevision };
    const up: string[] = [],
      bt: string[] = [],
      co: string[] = [],
      krx: string[] = [],
      us: string[] = [];
    for (const h of this.state.data.holdings) {
      if (h.market === 'krx') krx.push(h.ticker);
      else if (h.market === 'us') us.push(h.ticker);
      else {
        const b = account(this.state, h.accountId)?.broker;
        (b === 'bithumb' ? bt : b === 'coinone' ? co : up).push(h.ticker);
      }
    }
    const next = { ...this.state.prices };
    const prev = { ...this.state.prevClose };
    const stocks = [...new Set([...krx, ...us])];

    // When Toss is configured, keep stock quotes and candles on that source even on errors.
    await this.rates.refresh();
    const fromToss = new Set<string>();
    const toss = await this.clients.toss();
    if (toss) {
      try {
        const px = await toss.prices(stocks);
        const pc = await toss.prevCloses(Object.keys(px));
        for (const [t, p] of Object.entries(px)) {
          next[identity('stock', t)] = p;
          if (pc[t]) prev[identity('stock', t)] = pc[t];
          fromToss.add(t);
        }
      } catch (e) {
        console.log('toss prices failed', e);
      }
      // Base prices Toss uses for today's change: KRX 기준가 (KR daily closes include NXT) and, for US, the
      // regular close of the previous trading day. Failures keep the daily-candle previous close set above.
      const [krBase, usBase] = await Promise.all([
        Prices.basePrices(krx.filter(t => fromToss.has(t))).catch(
          () => ({} as Record<string, number>),
        ),
        toss
          .usBasePrices(us.filter(t => fromToss.has(t)))
          .catch(() => ({} as Record<string, number>)),
      ]);
      for (const [t, p] of Object.entries({ ...krBase, ...usBase }))
        prev[identity('stock', t)] = p;
    }

    const crypto = [...new Set([...up, ...bt, ...co])];
    const pcUp: Record<string, number> = {},
      pcBt: Record<string, number> = {};
    const [pu, pb, pc] = await Promise.all([
      Prices.upbit(crypto, pcUp),
      bt.length
        ? Prices.bithumb(bt, pcBt)
        : Promise.resolve({} as Record<string, number>),
      co.length
        ? Prices.coinone()
        : Promise.resolve({} as Record<string, number>),
    ]);
    for (const t of crypto) {
      const p = pu[t] ?? pb[t] ?? pc[t];
      if (p) next[identity('crypto', t)] = p;
      const pv = pu[t] ? pcUp[t] : pcBt[t];
      if (pv) prev[identity('crypto', t)] = pv;
    }
    const pcKrx: Record<string, number> = {};
    for (const [c, p] of Object.entries(
      await Prices.naver(
        [...new Set(krx)].filter(t => !toss && !fromToss.has(t)),
        pcKrx,
      ),
    )) {
      next[identity('stock', c)] = p;
      if (pcKrx[c]) prev[identity('stock', c)] = pcKrx[c];
    }
    await Promise.all(
      [...new Set(us)]
        .filter(t => !toss && !fromToss.has(t))
        .map(async t => {
          const q = await Prices.yahooQuote(t.replace(/\./g, '-'));
          if (!q) return;
          next[identity('stock', t)] = q.price;
          if (q.prev > 0) prev[identity('stock', t)] = q.prev;
        }),
    );
    // REST requests can complete after a newer socket tick. Never replace that tick.
    for (const key of Object.keys(this.liveRevision)) {
      if (this.isLivePrice(key) || this.liveRevision[key] !== revision[key])
        next[key] = this.state.prices[key];
    }
    this.state.prices = next;
    this.state.prevClose = prev;
    this.state.lastPriceRefresh = Date.now();
    this.history.record();
  }
}
