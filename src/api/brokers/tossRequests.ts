import { HttpError, sleep } from '../../utils';
import { Resp, http } from '../http';

// Official groups, not per endpoint. ORDER_INFO uses the stricter opening-session limit.
const groups: Record<string, [string, number]> = {
  '/oauth2/token': ['AUTH', 5],
  '/api/v1/accounts': ['ACCOUNT', 1],
  '/api/v1/holdings': ['ASSET', 5],
  '/api/v1/stocks': ['STOCK', 5],
  '/api/v1/exchange-rate': ['MARKET_INFO', 3],
  '/api/v1/prices': ['MARKET_DATA', 15],
  '/api/v1/candles': ['MARKET_DATA_CHART', 20],
  '/api/v1/orders': ['ORDER_HISTORY', 5],
  '/api/v1/buying-power': ['ORDER_INFO', 3],
  '/api/v1/commissions': ['ORDER_INFO', 3],
};
type Gate = { tail: Promise<void>; next: number; limit: number };
const clients = new Map<string, Map<string, Gate>>();
const streams = new Map<string, { tail: Promise<void>; next: number }>();

export async function waitForTossStream(clientId: string): Promise<void> {
  let gate = streams.get(clientId);
  if (!gate) { gate = { tail: Promise.resolve(), next: 0 }; streams.set(clientId, gate); }
  const g = gate;
  const task = g.tail.then(async () => {
    if (g.next > Date.now()) await sleep(g.next - Date.now());
    g.next = Date.now() + 500;
  });
  g.tail = task;
  await task;
}

function seconds(value: string | null): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n * 1000) : Math.max(0, Date.parse(value) - Date.now()) || 0;
}

/** Shared across provider instances. Two-device headroom is not a distributed quota guarantee. */
export async function tossRequest(clientId: string, path: string, target: string, opts: Parameters<typeof http>[1]): Promise<Resp> {
  const [group, ceiling] = groups[path] ?? ['UNKNOWN', 1];
  let client = clients.get(clientId);
  if (!client) { client = new Map(); clients.set(clientId, client); }
  let gate = client.get(group);
  if (!gate) { gate = { tail: Promise.resolve(), next: 0, limit: ceiling }; client.set(group, gate); }
  const g = gate;
  // Queue each attempt separately: a delayed retry cannot bypass another response's cooldown.
  for (let attempt = 0; ; attempt++) {
    const task = g.tail.then(async () => {
      while (g.next > Date.now()) await sleep(g.next - Date.now());
      const started = Date.now();
      g.next = started + 2000 / g.limit;
      const update = (headers: Headers) => {
        const limit = Number(headers.get('X-RateLimit-Limit'));
        if (limit > 0) g.limit = Math.min(ceiling, limit);
        g.next = Math.max(g.next, started + 2000 / g.limit);
        if (headers.get('X-RateLimit-Remaining') === '0') {
          g.next = Math.max(g.next, Date.now() + seconds(headers.get('X-RateLimit-Reset')) + 100);
        }
      };
      try {
        const result = await http(target, opts);
        update(result.headers);
        return result;
      } catch (e) {
        if (e instanceof HttpError) {
          update(e.headers);
          if (e.status === 429 || e.status >= 500) {
            g.next = Math.max(g.next, Date.now() + Math.max(seconds(e.headers.get('Retry-After')), 1000 * 2 ** attempt) + Math.random() * 250);
          }
        }
        throw e;
      }
    });
    g.tail = task.then(() => {}, () => {});
    try { return await task; } catch (e) {
      // Token issuance is not idempotent: never repeat after an ambiguous server/network failure.
      const retryable = e instanceof HttpError && (e.status === 429 || (opts?.method !== 'POST' && e.status >= 500));
      if (!retryable || attempt >= 2) throw e;
    }
  }
}
