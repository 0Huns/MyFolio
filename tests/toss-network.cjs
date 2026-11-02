// Runs actual TypeScript modules with an isolated clock/network/keychain. No API credentials used.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
let now = 1000000;
class Clock extends Date { static now() { return now; } }
const sleep = async ms => { now += ms; };
const timers = new Map();
let timerId = 0;
const setTimer = (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; };
const clearTimer = id => timers.delete(id);
const sockets = [];
class WS {
  constructor() { this.readyState = 1; this.sent = []; sockets.push(this); }
  send(value) { this.sent.push(value); }
  close() { this.readyState = 3; this.onclose?.(); }
}
function load(file, imports, extra = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => imports[name] || {}, Date: Clock, Math: Object.assign(Object.create(Math), { random: () => 0 }), Headers, AbortController, console, WebSocket: WS, setTimeout: setTimer, clearTimeout: clearTimer, setInterval: setTimer, clearInterval: clearTimer, ...extra });
  return exports;
}
const util = require('./helpers.cjs').loadUtils((file, imports) => load(file, imports, { fetch: async () => ({ status: 429, headers: new Headers({ 'Retry-After': '3' }), text: async () => '{"error":{"code":"rate-limit-exceeded"}}' }) }));
let responses = [], calls = [];
const http = async (url, opts) => {
  calls.push({ at: now, url, opts });
  const next = responses.shift();
  if (next instanceof util.HttpError) throw next;
  return next || { json: {}, headers: new Headers() };
};
const requests = load('src/api/brokers/tossRequests.ts', { '../../utils': { ...util, sleep }, '../http': { ...util, http } });
const run = (id, path, opts = {}) => requests.tossRequest(id, path, path, opts);
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
(async () => {
  await assert.rejects(util.http('https://example.test'), e => e instanceof util.HttpError && e.status === 429 && e.code === 'rate-limit-exceeded' && e.headers.get('Retry-After') === '3');
  calls = [];
  await Promise.all(Array.from({ length: 8 }, () => run('shared', '/api/v1/prices')));
  for (let i = 1; i < calls.length; i++) assert(calls[i].at - calls[i - 1].at >= 2000 / 15 - 0.001, 'shared rate spacing');
  calls = [];
  await Promise.all([run('order-info-shared','/api/v1/buying-power'),run('order-info-shared','/api/v1/commissions')]);
  assert(calls[1].at-calls[0].at >= 2000/3-0.001,'commission query shares ORDER_INFO rate limit with buying power');
  calls = [];
  responses = [new util.HttpError('limited', 429, new Headers({ 'Retry-After': '3', 'X-RateLimit-Limit': '1', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '1' }), 'rate-limit-exceeded')];
  await run('limited', '/api/v1/prices');
  assert.equal(calls.length, 2); assert(calls[1].at - calls[0].at >= 3000);
  await run('limited', '/api/v1/prices');
  assert(calls[2].at - calls[1].at >= 2000, 'learned limit applies to later requests');
  calls = []; responses = Array.from({ length: 3 }, () => new util.HttpError('server', 503, new Headers(), 'internal-error'));
  await assert.rejects(run('bounded', '/api/v1/prices')); assert.equal(calls.length, 3);
  calls = []; responses = [new util.HttpError('server', 503, new Headers(), 'internal-error')];
  await assert.rejects(run('auth', '/oauth2/token', { method: 'POST' })); assert.equal(calls.length, 1, 'ambiguous issuance must not retry');
  calls = []; responses = [new util.HttpError('denied', 403, new Headers(), 'ip-not-allowed')];
  await assert.rejects(run('denied', '/api/v1/prices')); assert.equal(calls.length, 1);

  const saved = new Map(); let issued = 0, apiCalls = 0, failCode = '', candleAbort;
  const keychain = { token: async id => saved.get(id) || null, saveToken: async (id, t) => saved.set(id, t), dropToken: async id => saved.delete(id) };
  const transport = async (id, path) => {
    if (path === '/oauth2/token') { issued++; await Promise.resolve(); return { json: { access_token: 'token' + issued, expires_in: 3600 } }; }
    apiCalls++;
    if (failCode) throw new util.HttpError(failCode, 401, new Headers(), failCode);
    if (path === '/api/v1/candles') { candleAbort.abort(); return { json: { items: [], nextBefore: 'next' } }; }
    return { json: { items: [{ symbol: 'AAPL', lastPrice: '10' }] } };
  };
  const toss = load('src/api/brokers/toss.ts', { '../../utils': { ...util, sleep }, '../http': util, '../../platform/native': { Keychain: keychain, Native: { base64: async s => s } }, './tossRequests': { tossRequest: transport, waitForTossStream: async () => {} } });
  const a = new toss.TossProvider({ id: 'a' }, { key: 'shared', secret: 'test' });
  const b = new toss.TossProvider({ id: 'a' }, { key: 'shared', secret: 'test' });
  await Promise.all([a.token(), b.token(), a.token()]); assert.equal(issued, 1, 'single token issuance across instances');
  apiCalls = 0;
  await Promise.all([a.prices(['AAPL']), b.prices(['AAPL'])]); assert.equal(apiCalls, 1, 'same query coalesced');
  failCode = 'token-revoked'; await assert.rejects(a.prices(['AAPL']), /token-revoked/);
  const before = apiCalls;
  await assert.rejects(b.prices(['AAPL']), /token-revoked/); assert.equal(apiCalls, before); assert.equal(issued, 1, 'revocation must not create cross-device issuance loop');
  failCode = '';
  const c = new toss.TossProvider({ id: 'c' }, { key: 'other', secret: 'test' });
  candleAbort = new AbortController(); apiCalls = 0;
  await c.candles('AAPL', '1m', 1000, undefined, candleAbort.signal); assert.equal(apiCalls, 1, 'cancel stops pagination');
  let expCalls = 0;
  const exp = load('src/api/brokers/toss.ts', { '../../utils': { ...util, sleep }, '../http': util, '../../platform/native': { Keychain: keychain, Native: { base64: async s => s } }, './tossRequests': { tossRequest: async (...args) => { if (args[1] !== '/oauth2/token' && expCalls++ === 0) throw new util.HttpError('expired', 401, new Headers(), 'expired-token'); return transport(...args); } } });
  saved.set('expiry', 'old'); const expired = new exp.TossProvider({ id: 'expiry' }, { key: 'expiry', secret: 'test' });
  const nIssued = issued; await expired.prices(['AAPL']); assert.equal(issued, nIssued + 1); assert.equal(expCalls, 2);

  let failUSD = false;
  let netValue = '1740.00';
  let failCommission = false;
  let commissionRows = [{marketCountry:'US',commissionRate:'0.001',startDate:null,endDate:null}];
  const currencies = [];
  const cashModule = load('src/api/brokers/toss.ts', {
    '../../utils': { ...util, sleep }, '../http': util,
    '../../platform/native': { Keychain: { token: async () => 'cash-token' } },
    './tossRequests': { tossRequest: async (_, path, target) => {
      if (path === '/api/v1/accounts') return { json: { items: [{ accountType: 'BROKERAGE', accountSeq: '1' }] } };
      if (path === '/api/v1/commissions') { if(failCommission) throw new Error('unavailable'); return {json:{result:commissionRows}}; }
      if (path === '/api/v1/exchange-rate') return { json: { rate: '1380.5', midRate: '1375' } };
      if (path === '/api/v1/stocks') return { json: { items: [{ symbol: 'WFF', name: 'WF 홀딩', market: 'NASDAQ' }] } };
      if (path === '/api/v1/orders') {
        const o = (id, status, qty) => ({ orderId: id, symbol: 'WFF', side: 'SELL', status, orderedAt: '2026-10-20T10:00:00+09:00', execution: { filledQuantity: String(qty), averageFilledPrice: '1.5', filledAmount: String(qty * 1.5), commission: '0.01', tax: '0', filledAt: '2026-10-20T10:01:00+09:00' } });
        return { json: { orders: [o('full', 'FILLED', 10), o('part-cancel', 'CANCELED', 4), o('part-replace', 'REPLACED', 2), o('part-reject', 'REJECTED', 1),
          o('none-cancel', 'CANCELED', 0), o('cancel-rej', 'CANCEL_REJECTED', 4), o('replace-rej', 'REPLACE_REJECTED', 2)], hasNext: false } };
      }
      if (path === '/api/v1/holdings') return { json: {totalPurchaseAmount:{krw:'0',usd:'2000.00'},marketValue:{amountAfterCost:{krw:'0',usd:'1740.01'}},profitLoss:{amountAfterCost:{krw:'0',usd:'-259.99'}}, items: [{symbol:'TSTA',marketCountry:'US',quantity:'10000',averagePurchasePrice:'0.2',lastPrice:'0.1749',marketValue:{amountAfterCost:netValue,purchaseAmount:'2000.00'},profitLoss:{amountAfterCost:'-260.00'},cost:{commission:'3',tax:null}}] } };
      const currency = new URL(target).searchParams.get('currency');
      currencies.push(currency);
      if (currency === 'USD' && failUSD) throw new util.HttpError('failed', 503, new Headers(), 'internal-error');
      return { json: { cashBuyingPower: currency === 'KRW' ? '11' : '100.50' } };
    } },
  });
  const cashProvider = new cashModule.TossProvider({ id: 'cash' }, { key: 'cash', secret: 'test' });
  assert.equal(await cashProvider.usdKrw(),1375,'valuation uses midRate rather than buy rate');
  const cash = await cashProvider.fetchBalance();
  assert.equal(cash.holdings[0].amountAfterCost,1740.00);assert(cash.holdings[0].valuationAt);
  assert.equal(cash.valuation.value.usd,1740.01,'broker aggregate retained without summing items');assert.equal(cash.holdings[0].purchaseAmount,2000.00);assert.equal(cash.holdings[0].profitAfterCost,-260.00);
  assert.equal(cash.holdings[0].valuationCommission.rate,0.001);
  assert.equal(cash.holdings[0].brokerCost.commission,3);assert.equal(cash.holdings[0].brokerCost.tax,0);
  const fills = await cashProvider.fetchTrades(0, Date.now(), () => {});
  assert.deepEqual(Array.from(fills, t => t.orderId).sort(), ['full', 'part-cancel', 'part-reject', 'part-replace'], 'partially filled canceled/replaced/rejected orders kept; unfilled and *_REJECTED records skipped');
  assert.equal(fills.find(t => t.orderId === 'part-cancel').quantity, 4);
  assert.equal(cash.cashKRW, 11); assert.equal(cash.cashUSD, 100.5);
  assert.deepEqual(currencies, ['KRW', 'USD']);
  failCommission=true;const noRate=await cashProvider.fetchBalance();assert.equal(noRate.holdings[0].amountAfterCost,1740.00);assert.equal(noRate.holdings[0].valuationCommission,undefined,'optional commission failure preserves balance');failCommission=false;
  commissionRows=[{marketCountry:'US',commissionRate:'0.9',endDate:'1900-01-01'},{marketCountry:'US',commissionRate:'0.8',startDate:'2999-01-01'},{marketCountry:'US',commissionRate:'NaN'}];
  assert.equal((await cashProvider.fetchBalance()).holdings[0].valuationCommission,undefined,'inactive or invalid schedules rejected');
  failUSD = true; await assert.rejects(cashProvider.fetchBalance(), /failed/, 'cash failure cannot produce zero balance');

  failUSD=false;netValue=undefined;await assert.rejects(cashProvider.fetchBalance(),/공제 후/,'missing net value must not replace valid balance with gross');

  timers.clear(); const statuses = [], ticks = [];
  const stream = new toss.TossTradeStream({ token: async () => 'x', prices: async () => ({}), reserveStream: async () => {} }, [{ market: 'us', symbol: 'AAPL' }], (...v) => ticks.push(v), (_, s) => statuses.push(s));
  const stop = stream.start(); await flush();
  const ws = sockets.at(-1); ws.onopen(); assert.equal(ws.sent.length, 1);
  ws.onmessage({ data: JSON.stringify({ type: 'subscriptions', subscribed: ['trade:us:AAPL'] }) });
  ws.onmessage({ data: JSON.stringify({ type: 'message', topic: 'trade:us:AAPL', data: { price: '42', timestamp: new Date(now).toISOString() } }) });
  assert.equal(ticks[0][1], 42, 'tick delivered without REST-rate delay');
  ws.onmessage({ data: '{"type":"error","error":{"code":"rate-limit-exceeded"}}' });
  const declaration = [...timers.values()].find(t => t.ms === 1100); assert(declaration); declaration.fn(); assert.equal(ws.sent.length, 2);
  ws.close(); assert.equal(statuses.at(-1), 'failed', 'REST fallback enabled during reconnect');
  const retry = [...timers.values()].find(t => t.ms === 800); assert(retry);
  stop(); const socketCount = sockets.length; retry.fn(); await flush(); assert.equal(sockets.length, socketCount, 'stop cancels reconnect');
  const blocked = new toss.TossTradeStream({ reserveStream: async () => {}, prices: async () => { throw new util.HttpError('denied', 403, new Headers(), 'ip-not-allowed'); } }, [{ market: 'us', symbol: 'AAPL' }], () => {}, () => {});
  blocked.start(); await flush(); assert.equal(sockets.length, socketCount); blocked.stop();
  console.log('PASS: HTTP metadata, group pacing, dynamic limits, Retry-After, bounded retries, no ambiguous token retry, coalesced auth/queries, revoked-token circuit, expired-token renewal, chart cancellation, immediate ticks, resubscription, fallback, stop/auth failure.');
})().catch(e => { console.error(e); process.exitCode = 1; });
