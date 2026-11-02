import { Trade, identity } from './models';

export type Position = {
  quantity: number;
  cost: number;
  realized: number;
  totalBought: number;
  totalSold: number;
  fees: number;
};

/** Average-cost P&L per identityKey (native currency). */
export function positions(trades: Trade[]): Record<string, Position> {
  const out: Record<string, Position> = {};
  for (const t of [...trades].sort((a, b) => a.date - b.date)) {
    const k = identity(t.assetType, t.ticker);
    const p = (out[k] ??= { quantity: 0, cost: 0, realized: 0, totalBought: 0, totalSold: 0, fees: 0 });
    const amount = t.quantity * t.price;
    p.fees += t.fee + t.tax;
    if (t.side === 'buy') {
      p.quantity += t.quantity;
      p.cost += amount + t.fee;
      p.totalBought += amount;
    } else {
      // History may start mid-position (sync window) → only realize the matched part.
      const q = Math.min(t.quantity, p.quantity);
      const avg = p.quantity > 0 ? p.cost / p.quantity : 0;
      p.realized += q * (t.price - avg) - t.fee - t.tax;
      p.cost -= avg * q;
      p.quantity -= q;
      p.totalSold += amount;
      if (p.quantity < 1e-9) { p.quantity = 0; p.cost = 0; }
    }
  }
  return out;
}

/** One sale's realized result: `profit` net of buy and sell costs, `cost` = average cost (incl. buy fees) of the shares sold. */
export type SaleResult = { profit: number; cost: number };

/**
 * Per-sale average-cost results, isolated by account. A sale larger than the recorded position (missing buy records)
 * stays unknown (null). Matches Toss's 판매수익 in USD and, with each trade's US trading-day fixing, in KRW.
 */
export function saleResults(
  trades: Trade[],
  rateForTrade: (t: Trade) => number | undefined = () => 1,
  heldQuantity?: (accountId: string, identityKey: string) => number | undefined,
): Record<string, SaleResult | null> {
  const sorted = [...trades].sort((a, b) => a.date - b.date);
  const drops = heldQuantity ? missingSaleDrops(sorted, heldQuantity) : new Map<string, number>();
  const lots = new Map<string, { quantity: number; cost: number }>();
  const result: Record<string, SaleResult | null> = {};
  for (const t of sorted) {
    const key = `${t.accountId}:${identity(t.assetType, t.ticker)}`;
    const lot = lots.get(key) ?? { quantity: 0, cost: 0 };
    lots.set(key, lot);
    dropMissing(t, lot);
    const rate = rateForTrade(t);
    const price = rate == null ? NaN : t.price * rate;
    const fee = rate == null ? NaN : t.fee * rate;
    const tax = rate == null ? NaN : t.tax * rate;
    if (t.side === 'buy') {
      lot.quantity += t.quantity;
      lot.cost += t.quantity * price + fee;
      continue;
    }
    const matched = Math.min(t.quantity, lot.quantity);
    const avg = lot.quantity > 0 ? lot.cost / lot.quantity : 0;
    result[t.id] = t.quantity > 0 && lot.quantity + 1e-9 >= t.quantity && Number.isFinite(lot.cost + price + fee + tax)
      ? { profit: t.quantity * (price - avg) - fee - tax, cost: t.quantity * avg } : null;
    lot.cost -= avg * matched;
    lot.quantity -= matched;
    if (lot.quantity < 1e-9) { lot.quantity = 0; lot.cost = 0; }
  }
  return result;

  // Shares the broker no longer counts vanished without a sale (Toss keeps their cost on the remaining shares).
  function dropMissing(t: Trade, lot: { quantity: number; cost: number }) {
    const excess = drops.get(t.id);
    if (!excess || lot.quantity <= 0) return;
    lot.quantity = Math.max(0, lot.quantity - excess);
  }
}

/**
 * Reconcile trade history with the broker's current holdings. When the history leaves more shares than the broker
 * holds, shares left the account without a listed sale (Toss shows no sale for them and keeps their cost on the rest —
 * verified against Toss: the next sale's 판매수익 used the full cost of the larger position). The time is unknown, so the
 * excess goes just before the trade at which the position reaches its low after it last dipped below the excess —
 * typically the sale that would otherwise have left exactly the excess, which then closes the position.
 * Returns trade id → shares to drop before that trade.
 */
function missingSaleDrops(sorted: Trade[], heldQuantity: (accountId: string, identityKey: string) => number | undefined): Map<string, number> {
  const series = new Map<string, { id: string; pos: number }[]>();
  for (const t of sorted) {
    const key = `${t.accountId}\u0000${identity(t.assetType, t.ticker)}`;
    const s = series.get(key) ?? [];
    const prev = s.length ? s[s.length - 1].pos : 0;
    s.push({ id: t.id, pos: prev + (t.side === 'buy' ? t.quantity : -t.quantity) });
    series.set(key, s);
  }
  const out = new Map<string, number>();
  for (const [key, s] of series) {
    const [accountId, identityKey] = key.split('\u0000');
    const held = heldQuantity(accountId, identityKey);
    if (held == null) continue;
    const excess = s[s.length - 1].pos - held;
    if (!(excess > 1e-6)) continue;
    let start = 0;
    s.forEach((p, i) => { if (p.pos < excess - 1e-6) start = i + 1; });
    if (start >= s.length) continue;
    let at = start;
    for (let i = start; i < s.length; i++) if (s[i].pos < s[at].pos - 1e-9) at = i;
    out.set(s[at].id, excess);
  }
  return out;
}

/** Per-sale average-cost P&L, isolated by account. Unknown opening cost stays unknown. */
export function realizedByTrade(trades: Trade[], rateForTrade: (t: Trade) => number | undefined = () => 1): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [id, r] of Object.entries(saleResults(trades, rateForTrade))) out[id] = r ? r.profit : null;
  return out;
}
