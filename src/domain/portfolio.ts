import { realizedByTrade, saleResults } from './calculator';
import { usTradeDay } from './marketTime';
import {
  AppData,
  Holding,
  MergedHolding,
  Trade,
  identity,
  liveHoldingValue,
  marketCurrency,
  mh,
} from './models';
import { Fmt } from '../utils';

/** The state portfolio figures are derived from. */
export type PortfolioView = {
  data: AppData;
  prices: Record<string, number>;
  /** Base price per identityKey (native currency), for today's change. */
  prevClose: Record<string, number>;
  usdKrw: number;
};

export type Summary = {
  profit?: number;
  value: number;
  cost: number;
  cash: number;
  stock: number;
  crypto: number;
};

export const sum = {
  pnl: (s: Summary) => s.profit ?? s.value - s.cost,
  ret: (s: Summary) =>
    s.cost > 0 ? ((s.profit ?? s.value - s.cost) / s.cost) * 100 : 0,
  total: (s: Summary) => s.value + s.cash,
};

export const account = (v: PortfolioView, id: string) =>
  v.data.accounts.find(a => a.id === id);
export const toKRW = (v: PortfolioView, amount: number, c: 'krw' | 'usd') =>
  c === 'usd' ? amount * v.usdKrw : amount;

export function merged(v: PortfolioView, accountId?: string): MergedHolding[] {
  const map: Record<string, MergedHolding> = {};
  const now = Date.now();
  for (const h of v.data.holdings) {
    if (accountId && h.accountId !== accountId) continue;
    const k = identity(h.assetType, h.ticker);
    const m = (map[k] ??= {
      identityKey: k,
      ticker: h.ticker,
      name: h.name,
      assetType: h.assetType,
      market: h.market,
      quantity: 0,
      cost: 0,
      price: v.prices[k] ?? h.lastPrice,
      accountIds: [],
    });
    if (h.amountAfterCost != null && Number.isFinite(h.amountAfterCost)) {
      if (h.valuationAt)
        m.valuationAt = Math.min(m.valuationAt ?? h.valuationAt, h.valuationAt);
    }
    m.valuationAmount =
      (m.valuationAmount ?? 0) +
      liveHoldingValue(h, m.price || h.lastPrice, now);
    m.quantity += h.quantity;
    m.cost += h.purchaseAmount ?? h.quantity * h.avgPrice;
    if (!m.price) m.price = h.lastPrice;
    if (m.name === m.ticker && h.name !== h.ticker) m.name = h.name;
    if (!m.accountIds.includes(h.accountId)) m.accountIds.push(h.accountId);
  }
  return Object.values(map);
}

type FxBasis = Record<string, { qty: number; rate: number }>;
let fxBasisCache:
  | {
      trades: Trade[];
      count: number;
      fx: AppData['dailyFx'];
      fxDays: number;
      basis: FxBasis;
    }
  | undefined;

/**
 * Average purchase fixing per US position (`account:ticker`), as Toss converts the KRW principal: moving average of
 * quantity × price × trade-day fixing, fees excluded. Only for positions whose every open lot has a known fixing.
 */
function fxBasis(v: PortfolioView): FxBasis {
  const fx = v.data.dailyFx ?? {};
  const c = fxBasisCache;
  if (
    c &&
    c.trades === v.data.trades &&
    c.count === v.data.trades.length &&
    c.fx === v.data.dailyFx &&
    c.fxDays === Object.keys(fx).length
  )
    return c.basis;
  const pos: Record<string, { qty: number; usd: number; krw: number }> = {};
  for (const t of [...v.data.trades]
    .filter(t => t.market === 'us')
    .sort((a, b) => a.date - b.date)) {
    const p = (pos[`${t.accountId}:${t.ticker}`] ??= {
      qty: 0,
      usd: 0,
      krw: 0,
    });
    if (t.side === 'buy') {
      p.qty += t.quantity;
      p.usd += t.quantity * t.price;
      p.krw += t.quantity * t.price * (fx[usTradeDay(t.date)] ?? NaN);
    } else if (p.qty > 0) {
      const f = Math.min(1, t.quantity / p.qty);
      p.usd -= p.usd * f;
      p.krw -= p.krw * f;
      p.qty = Math.max(0, p.qty - t.quantity);
      if (p.qty < 1e-9) Object.assign(p, { qty: 0, usd: 0, krw: 0 }); // a full exit clears unknown lots
    }
  }
  const basis: FxBasis = {};
  for (const [k, p] of Object.entries(pos))
    if (p.usd > 0 && Number.isFinite(p.krw))
      basis[k] = { qty: p.qty, rate: p.krw / p.usd };
  fxBasisCache = {
    trades: v.data.trades,
    count: v.data.trades.length,
    fx: v.data.dailyFx,
    fxDays: Object.keys(fx).length,
    basis,
  };
  return basis;
}

