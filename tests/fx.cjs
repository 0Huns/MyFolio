const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path, requireFn = () => ({})) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText, {exports, require:requireFn, Date, Number, Object, Map, Set, Error, AbortController, encodeURIComponent, setTimeout, clearTimeout});
  return exports;
}
const models = load('src/domain/models.ts');
const calc = load('src/domain/calculator.ts', () => models);
const dates = load('src/domain/marketTime.ts');
const fx = { ...dates, ...load('src/api/exim.ts', () => dates) };
const trade = (id, side, date, price, accountId='a', quantity=1) => ({id, side, date:Date.parse(date+'T12:00:00+09:00'),price,accountId,quantity,fee:0,tax:0,market:'us',assetType:'stock',ticker:'TEST'});
const rates={'2026-10-01':1000,'2026-10-02':1200,'2026-10-05':1300};
const getRate=t=>rates[fx.fxDay(t.date)];
const trades=[trade('buy','buy','2026-10-01',100),trade('sell','sell','2026-10-02',100)];
assert.equal(calc.realizedByTrade(trades).sell,0);
assert.equal(calc.realizedByTrade(trades,getRate).sell,20000,'unchanged USD price realizes FX gain in KRW');
assert.equal(calc.realizedByTrade(trades,()=>undefined).sell,null,'missing FX is not zero profit');
assert.equal(calc.realizedByTrade([trades[0],{...trades[1],accountId:'b'}],getRate).sell,null,'accounts never share cost basis');
const partial=[trade('b1','buy','2026-10-01',100),trade('b2','buy','2026-10-02',100),trade('s1','sell','2026-10-05',100),trade('s2','sell','2026-10-05',100)];
assert.equal(calc.realizedByTrade(partial,getRate).s1,20000,'weighted historical KRW cost retained on partial sale');
assert.equal(calc.realizedByTrade(partial,getRate).s2,20000);
assert.equal(calc.realizedByTrade([{...trades[0],fee:1},{...trades[1],fee:1,tax:0.5}],getRate).sell,17200,'buy and sell costs use their own fixing');
assert.equal(fx.fxDay(Date.parse('2026-10-01T15:00:00Z')),'2026-10-02','date uses KST');
assert.equal(fx.usTradeDay(Date.parse('2026-10-29T22:30:00-04:00')),'2026-10-30','EDT: after NY 20:00 belongs to the next trading day');
assert.equal(fx.usTradeDay(Date.parse('2026-10-29T19:59:00-04:00')),'2026-10-29');
assert.equal(fx.usTradeDay(Date.parse('2026-12-01T19:59:00-05:00')),'2026-12-01','EST');
assert.equal(fx.usTradeDay(Date.parse('2026-12-01T20:00:00-05:00')),'2026-12-02');
assert.equal(fx.usSessionStart(Date.parse('2026-10-30T10:10:00+09:00')),Date.parse('2026-10-29T20:00:00-04:00'),'day market: trading day began NY 20:00 previous day');
assert.equal(fx.usSessionStart(Date.parse('2026-10-31T12:00:00+09:00')),Date.parse('2026-10-29T20:00:00-04:00'),'weekend uses Friday session');
assert.equal(fx.usSessionStart(Date.parse('2026-12-02T10:00:00+09:00')),Date.parse('2026-12-01T20:00:00-05:00'),'EST');
// Shares gone without a listed sale, reconciled with broker holdings: dropped (cost kept) before the sale that would leave
// exactly the excess, so that sale closes the position, as Toss's 판매수익 shows.
{const T=(id,side,day,q,p)=>({id,side,date:Date.parse(day+'T12:00:00+09:00'),price:p,quantity:q,accountId:'a',fee:0,tax:0,market:'us',assetType:'stock',ticker:'TSTC'});
const h=[T('b1','buy','2026-08-01',100,2),T('s1','sell','2026-08-04',60,2),T('b2','buy','2026-09-16',50,1),T('s2','sell','2026-09-16',50,0.9),T('b3','buy','2026-09-29',1,1)];
const raw=calc.saleResults(h),fixed=calc.saleResults(h,()=>1,()=>1);
assert(Math.abs(raw.s2.cost-(50*(40*2+50*1)/90))<1e-9,'without holdings the phantom 40 shares raise the cost');
assert.equal(fixed.s1.cost,200,'the closing sale carries the full cost of the vanished shares');assert(Math.abs(fixed.s1.profit-(60*2-200))<1e-9);
assert.equal(fixed.s2.cost,50,'later sale averages only real lots');
const none=calc.saleResults(h,()=>1,()=>undefined);assert.equal(none.s2.cost,raw.s2.cost,'unknown holdings: no reconciliation');}
console.log('PASS: trade-date FX calculation, partial sales, fees, missing rates, account isolation, KST.');

(async () => {
  const now = Date.parse('2026-10-29T12:00:00+09:00');
  const usd = rate => [{result:1,cur_unit:'USD',deal_bas_r:'999',kftc_deal_bas_r:rate}];
  const response = body => ({ok:true,json:async()=>body});
  let calls = [];
  const request = async url => { calls.push(url); return response(calls.length === 1 ? null : usd('1,336.30')); };
  const result = await fx.fetchEximFixing('dummy-key', undefined, now, request);
  assert.equal(result.date, '2026-10-28');
  assert.equal(result.rate, 1336.3, 'use KFTC fixing, not bank deal_bas_r');
  assert.equal(calls.length, 2);
  assert(calls[0].includes('searchdate=20261029'));
  let cachedCalls=0;
  const today = await fx.fetchEximFixing('dummy', {date:'2026-10-29',rate:1336.3}, now, async()=>{cachedCalls++;throw Error();});
  assert.equal(today.rate,1336.3); assert.equal(cachedCalls,0);
  for (const code of [3,4]) {
    let count=0;
    await assert.rejects(()=>fx.fetchEximFixing('dummy',undefined,now,async()=>{count++;return response([{result:code}]);}));
    assert.equal(count,1,'auth/quota errors must not retry previous days');
  }
  await assert.rejects(()=>fx.fetchEximFixing('dummy',undefined,now,async()=>response(usd('0'))));
  await assert.rejects(()=>fx.fetchEximFixing('dummy',undefined,now,async()=>{throw Error('secret-url-dummy');}), error=>!error.message.includes('secret-url'));
  let emptyCalls=0;
  await assert.rejects(()=>fx.fetchEximFixing('dummy',undefined,now,async()=>{emptyCalls++;return response([]);}));
  assert.equal(emptyCalls,10,'bounded 14 calendar days, skip weekends');
  console.log('PASS: EXIM daily fixing, fallback date, cache, invalid data, auth/quota stop, bounded calls, redacted errors.');
})().catch(error=>{console.error(error);process.exitCode=1;});
