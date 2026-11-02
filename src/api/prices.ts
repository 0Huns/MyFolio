import { Candle, Market } from '../domain/models';
import { DAY, dict, list, num, sleep, startOfDayKST, str } from '../utils';
import { http } from './http';


const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15' };
const marketCache: Record<string, Set<string>> = {};
const baseCache: Record<string, { at: number; base: number }> = {};

async function krwMarkets(base: string): Promise<Set<string>> {
  if (marketCache[base]) return marketCache[base];
  try {
    const { json } = await http(base + '/v1/market/all');
    const s = new Set(list(json).map(r => str(r.market)).filter(m => m.startsWith('KRW-')));
    if (s.size) marketCache[base] = s;
    return s;
  } catch {
    return new Set();
  }
}

/** `prev` (optional) receives the previous close per ticker, for today's change. */
async function upbitStyle(base: string, tickers: string[], prev?: Record<string, number>): Promise<Record<string, number>> {
  const markets = await krwMarkets(base);
  const wanted = [...new Set(tickers.map(t => `KRW-${t.toUpperCase()}`))].filter(m => !markets.size || markets.has(m));
  const out: Record<string, number> = {};
  for (let i = 0; i < wanted.length; i += 100) {
    try {
      const { json } = await http(`${base}/v1/ticker?markets=${wanted.slice(i, i + 100).join(',')}`);
      for (const r of list(json)) {
        out[str(r.market).slice(4)] = num(r.trade_price);
        if (prev && num(r.prev_closing_price) > 0) prev[str(r.market).slice(4)] = num(r.prev_closing_price);
      }
    } catch {}
  }
  return out;
}

