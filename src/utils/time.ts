export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// MARK: dates (all broker dates are KST, UTC+9, no DST)

const KST = 9 * 3600_000;
export const DAY = 86400_000;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Formats a timestamp in KST. Tokens: yyyy MM dd HH mm ss */
export function fmtKST(t: number, f = 'yyyy-MM-dd'): string {
  const d = new Date(t + KST);
  return f
    .replace('yyyy', String(d.getUTCFullYear()))
    .replace('MM', pad(d.getUTCMonth() + 1))
    .replace('dd', pad(d.getUTCDate()))
    .replace('HH', pad(d.getUTCHours()))
    .replace('mm', pad(d.getUTCMinutes()))
    .replace('ss', pad(d.getUTCSeconds()));
}

/** Parses compact KST strings like 20250102, 20250102153000, "2025-01-02 15:30:00". */
export function parseKST(s: string): number | null {
  const d = s.replace(/\D/g, '');
  if (d.length < 8) return null;
  const y = +d.slice(0, 4), mo = +d.slice(4, 6), da = +d.slice(6, 8);
  const h = +(d.slice(8, 10) || 0), mi = +(d.slice(10, 12) || 0), se = +(d.slice(12, 14) || 0);
  const t = Date.UTC(y, mo - 1, da, h, mi, se) - KST;
  return Number.isFinite(t) ? t : null;
}

export function parseISO(s: string): number | null {
  if (!s) return null;
  // No zone → KST
  const hasZone = /Z$|[+-]\d{2}:?\d{2}$/.test(s);
  const t = Date.parse(hasZone ? s : s.slice(0, 19) + '+09:00');
  return Number.isFinite(t) ? t : null;
}

export const startOfDayKST = (t: number) => Math.floor((t + KST) / DAY) * DAY - KST;
export const weekdayKST = (t: number) => new Date(t + KST).getUTCDay();
export const isoUTC = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
