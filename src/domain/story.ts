import { Fmt } from '../utils';
import { Filing, ShortVolume } from './models';

/** Numbers put into plain sentences. These state what the data shows, never whether it is good or bad. */

const won = (v: number, hide: boolean) => Fmt.krw(Math.abs(v), hide);

export function dayHeadline(day: { amount: number } | null, total: number, hide: boolean) {
  if (!day) return { label: '내 전체 자산', title: Fmt.krw(total, hide) };
  const label = '오늘의 내 돈';
  if (hide) return { label, title: '금액 숨김' };
  if (Math.trunc(day.amount) === 0) return { label, title: '어제와 같아요' };
  return { label, title: `어제보다 ${won(day.amount, hide)} ${day.amount > 0 ? '늘었어요' : '줄었어요'}` };
}

/** Sentence for an open position's profit or loss. */
export function holdingHeadline(pnl: number, hide: boolean) {
  if (!Number.isFinite(pnl)) return '손익을 아직 알 수 없어요';
  if (hide) return '금액 숨김';
  if (Math.trunc(pnl) === 0) return '지금은 본전이에요';
  return pnl > 0 ? `지금 ${won(pnl, hide)} 벌고 있어요` : `지금 ${won(pnl, hide)} 손실 중이에요`;
}

export const moverLine = (name: string, rate: number) => `${name}이(가) 가장 많이 ${rate > 0 ? '올랐어요' : '내렸어요'}.`;

/** Biggest rise and fall of the day; a side is missing when nothing moved that way. */
export function movers<T>(rows: T[], rateOf: (row: T) => number | undefined) {
  let up: { row: T; rate: number } | undefined, down: { row: T; rate: number } | undefined;
  for (const row of rows) {
    const rate = rateOf(row);
    if (rate === undefined) continue;
    if (rate > 0 && (!up || rate > up.rate)) up = { row, rate };
    if (rate < 0 && (!down || rate < down.rate)) down = { row, rate };
  }
  return { up, down };
}

export function tradeHeadline(buys: number, sells: number, profit: number, known: boolean) {
  if (!buys && !sells) return '거래가 없었어요';
  const acts = buys && sells ? `${buys}번 사고 ${sells}번 팔` : buys ? `${buys}번 샀` : `${sells}번 팔`;
  if (!sells) return `${acts}어요`;
  if (!known) return `${acts}았어요`;
  const v = Math.trunc(profit);
  return `${acts}아서 ${v === 0 ? '본전이었어요' : v > 0 ? `${won(profit, false)} 벌었어요` : `${won(profit, false)} 손실이 났어요`}`;
}

export const qtyLine = (quantity: string, side: 'buy' | 'sell', crypto: boolean) => `${quantity}${crypto ? '' : '주'} ${side === 'buy' ? '샀어요' : '팔았어요'}`;

/** "2026-11-02" → "11월 2일". */
export const dayLabel = (day: string) => `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일`;

export const saleLine = (profit: number) => {
  const v = Math.trunc(profit);
  return v === 0 ? '본전이었어요' : v > 0 ? `${Fmt.krw(profit)} 벌었어요` : `${Fmt.krw(-profit)} 손실이 났어요`;
};

/** Latest short-sale ratio against the 10-day average; ±3 points counts as usual. `volumes` is newest first. */
export function shortTrend(volumes: ShortVolume[]) {
  if (volumes.length < 2) return null;
  const avg = volumes.reduce((a, v) => a + v.ratio, 0) / volumes.length;
  const diff = volumes[0].ratio - avg;
  return Math.abs(diff) < 3 ? '공매도는 평소와 비슷해요' : `공매도는 평소보다 ${diff > 0 ? '늘었어요' : '줄었어요'}`;
}

export const recentFilings = (list: Filing[], now: number) => list.filter(f => now - f.date < 7 * 86400_000).length;

export function tickerHeadline(filings: Filing[] | null, volumes: ShortVolume[], now: number) {
  const parts = [filings ? `이번 주 새 공시 ${recentFilings(filings, now)}건` : null, shortTrend(volumes)];
  return parts.filter(Boolean).join(',\n') || '데이터를 확인하고 있어요';
}
