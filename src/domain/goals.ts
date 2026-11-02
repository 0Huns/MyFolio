import { Trade } from './models';

export type Quest = { id: string; title: string };

export const quests: Quest[] = [
  { id: 'assets', title: '오늘의 내 자산 확인하기' },
  { id: 'filing', title: '가장 큰 종목의 새 공시 읽기' },
  { id: 'plan', title: '이번 달 투자 금액 정하기' },
];

/** 0–100, capped: a reached goal stays at 100%. */
export const goalPercent = (total: number, target: number) =>
  target > 0 && total > 0 ? Math.min(100, (total / target) * 100) : 0;

const month = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(0, 7);

/** Buying in `months` months in a row, counted back from the latest month with a purchase. */
export function steadyBuying(trades: Pick<Trade, 'side' | 'date'>[], months = 3) {
  const seen = new Set(trades.filter(t => t.side === 'buy').map(t => month(t.date)));
  const latest = [...seen].sort().pop();
  if (!latest) return false;
  const [y, m] = latest.split('-').map(Number);
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7);
    if (!seen.has(d)) return false;
  }
  return true;
}

/** A position still held whose first purchase is at least a year old. */
export function heldOneYear(trades: Pick<Trade, 'side' | 'date' | 'ticker'>[], tickers: string[], now: number) {
  const held = new Set(tickers);
  return trades.some(t => t.side === 'buy' && held.has(t.ticker) && now - t.date >= 365 * 86400_000);
}

/** Badges reward habits (spreading out, staying invested), never how often the app is opened or how much was traded. */
export function badges(trades: Pick<Trade, 'side' | 'date' | 'ticker'>[], tickers: string[], now: number) {
  return [
    { title: '5종목', caption: '분산 달성', earned: tickers.length >= 5 },
    { title: '3개월', caption: '꾸준히 투자', earned: steadyBuying(trades) },
    { title: '1년', caption: '장기 보유', earned: heldOneYear(trades, tickers, now) },
  ];
}