/**
 * KRW principal of a US broker position at its purchase fixings minus at today's rate (0 when unknown, in USD
 * display, or when trade history doesn't match the broker quantity). Added to cost, subtracted from P&L.
 */
function fxCostAdjust(v: PortfolioView, h: Holding): number {
  if (h.market !== 'us' || v.data.settings.displayCurrency === 'usd') return 0;
  const b = fxBasis(v)[`${h.accountId}:${h.ticker}`];
  if (!b || Math.abs(b.qty - h.quantity) > Math.max(1e-6, h.quantity * 1e-6))
    return 0;
  return (h.purchaseAmount ?? h.quantity * h.avgPrice) * (b.rate - v.usdKrw);
}

export function holdingCost(v: PortfolioView, m: MergedHolding): number {
  // The broker's USD purchase amount stays authoritative; trade history only supplies its KRW purchase fixings.
  let adjust = 0;
  for (const h of v.data.holdings)
    if (
      m.accountIds.includes(h.accountId) &&
      identity(h.assetType, h.ticker) === m.identityKey
    )
      adjust += fxCostAdjust(v, h);
  return toKRW(v, m.cost, mh.currency(m)) + adjust;
}

export function holdingPnl(v: PortfolioView, m: MergedHolding) {
  let result = 0;
  for (const h of v.data.holdings.filter(
    h =>
      m.accountIds.includes(h.accountId) &&
      identity(h.assetType, h.ticker) === m.identityKey,
  )) {
    const net = h.amountAfterCost ?? h.quantity * h.lastPrice;
    const delta = liveHoldingValue(h, m.price) - net;
    const pnl =
      h.profitAfterCost ?? net - (h.purchaseAmount ?? h.quantity * h.avgPrice);
    result +=
      toKRW(v, pnl + delta, marketCurrency(h.market)) - fxCostAdjust(v, h);
  }
  return result;
}

export function holdingReturn(v: PortfolioView, m: MergedHolding) {
  const cost = holdingCost(v, m);
  return cost > 0 ? (holdingPnl(v, m) / cost) * 100 : NaN;
}

/** Average purchase price; US positions in KRW use the KRW principal (purchase fixings), like Toss. */
export function avgPriceText(v: PortfolioView, m: MergedHolding): string {
  if (
    mh.currency(m) === 'usd' &&
    v.data.settings.displayCurrency === 'krw' &&
    m.quantity > 0
  )
    return Fmt.krw(holdingCost(v, m) / m.quantity);
  return Fmt.price(mh.avg(m), mh.currency(m));
}

export function summary(v: PortfolioView, accountId?: string): Summary {
  const s: Summary = { value: 0, cost: 0, cash: 0, stock: 0, crypto: 0 };
  for (const m of merged(v, accountId)) {
    const value = toKRW(v, mh.value(m), mh.currency(m));
    s.value += value;
    s.cost += holdingCost(v, m);
    if (m.assetType === 'crypto') s.crypto += value;
    else s.stock += value;
  }
  s.profit = merged(v, accountId).reduce(
    (total, m) => total + holdingPnl(v, m),
    0,
  );
  for (const a of v.data.accounts.filter(
    a => (!accountId || a.id === accountId) && a.valuation,
  )) {
    const baseline = a.valuation!;
    const held = v.data.holdings.filter(h => h.accountId === a.id);
    let itemValue = 0,
      itemCost = 0,
      itemProfit = 0;
    for (const h of held) {
      const currency = marketCurrency(h.market);
      const net = h.amountAfterCost ?? h.quantity * h.lastPrice;
      const cost = h.purchaseAmount ?? h.quantity * h.avgPrice;
      itemValue += toKRW(v, net, currency);
      itemCost += toKRW(v, cost, currency);
      itemProfit += toKRW(v, h.profitAfterCost ?? net - cost, currency);
    }
    const value = baseline.value.krw + toKRW(v, baseline.value.usd, 'usd');
    const cost = baseline.purchase.krw + toKRW(v, baseline.purchase.usd, 'usd');
    const profit = baseline.profit.krw + toKRW(v, baseline.profit.usd, 'usd');
    // Item sums already contain the live delta. Replace only the snapshot base.
    s.value += value - itemValue;
    s.stock += value - itemValue;
    s.cost += cost - itemCost;
    s.profit += profit - itemProfit;
  }
  s.cash = v.data.accounts
    .filter(a => !accountId || a.id === accountId)
    .reduce((t, a) => t + a.cashKRW + toKRW(v, a.cashUSD ?? 0, 'usd'), 0);
  return s;
}