/** Public (keyless) price sources. */
export const Prices = {
  upbit: (t: string[], prev?: Record<string, number>) => upbitStyle('https://api.upbit.com', t, prev),
  bithumb: (t: string[], prev?: Record<string, number>) => upbitStyle('https://api.bithumb.com', t, prev),

  async coinone(): Promise<Record<string, number>> {
    try {
      const { json } = await http('https://api.coinone.co.kr/public/v2/ticker_new/KRW');
      const out: Record<string, number> = {};
      for (const r of list(dict(json).tickers)) out[str(r.target_currency).toUpperCase()] = num(r.last);
      return out;
    } catch {
      return {};
    }
  },

  /** KRX realtime via Naver polling (comma-separated codes). */
  async naver(codes: string[], prev?: Record<string, number>): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (let i = 0; i < codes.length; i += 20) {
      try {
        const { json } = await http('https://polling.finance.naver.com/api/realtime/domestic/stock/' + codes.slice(i, i + 20).join(','), { headers: UA });
        for (const r of list(dict(json).datas)) {
          const p = num(r.closePriceRaw) || num(r.closePrice);
          if (p > 0) out[str(r.itemCode)] = p;
          if (p > 0 && prev) prev[str(r.itemCode)] = p - num(r.compareToPreviousClosePriceRaw);
        }
      } catch {}
    }
    return out;
  },

  async yahooChart(symbol: string, range = '1d'): Promise<any | null> {
    try {
      const { json } = await http(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`, { headers: UA });
      return list(dict(dict(json).chart).result)[0] ?? null;
    } catch {
      return null;
    }
  },

  async yahoo(symbol: string): Promise<number | null> {
    const r = await Prices.yahooChart(symbol);
    const p = num(dict(r?.meta).regularMarketPrice);
    return p > 0 ? p : null;
  },

  /** Last price and previous close. */
  async yahooQuote(symbol: string): Promise<{ price: number; prev: number } | null> {
    const m = dict((await Prices.yahooChart(symbol))?.meta);
    const price = num(m.regularMarketPrice);
    return price > 0 ? { price, prev: num(m.chartPreviousClose) } : null;
  },

  /**
   * KRX 기준가 (Naver) for today's change, matching Toss. Toss KR daily closes are the KRX+NXT last trade and can
   * differ from the 기준가. Cached 10 minutes per ticker.
   */
  async basePrices(krx: string[], now = Date.now()): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    const kr = krx.filter(t => { const c = baseCache[t]; if (c && now - c.at < 10 * 60_000) { out[t] = c.base; return false; } return true; });
    if (kr.length) {
      const prev: Record<string, number> = {};
      await Prices.naver(kr, prev);
      for (const t of kr) if (prev[t] > 0) { out[t] = prev[t]; baseCache[t] = { at: now, base: prev[t] }; }
    }
    return out;
  },

  usdKrw: () => Prices.yahoo('KRW=X'),

  /** Daily closes since `from`, keyed by KST day start. */
  async yahooHistory(symbol: string, from: number): Promise<Record<number, number>> {
    const p1 = Math.floor((from - 7 * DAY) / 1000), p2 = Math.floor(Date.now() / 1000);
    try {
      const { json } = await http(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${p1}&period2=${p2}`,
        { headers: UA },
      );
      const r = list(dict(dict(json).chart).result)[0] ?? {};
      const ts: number[] = r.timestamp ?? [];
      const closes: number[] = list(dict(r.indicators).quote)[0]?.close ?? [];
      const out: Record<number, number> = {};
      ts.forEach((t, i) => { if (num(closes[i]) > 0) out[startOfDayKST(t * 1000)] = num(closes[i]); });
      return out;
    } catch {
      return {};
    }
  },

  /** Yahoo OHLC bars between `from` and `to` (ms), oldest first. Yahoo keeps 1-minute bars for the last ~30 days, ≤8 days per request. */
  async yahooCandles(symbol: string, interval: '1m' | '1d', from: number, to = Date.now()): Promise<Candle[]> {
    try {
      const p1 = Math.floor(from / 1000), p2 = Math.floor(to / 1000);
      const { json } = await http(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&period1=${p1}&period2=${p2}`, { headers: UA });
      const r = list(dict(dict(json).chart).result)[0] ?? {};
      const ts: number[] = r.timestamp ?? [];
      const q = dict(list(dict(r.indicators).quote)[0]);
      const out: Candle[] = [];
      ts.forEach((t, i) => {
        const c = num(q.close?.[i]);
        if (c > 0) out.push({ t: t * 1000, o: num(q.open?.[i]) || c, h: num(q.high?.[i]) || c, l: num(q.low?.[i]) || c, c });
      });
      return out;
    } catch {
      return [];
    }
  },

  /** Upbit KRW-market OHLC bars, oldest first (200 per call). */
  async upbitCandles(ticker: string, interval: '1m' | '1d', count: number, beforeMs?: number): Promise<Candle[]> {
    const out: Candle[] = [];
    let to = beforeMs ? new Date(beforeMs).toISOString().replace(/\.\d{3}Z$/, 'Z') : '';
    while (out.length < count) {
      try {
        const q = `market=KRW-${ticker.toUpperCase()}&count=${Math.min(200, count - out.length)}${to ? `&to=${encodeURIComponent(to)}` : ''}`;
        const { json } = await http(`https://api.upbit.com/v1/candles/${interval === '1m' ? 'minutes/1' : 'days'}?${q}`);
        const rows = list(json);
        for (const r of rows) {
          const t = Date.parse(`${str(r.candle_date_time_utc)}Z`);
          if (t && num(r.trade_price) > 0) out.push({ t, o: num(r.opening_price), h: num(r.high_price), l: num(r.low_price), c: num(r.trade_price) });
        }
        if (rows.length === 0) break;
        to = `${str(rows[rows.length - 1].candle_date_time_utc)}Z`;
        await sleep(120);
      } catch {
        break;
      }
    }
    return [...new Map(out.map(c => [c.t, c])).values()].sort((a, b) => a.t - b.t);
  },

  yahooSymbols(ticker: string, market: Market): string[] {
    if (market === 'krx') return [`${ticker}.KS`, `${ticker}.KQ`];
    if (market === 'us') return [ticker.replace(/\./g, '-')];
    return [`${ticker}-KRW`];
  },
};
