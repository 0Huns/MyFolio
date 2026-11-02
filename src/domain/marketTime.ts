/** Korean calendar date for existing trade records. No network access. */
export const fxDay = (at: number) => new Date(at + 9 * 3600000).toISOString().slice(0, 10);

/** US daylight time: second Sunday of March 07:00 UTC to first Sunday of November 06:00 UTC. */
function usDst(at: number): boolean {
  const y = new Date(at).getUTCFullYear();
  const sunday = (month: number, nth: number) => {
    const first = new Date(Date.UTC(y, month, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + (nth - 1) * 7;
  };
  return at >= Date.UTC(y, 2, sunday(2, 2), 7) && at < Date.UTC(y, 10, sunday(10, 1), 6);
}

/**
 * Toss US trading day (New York 20:00 → 20:00), whose fixing Toss uses for the KRW principal of a US trade.
 * Verified against Toss's KRW principal: moving average of quantity × price × this day's fixing, fees excluded.
 */
export const usTradeDay = (at: number) => new Date(at + ((usDst(at) ? -4 : -5) + 4) * 3600000).toISOString().slice(0, 10);

/**
 * Start (New York 20:00 of the previous day) of the current Toss US trading day; on weekends, of Friday's.
 * Toss measures today's change from the regular close of the trading day before it.
 */
export function usSessionStart(at: number): number {
  const day = new Date(`${usTradeDay(at)}T00:00:00Z`);
  const wd = day.getUTCDay();
  day.setUTCDate(day.getUTCDate() - (wd === 6 ? 1 : wd === 0 ? 2 : 0));
  const t = day.getTime();
  // Trading day D begins at D 00:00 in the NY+4h frame.
  return t - ((usDst(t) ? -4 : -5) + 4) * 3600000;
}