/** Change since the previous close (native currency), or null when no previous close is known. */
export function dayChange(
  v: PortfolioView,
  m: MergedHolding,
): { amount: number; rate: number } | null {
  const p = v.prevClose[m.identityKey];
  return p > 0 && m.price > 0
    ? { amount: (m.price - p) * m.quantity, rate: (m.price / p - 1) * 100 }
    : null;
}

/**
 * Today's P&L in KRW over holdings with a known base price (USD at the current rate). As Toss does, the rate is
 * divided by those holdings' principal, not by yesterday's value.
 */
export function daySummary(
  v: PortfolioView,
  accountId?: string,
): { amount: number; rate: number } | null {
  let amount = 0,
    principal = 0;
  for (const m of merged(v, accountId)) {
    const p = v.prevClose[m.identityKey];
    if (!(p > 0) || !(m.price > 0)) continue;
    amount += toKRW(v, (m.price - p) * m.quantity, mh.currency(m));
    principal += holdingCost(v, m);
  }
  return principal > 0 ? { amount, rate: (amount / principal) * 100 } : null;
}

/**
 * Rate from a trade's currency to the amounts the trade list shows: KRW at each trade's fixing; in dollar display,
 * US trades scale by today's rate so Fmt.krw shows USD.
 */
export const displayRate = (v: PortfolioView, t: Trade): number | undefined =>
  v.data.settings.displayCurrency === 'usd'
    ? t.market === 'us'
      ? v.usdKrw
      : 1
    : tradeRate(v, t);

/**
 * 판매수익 per sale as Toss computes it (verified to the cent / a few won): average cost incl. buy fees, net of sell
 * fees and tax, reconciled with broker holdings. Cost basis needs the whole history, so this covers all trades.
 */
export function tradeSales(v: PortfolioView) {
  return saleResults(
    v.data.trades,
    (t: Trade) => displayRate(v, t),
    (a: string, k: string) => heldQuantity(v, a, k),
  );
}

/**
 * Broker-reported quantity of an asset in a synced account (0 when no longer held), used to reconcile trade history
 * with missing sells. Undefined for manual accounts, whose holdings aren't an independent record.
 */
export const heldQuantity = (
  v: PortfolioView,
  accountId: string,
  identityKey: string,
): number | undefined => {
  const a = account(v, accountId);
  if (!a || a.broker === 'manual' || !a.lastSyncDate) return undefined;
  return v.data.holdings
    .filter(
      h =>
        h.accountId === accountId &&
        identity(h.assetType, h.ticker) === identityKey,
    )
    .reduce((q, h) => q + h.quantity, 0);
};

export function tradeRate(v: PortfolioView, t: Trade): number | undefined {
  return t.market === 'us' ? v.data.dailyFx?.[usTradeDay(t.date)] : 1;
}

export function tradeAmount(
  v: PortfolioView,
  t: Trade,
  amount: number,
): string {
  if (t.market !== 'us' || v.data.settings.displayCurrency === 'usd')
    return Fmt.price(amount, marketCurrency(t.market));
  const rate = tradeRate(v, t);
  return rate == null ? '기준환율 미확인' : Fmt.price(amount * rate, 'krw');
}

export function saleProfits(v: PortfolioView, trades = v.data.trades) {
  const values = realizedByTrade(
    trades,
    v.data.settings.displayCurrency === 'usd' ? () => 1 : t => tradeRate(v, t),
  );
  for (const t of trades)
    if (t.side === 'sell' && account(v, t.accountId)?.broker === 'toss')
      values[t.id] = null;
  return values;
}

/** KRW storage/display adapter: USD mode retains native USD realized gains. */
export function realizedByAsset(v: PortfolioView): Record<string, number> {
  const pnl = saleProfits(v);
  const out: Record<string, number> = {};
  for (const t of v.data.trades) {
    if (t.side !== 'sell') continue;
    const key = identity(t.assetType, t.ticker);
    const value = pnl[t.id] ?? NaN;
    out[key] =
      (out[key] ?? 0) +
      (v.data.settings.displayCurrency === 'usd'
        ? toKRW(v, value, marketCurrency(t.market))
        : value);
  }
  return out;
}

/** US tickers from holdings + watchlist. */
export function usTickers(v: PortfolioView): string[] {
  const held = v.data.holdings
    .filter(h => h.market === 'us')
    .map(h => h.ticker.toUpperCase());
  return [...new Set([...held, ...v.data.settings.usWatchlist])];
}
