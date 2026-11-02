import { fxDay } from '../domain/marketTime';

export class EximAuthError extends Error {}
export type Fixing = { date: string; rate: number };

/** Only documented JSON API calls; never fetch or parse exchange-rate web pages. */
export async function fetchEximFixing(key: string, cached?: Fixing, now = Date.now(), request: typeof fetch = fetch): Promise<Fixing> {
  for (let back = 0; back < 14; back++) {
    const date = fxDay(now - back * 86400000);
    if (cached?.date === date) return cached;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let data: unknown;
    try {
      const response = await request(`https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=${encodeURIComponent(key)}&searchdate=${date.replace(/-/g, '')}&data=AP01`, { signal: controller.signal });
      if (!response.ok) throw new Error(`환율 서버 HTTP ${response.status}`);
      data = await response.json();
    } catch {
      // Native network errors may contain the request URL (including the key).
      throw new Error('수출입은행 연결 실패 · 네트워크 또는 서버 응답을 확인해주세요');
    } finally { clearTimeout(timer); }
    if (data == null || (Array.isArray(data) && !data.length)) continue;
    const rows = Array.isArray(data) ? data : [data];
    for (const row of rows) {
      const code = Number(row?.result);
      if (code === 3) throw new EximAuthError('수출입은행 인증키가 유효하지 않습니다');
      if (code === 4) throw new Error('수출입은행 일일 요청 한도를 초과했습니다');
      if (code !== 1) throw new Error('수출입은행 요청 오류 · 인증키와 API 이용 권한을 확인해주세요');
    }
    const usd = rows.find(row => row.cur_unit === 'USD');
    const raw = usd?.kftc_deal_bas_r;
    const rate = typeof raw === 'string' || typeof raw === 'number' ? Number(String(raw).replace(/,/g, '')) : NaN;
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('수출입은행 USD 매매기준율이 올바르지 않습니다');
    return { date, rate };
  }
  throw new Error('최근 14일의 수출입은행 환율 데이터가 없습니다');
}
