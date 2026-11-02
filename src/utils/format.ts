import { fmtKST } from './time';


function group(n: number, digits = 0): string {
  const [i, f] = Math.abs(n).toFixed(digits).split('.');
  return (n < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : '');
}

/**
 * Display currency for portfolio amounts. Amounts are kept in KRW everywhere; `Fmt.krw` / `signedKRW` / `compact`
 * convert at the current USD/KRW rate when the user picks dollars. Quote prices (`Fmt.price`) keep their own currency.
 */
const display = { usd: false, usdKrw: 1400 };
export function setDisplayCurrency(currency: 'krw' | 'usd', usdKrw: number) {
  display.usd = currency === 'usd';
  if (usdKrw > 0) display.usdKrw = usdKrw;
}

/** Dollar account amounts retain cents at every magnitude. */
function dollars(krw: number): string {
  const v = krw / display.usdKrw;
  return (v < 0 ? '-$' : '$') + group(Math.abs(v), 2);
}

export const Fmt = {
  // Toss shows KRW amounts with sub-won digits discarded (toward zero), e.g. 14.69원 → 14원, −172.3원 → −172원.
  krw: (v: number, hidden = false) =>
    !Number.isFinite(v) ? '미확인' : display.usd ? (hidden ? '$••••••' : dollars(v)) : hidden ? '••••••원' : group(Math.trunc(v)) + '원',
  signedKRW: (v: number, hidden = false) =>
    !Number.isFinite(v) ? '미확인' : display.usd ? (hidden ? '$••••••' : (v > 0 ? '+' : '') + dollars(v)) : hidden ? '••••••원' : (v > 0 ? '+' : '') + group(Math.trunc(v)) + '원',
  /** A price in its native currency `c`, shown in the display currency (converted at the current rate when they differ). */
  price(v: number, c: 'krw' | 'usd') {
    if (!Number.isFinite(v)) return '미확인';
    let val = v, cur = c;
    if (display.usd && c === 'krw') { val = v / display.usdKrw; cur = 'usd'; }
    // Toss WTS displays converted stock prices with sub-won digits discarded.
    // Keep the underlying quote and portfolio valuation precision unchanged.
    else if (!display.usd && c === 'usd') return group(Math.trunc(v * display.usdKrw)) + '원';
    if (cur === 'usd') return (val < 0 ? '-$' : '$') + group(Math.abs(val), Math.abs(val) < 1 ? 4 : 2);
    return group(val, Math.abs(val) < 100 && val % 1 !== 0 ? 4 : 0) + '원';
  },
  /** Like `price`, with a leading + for gains (P&L amounts). */
  signedPrice: (v: number, c: 'krw' | 'usd') => (v > 0 ? '+' : '') + Fmt.price(v, c),
  qty: (v: number) => (v % 1 === 0 ? group(v) : group(v, 8).replace(/0+$/, '').replace(/\.$/, '')),
  pct: (v: number) => !Number.isFinite(v) ? '미확인' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`,
  date: (t: number) => fmtKST(t, 'yyyy-MM-dd'),
  dateTime: (t: number) => fmtKST(t, 'yyyy-MM-dd HH:mm'),
  compact(v: number) {
    if (display.usd) {
      const d = v / display.usdKrw;
      if (Math.abs(d) >= 1e6) return '$' + (d / 1e6).toFixed(1) + 'M';
      if (Math.abs(d) >= 1e3) return '$' + Math.round(d / 1e3) + 'K';
      return '$' + Math.round(d);
    }
    if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(1) + '억';
    if (Math.abs(v) >= 1e4) return Math.round(v / 1e4) + '만';
    return String(Math.round(v));
  },
  big(v: number) {
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(Math.round(v));
  },
};
