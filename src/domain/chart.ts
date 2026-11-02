import type { Candle } from './models';
import { DAY, fmtKST, startOfDayKST, weekdayKST } from '../utils';

/** Detail chart bar type: 1/3/5-minute, day, week, month. Older bars load as the chart is scrolled left. */
export type ChartRange = 'm1' | 'm3' | 'm5' | 'd' | 'w' | 'mo';

/** Bar length in minutes for intraday types, 0 otherwise. */
export const barMinutes = (r: ChartRange) => (r === 'm1' ? 1 : r === 'm3' ? 3 : r === 'm5' ? 5 : 0);

/** Which bar a timestamp belongs to: clock-aligned N minutes, KST day / Monday-start week / month. */
export function barKey(r: ChartRange, t: number): number {
  const minutes = barMinutes(r);
  if (minutes) return Math.floor(t / (minutes * 60_000)); // KST offset is a whole number of 3/5-minute steps
  const day = startOfDayKST(t);
  if (r === 'd') return day;
  if (r === 'w') return day - ((weekdayKST(t) + 6) % 7) * DAY;
  const d = new Date(t + 9 * 3600_000);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** Merge source bars into `r` bars; each bar keeps the start time of its first source bar. */
export function groupBars(rows: Candle[], r: ChartRange): Candle[] {
  if (r === 'm1' || r === 'd') return rows;
  const out: Candle[] = [];
  let key = NaN;
  for (const row of rows) {
    const k = barKey(r, row.t);
    const last = out[out.length - 1];
    if (last && k === key) {
      last.h = Math.max(last.h, row.h);
      last.l = Math.min(last.l, row.l);
      last.c = row.c;
    } else {
      out.push({ ...row, t: barMinutes(r) ? k * barMinutes(r) * 60_000 : row.t });
      key = k;
    }
  }
  return out;
}

export type ChartTick = { p: number; hi: number; lo: number; t: number };

/** Fold buffered ticks into the last bar, or open a new bar once the tick falls in the next minute/day/week/month bar. */
export function applyTick(cs: Candle[], tick: ChartTick, range: ChartRange): Candle[] {
  const last = cs[cs.length - 1];
  if (!last || tick.t < last.t) return cs;
  // Daily bars: US sessions cross KST midnight, so "same bar" is "within 20 h" rather than the same KST date.
  const sameBar = range === 'd' ? tick.t - last.t < 20 * 3600_000 : barKey(range, tick.t) === barKey(range, last.t);
  if (sameBar) return [...cs.slice(0, -1), { ...last, h: Math.max(last.h, tick.hi), l: Math.min(last.l, tick.lo), c: tick.t >= (last.liveAt ?? 0) ? tick.p : last.c, liveAt: Math.max(last.liveAt ?? 0, tick.t) }];
  const m = barMinutes(range);
  const t = m ? barKey(range, tick.t) * m * 60_000 : tick.t;
  return [...cs, { t, o: tick.p, h: tick.hi, l: tick.lo, c: tick.p, liveAt: tick.t }];
}

/** Preserve minute boundaries even when multiple ticks arrive during a single display frame. */
export function applyTicks(rows: Candle[], ticks: ChartTick[], range: ChartRange): Candle[] {
  return [...ticks].sort((a, b) => a.t - b.t).reduce((cs, tick) => applyTick(cs, tick, range), rows);
}

/** Authoritative recent candles repair missed frames/late reports; replay ticks received during the request. */
export function mergeChartSnapshot(existing: Candle[], snapshot: Candle[], ticks: ChartTick[], range: ChartRange, now = Date.now()): Candle[] {
  const byTime = new Map(existing.map(row => [row.t, row]));
  for (const row of snapshot) {
    const live = byTime.get(row.t);
    // REST candles have no last-trade timestamp. Do not rewind the active candle's known live close.
    // Completed candles remain authoritative so delayed reports can repair history.
    if (barMinutes(range) && live?.liveAt != null && barKey(range, row.t) === barKey(range, now)) {
      byTime.set(row.t, { ...row, h: Math.max(row.h, live.h), l: Math.min(row.l, live.l), c: live.c, liveAt: live.liveAt });
    } else byTime.set(row.t, row);
  }
  return applyTicks([...byTime.values()].sort((a, b) => a.t - b.t), ticks, range);
}

/**
 * Fill minutes without trades with flat bars at the previous close (Toss omits US 1-minute bars that had no trade;
 * KR bars already come filled). Gaps longer than `maxGapMs` (overnight, weekends) stay empty.
 */
export function fillGaps(rows: Candle[], intervalMs: number, maxGapMs = 6 * 3600_000): Candle[] {
  if (!(intervalMs > 0) || rows.length < 2) return rows;
  const out: Candle[] = [rows[0]];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], bar = rows[i];
    const gap = bar.t - prev.t;
    if (gap > intervalMs && gap <= maxGapMs) {
      for (let t = prev.t + intervalMs; t < bar.t; t += intervalMs) out.push({ t, o: prev.c, h: prev.c, l: prev.c, c: prev.c });
    }
    out.push(bar);
  }
  return out;
}

/** Bar date/time as shown under the crosshair. */
export const barLabel = (range: ChartRange, t: number) =>
  barMinutes(range) > 0 ? fmtKST(t, 'MM.dd HH:mm') : range === 'mo' ? fmtKST(t, 'yyyy.MM') : fmtKST(t, 'yyyy.MM.dd');
