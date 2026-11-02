import { Filing, ShortInterest, ShortVolume } from '../domain/models';
import { AppError, DAY, dict, fmtKST, list, num, sleep, str } from '../utils';
import { http } from './http';

/**
 * US equity data from public sources:
 *  - SEC EDGAR: company filings (8-K, 10-Q, Form 4 …)
 *  - FINRA: daily short-sale volume (Reg SHO) and bi-monthly short interest
 * SEC requires a User-Agent containing a contact e-mail.
 */

const secHeaders = (contact: string) => ({
  'User-Agent': `MyFolio ${contact || 'myfolio-user@example.com'}`,
  Accept: 'application/json',
});

let tickerMap: Record<string, { cik: string; title: string }> | null = null;

export async function loadTickerMap(contact: string) {
  if (tickerMap) return tickerMap;
  const { json } = await http('https://www.sec.gov/files/company_tickers.json', { headers: secHeaders(contact) });
  if (typeof json !== 'object') throw new AppError('SEC 종목 목록을 불러오지 못했습니다. 설정에서 SEC 연락처 이메일을 입력해 주세요.');
  const m: Record<string, { cik: string; title: string }> = {};
  for (const r of Object.values(dict(json)) as any[]) {
    m[str(r.ticker).toUpperCase()] = { cik: String(r.cik_str).padStart(10, '0'), title: str(r.title) };
  }
  tickerMap = m;
  return m;
}

export async function companyName(ticker: string, contact: string): Promise<string | null> {
  const m = await loadTickerMap(contact);
  return m[ticker.toUpperCase()]?.title ?? null;
}

/** Recent filings for one ticker (newest first). */
export async function filings(ticker: string, contact: string, limit = 40): Promise<Filing[]> {
  const m = await loadTickerMap(contact);
  const entry = m[ticker.toUpperCase().replace('.', '-')] ?? m[ticker.toUpperCase()];
  if (!entry) throw new AppError(`${ticker}: SEC에 등록된 종목을 찾을 수 없습니다.`);
  const { json } = await http(`https://data.sec.gov/submissions/CIK${entry.cik}.json`, { headers: secHeaders(contact) });
  const r = dict(dict(json).filings).recent ?? {};
  const out: Filing[] = [];
  const n = Math.min(limit, (r.form ?? []).length);
  for (let i = 0; i < n; i++) {
    out.push({
      cik: entry.cik,
      ticker: ticker.toUpperCase(),
      form: str(r.form[i]),
      date: Date.parse(str(r.acceptanceDateTime?.[i]) || str(r.filingDate[i])) || Date.parse(str(r.filingDate[i])),
      accession: str(r.accessionNumber[i]),
      doc: str(r.primaryDocument[i]),
      description: str(r.primaryDocDescription?.[i]),
    });
  }
  return out;
}


const dailyCache: Record<string, Record<string, { short: number; total: number }>> = {};

/** FINRA Reg SHO consolidated daily short volume for the last `days` trading days. */
export async function shortVolume(tickers: string[], days = 10): Promise<Record<string, ShortVolume[]>> {
  const want = new Set(tickers.map(t => t.toUpperCase()));
  const out: Record<string, ShortVolume[]> = {};
  // US dates: walk back from yesterday (New York), skipping weekends and missing (holiday) files.
  let t = Date.now() - 5 * 3600_000;
  let found = 0, tries = 0;
  while (found < days && tries < days * 2 + 6) {
    tries++;
    const d = new Date(t);
    t -= DAY;
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    let table = dailyCache[ymd];
    if (!table) {
      try {
        const { json } = await http(`https://cdn.finra.org/equity/regsho/daily/CNMSshvol${ymd}.txt`, { timeout: 30_000 });
        if (typeof json !== 'string' || !json.startsWith('Date|')) continue;
        table = {};
        for (const line of json.split('\n').slice(1)) {
          const c = line.split('|');
          if (c.length >= 5) table[c[1]] = { short: num(c[2]), total: num(c[4]) };
        }
        dailyCache[ymd] = table;
      } catch {
        continue;
      }
      await sleep(100);
    }
    found++;
    for (const s of want) {
      const row = table[s];
      if (!row) continue;
      (out[s] ??= []).push({ date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6)}`, short: row.short, total: row.total, ratio: row.total > 0 ? (row.short / row.total) * 100 : 0 });
    }
  }
  return out;
}


/**
 * Shares outstanding from the latest filing's cover page. Null when the company has no single figure:
 * SEC serves none for several share classes (e.g. GOOGL), funds and ETFs.
 */
export async function sharesOutstanding(ticker: string, contact: string): Promise<number | null> {
  const map = await loadTickerMap(contact);
  const entry = map[ticker.toUpperCase()];
  if (!entry) return null;
  try {
    const { json } = await http(`https://data.sec.gov/api/xbrl/companyconcept/CIK${entry.cik}/dei/EntityCommonStockSharesOutstanding.json`, { headers: secHeaders(contact) });
    const rows = list(dict(dict(json).units).shares).sort((a, b) => str(b.end).localeCompare(str(a.end)));
    return rows.length ? num(rows[0].val) || null : null;
  } catch {
    return null;
  }
}

/** FINRA consolidated short interest (settles twice a month). */
export async function shortInterest(ticker: string): Promise<ShortInterest[]> {
  const end = Date.now();
  const { json } = await http('https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      limit: 50,
      compareFilters: [{ compareType: 'equal', fieldName: 'symbolCode', fieldValue: ticker.toUpperCase() }],
      dateRangeFilters: [{ fieldName: 'settlementDate', startDate: fmtKST(end - 365 * DAY), endDate: fmtKST(end) }],
    }),
  });
  return list(json)
    .map(r => ({
      date: str(r.settlementDate),
      shares: num(r.currentShortPositionQuantity),
      change: num(r.changePreviousNumber),
      changePct: num(r.changePercent),
      daysToCover: num(r.daysToCoverQuantity),
      avgVolume: num(r.averageDailyVolumeQuantity),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
