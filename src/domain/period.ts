/** Trade-list period filter. `anchor` is a YYYY-MM month; dates are compared as YYYY-MM-DD prefixes. */
export type Period = 'all' | 'year' | 'month';

export const periodPrefix = (period: Period, anchor: string) => (period === 'month' ? anchor : period === 'year' ? anchor.slice(0, 4) : '');

export function shiftPeriod(period: Period, anchor: string, n: number): string {
  const [y, m] = anchor.split('-').map(Number);
  return new Date(Date.UTC(period === 'year' ? y + n : y, period === 'year' ? m - 1 : m - 1 + n, 1)).toISOString().slice(0, 7);
}

export const periodLabel = (period: Period, anchor: string) =>
  period === 'month' ? `${Number(anchor.slice(0, 4))}년 ${Number(anchor.slice(5, 7))}월` : `${anchor.slice(0, 4)}년`;

/** The period containing `today` (YYYY-MM-DD): there is nothing newer to step to. */
export const isLatestPeriod = (period: Period, anchor: string, today: string) =>
  period === 'month' ? anchor >= today.slice(0, 7) : anchor.slice(0, 4) >= today.slice(0, 4);
