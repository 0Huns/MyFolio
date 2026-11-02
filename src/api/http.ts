import { AppError, HttpError } from '../utils/errors';
import { str } from '../utils/parse';


export type Resp = { json: any; headers: Headers };

export async function http(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; timeout?: number } = {},
): Promise<Resp> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 30_000);
  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? 'GET', headers: opts.headers, body: opts.body, signal: ctrl.signal });
  } catch (e: any) {
    throw new AppError(
      e?.name === 'AbortError' ? '서버 응답 시간이 초과되었습니다. 나중에 다시 시도해 주세요.' : `네트워크 오류: ${e?.message ?? e}`,
    );
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (res.status >= 400) {
    let code = '';
    try { const body = JSON.parse(text); code = str(body.error?.code ?? body.error); } catch {}
    throw new HttpError(res.status === 429 ? 'API 사용량 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.'
      : `HTTP ${res.status} ${url.split('/')[2]}: ${text.slice(0, 500)}`, res.status, res.headers, code);
  }
  let json: any = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { json, headers: res.headers };
}

export function query(items: [string, string][]): string {
  return items.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

export const url = (base: string, path: string, items: [string, string][] = []) =>
  base + path + (items.length ? '?' + query(items) : '');
