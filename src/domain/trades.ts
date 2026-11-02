import { Fmt } from '../utils';
import { SaleResult } from './calculator';
import { Trade, identity } from './models';

type Rate = (t: Trade) => number | undefined;
type Sales = Record<string, SaleResult | null>;

/** Totals over filtered trades, in KRW at each trade's rate. */
export type TradeTotals = { buy: number; sell: number; profit: number; cost: number; unknown: number };

/** Order totals for one stock over the filtered trades. */
export type StockTotal = {
  key: string; name: string; ticker: string; last: number;
  buyN: number; buyQty: number; buyAmt: number; sellN: number; sellQty: number; sellAmt: number;
  profit: number; cost: number; unknown: number;
};

export function tradeTotals(trades: Trade[], rateOf: Rate, sales: Sales): TradeTotals {
  const out = { buy: 0, sell: 0, profit: 0, cost: 0, unknown: 0 };
  for (const t of trades) {
    const rate = rateOf(t);
    if (rate == null) out[t.side] = NaN; else out[t.side] += t.quantity * t.price * rate;
    if (t.side !== 'sell') continue;
    const r = sales[t.id];
    if (r) { out.profit += r.profit; out.cost += r.cost; } else out.unknown++;
  }
  return out;
}

/** Per-stock totals, most recently traded first. */
export function stockTotals(trades: Trade[], rateOf: Rate, sales: Sales): StockTotal[] {
  const out = new Map<string, StockTotal>();
  for (const t of trades) {
    const k = identity(t.assetType, t.ticker);
    const a = out.get(k) ?? { key: k, name: t.name, ticker: t.ticker, last: t.date, buyN: 0, buyQty: 0, buyAmt: 0, sellN: 0, sellQty: 0, sellAmt: 0, profit: 0, cost: 0, unknown: 0 };
    const rate = rateOf(t);
    const amount = rate == null ? NaN : t.quantity * t.price * rate;
    if (t.side === 'buy') { a.buyN++; a.buyQty += t.quantity; a.buyAmt += amount; } else {
      a.sellN++; a.sellQty += t.quantity; a.sellAmt += amount;
      const r = sales[t.id];
      if (r) { a.profit += r.profit; a.cost += r.cost; } else a.unknown++;
    }
    a.last = Math.max(a.last, t.date);
    out.set(k, a);
  }
  return [...out.values()].sort((a, b) => b.last - a.last);
}

export const profitRate = (a: { profit: number; cost: number }) => (a.cost > 0 ? Fmt.pct((a.profit / a.cost) * 100) : '');

export const sideCounts = (a: StockTotal) =>
  [a.buyN ? `매수 ${a.buyN}건 ${Fmt.qty(a.buyQty)}주` : '', a.sellN ? `매도 ${a.sellN}건 ${Fmt.qty(a.sellQty)}주` : ''].filter(Boolean).join(' · ');
