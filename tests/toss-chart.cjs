const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
function load(path, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { exports, require: key => imports[key] || {}, Date, Map, Math, Promise, setTimeout, clearTimeout });
  return exports;
}
const util = require('./helpers.cjs').loadUtils(load);
const chart = load('src/domain/chart.ts', { '../utils': util });
const { chartAxis, chartTimeTicks } = load('src/domain/chartAxis.ts', {});
const at = time => Date.parse('2026-10-29T' + time + '+09:00');
let reply, target;
const { TossProvider } = load('src/api/brokers/toss.ts', {
  '../../utils': { ...util, sleep: async () => {} }, '../http': util,
  '../../platform/native': { Keychain: { token: async () => 'cached' } },
  './tossRequests': { tossRequest: async (_, path, url) => { target = url; return { json: reply }; } },
});
const provider = new TossProvider({ id: 'a' }, { key: 'test', secret: 'test' });
const raw = (time, o = 100, h = 102, l = 99, c = 101) => ({ timestamp: '2026-10-29T' + time + '+09:00', openPrice: o, highPrice: h, lowPrice: l, closePrice: c });
const tick = (time, p) => ({ t: at(time), p, hi: p, lo: p });
(async () => {
  util.setDisplayCurrency('krw',1375);assert.equal(util.Fmt.price(8,'usd'),'11,000원');
  util.setDisplayCurrency('usd',1375);assert.equal(util.Fmt.price(8,'usd'),'$8.00');
  assert.equal(util.Fmt.krw(3398.27*1375),'$3,398.27','USD valuations must retain cents');
  assert.equal(util.Fmt.signedKRW(-100.23*1375),'-$100.23');
  reply = { items: [raw('09:01:00')] };
  let rows = await provider.candles('AAPL', '1m', 1);
  assert.equal(rows[0].t, at('09:00:00'), 'Toss end timestamp normalized to internal start');
  rows = chart.applyTicks(rows, [tick('09:00:30', 105)], 'm1');
  assert.equal(rows.length, 1); assert.equal(rows[0].c, 105); assert.equal(rows[0].h, 105); assert.equal(rows[0].o, 100);
  rows = chart.applyTicks(rows, [tick('09:00:59.999', 98), tick('09:01:00', 107)], 'm1');
  assert.equal(rows.length, 2); assert.equal(rows[0].c, 98); assert.equal(rows[0].l, 98); assert.equal(rows[1].o, 107); assert.equal(rows[1].l, 107);
  assert.equal(rows[1].t, at('09:01:00'), 'boundary tick starts next minute without leaking prior low');
  reply = { items: [] };
  await provider.candles('AAPL', '1m', 1, at('09:00:00'));
  assert.equal(new URL(target).searchParams.get('before'), new Date(at('09:01:00') - 1).toISOString(), 'pagination translates start cursor back to end cursor');
  reply = { items: [raw('09:01:00'), raw('09:02:00'), raw('09:03:00'), raw('09:04:00'), raw('09:05:00'), raw('09:06:00')] };
  const six = await provider.candles('AAPL', '1m', 6);
  const three = chart.groupBars(six, 'm3'), five = chart.groupBars(six, 'm5');
  assert.equal(three.length, 2); assert.equal(three[0].t, at('09:00:00')); assert.equal(three[1].t, at('09:03:00'));
  assert.equal(five.length, 2); assert.equal(five[0].t, at('09:00:00')); assert.equal(five[1].t, at('09:05:00'));
  const duringLoad = chart.mergeChartSnapshot([], [six[0]], [tick('09:00:35', 110), tick('09:01:01', 112)], 'm1');
  assert.equal(duringLoad.length, 2); assert.equal(duringLoad[0].h, 110); assert.equal(duringLoad[1].c, 112);
  const repaired = chart.mergeChartSnapshot(duringLoad, [{ ...six[0], h: 120, c: 115 }], [tick('09:01:15', 113)], 'm1');
  assert.equal(repaired[0].h, 120); assert.equal(repaired[0].c, 115); assert.equal(repaired[1].c, 113);
  const live = chart.applyTicks([six[0]], [tick('09:00:40', 110)], 'm1');
  const late = chart.applyTicks(live, [tick('09:00:20', 95)], 'm1');
  assert.equal(late[0].c, 110, 'late same-minute trade cannot rewind chart close');
  assert.equal(late[0].l, 95, 'late trade still contributes extrema');
  const activeRefresh = chart.mergeChartSnapshot(live, [{ ...six[0], c: 101 }], [], 'm1', at('09:00:45'));
  assert.equal(activeRefresh[0].c, 110, 'REST refresh with no in-flight ticks cannot rewind live close');
  const completedRefresh = chart.mergeChartSnapshot(live, [{ ...six[0], c: 108 }], [], 'm1', at('09:01:05'));
  assert.equal(completedRefresh[0].c, 108, 'completed candle accepts authoritative correction');
  const sparse = [{ ...six[0], t: at('09:01:00') }, { ...six[0], t: at('09:05:00') }];
  const axis = chartAxis(sparse, 60000);
  assert.equal(axis.count, 5); assert.equal(axis.slots[1], 4);
  assert.equal(axis.indexAt(1), null, 'missing minute has no invented OHLC');
  assert.equal(axis.indexAt(4), 1); assert.equal(axis.timeAt(2), at('09:03:00'));
  assert.equal(chartAxis(sparse).count, 2, 'daily/weekly indexed layout unchanged');
  const filled = chartAxis([sparse[0], { ...six[0], t: at('09:03:00') }, sparse[1]], 60000);
  assert.equal(filled.count, 5, 'late historical candle fills a slot without shifting time');
  const timeAxis = chartAxis(Array.from({length: 240}, (_, i) => ({...six[0], t: at('09:00:00') + i * 60000})),60000);
  const wideTicks = chartTimeTicks(timeAxis, 0, 60, 360, 60000, 64);
  const zoomTicks = chartTimeTicks(timeAxis, 0, 15, 360, 60000, 64);
  assert(wideTicks.length >= 3, 'time labels appear between chart edges');
  assert(zoomTicks[1].t - zoomTicks[0].t < wideTicks[1].t - wideTicks[0].t, 'zooming in selects shorter time steps');
  for (const width of [40, 180, 360, 900]) {
    const ticks = chartTimeTicks(timeAxis, 7.4, 120, width, 60000, 64);
    ticks.forEach((tick,i) => {
      assert(tick.left >= 0 && tick.left + Math.min(64,width) <= width + 0.001);
      if (i) assert(tick.left >= ticks[i-1].left + Math.min(64,width) + 8, 'labels never overlap');
    });
  }
  reply = { items: [raw('13:00:00')] };
  const daily = await provider.candles('AAPL', '1d', 1);
  assert.equal(daily[0].t, at('13:00:00'), 'daily timestamps unchanged');
  // Minutes without trades become flat bars at the previous close; long gaps (overnight) stay empty.
  { const M = 60_000, bar = (t, c) => ({ t, o: c, h: c + 1, l: c - 1, c });
    const filled = chart.fillGaps([bar(0, 10), bar(3 * M, 12), bar(3 * M + 7 * 3600_000, 13)], M);
    assert.deepEqual(Array.from(filled, b => b.t), [0, M, 2 * M, 3 * M, 3 * M + 7 * 3600_000], 'fills 2 missing minutes, not the 7-hour gap');
    assert.deepEqual([filled[1].o, filled[1].h, filled[1].l, filled[1].c], [10, 10, 10, 10], 'flat at previous close');
    assert.equal(chart.fillGaps([bar(0, 1), bar(5 * M, 2)], 0).length, 2, 'daily bars untouched'); }
  console.log('PASS: documented end/start conversion, within-minute live update, exact minute boundary, per-frame OHLC separation, pagination cursor, 3/5-minute grouping, in-flight tick replay, REST repair, daily preservation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
