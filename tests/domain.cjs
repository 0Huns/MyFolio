const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => imports[name] || {}, Date, Map, Set, Math, Number, Object, String, Array, Intl });
  return exports;
}
const util = require('./helpers.cjs').loadUtils(load);
const models = load('src/domain/models.ts');
const period = load('src/domain/period.ts');
const trades = load('src/domain/trades.ts', { '../utils': util, './models': models });
const filings = load('src/domain/filings.ts');
const report = load('src/domain/tickerReport.ts', { './filings': filings });
const chart = load('src/domain/chart.ts', { '../utils': util });

// Period filter
assert.equal(period.periodPrefix('all', '2026-10'), '');
assert.equal(period.periodPrefix('year', '2026-10'), '2026');
assert.equal(period.periodPrefix('month', '2026-10'), '2026-10');
assert.equal(period.shiftPeriod('month', '2026-01', -1), '2025-12', 'month steps across a year');
assert.equal(period.shiftPeriod('year', '2026-10', 1), '2027-10');
assert.equal(period.periodLabel('month', '2026-03'), '2026년 3월');
assert.equal(period.isLatestPeriod('month', '2026-10', '2026-10-30'), true);
assert.equal(period.isLatestPeriod('month', '2026-09', '2026-10-30'), false);

// Trade totals
const t = (id, side, date, ticker, quantity, price) => ({ id, side, date, ticker, quantity, price, name: ticker, assetType: 'stock' });
const list = [t('b', 'buy', 1, 'AAA', 2, 10), t('s', 'sell', 3, 'AAA', 1, 20), t('x', 'sell', 2, 'BBB', 1, 5)];
const sales = { s: { profit: 7, cost: 13 }, x: null };
const totals = trades.tradeTotals(list, () => 100, sales);
assert.equal(totals.buy, 2000); assert.equal(totals.sell, 2500); assert.equal(totals.profit, 7); assert.equal(totals.cost, 13);
assert.equal(totals.unknown, 1, 'sale without cost basis is counted, not summed');
assert(Number.isNaN(trades.tradeTotals(list, () => undefined, sales).buy), 'missing rate is unknown, not zero');
const stocks = trades.stockTotals(list, () => 1, sales);
assert.deepEqual(Array.from(stocks, a => a.ticker), ['AAA', 'BBB'], 'most recently traded first');
assert.equal(stocks[0].buyN, 1); assert.equal(stocks[0].sellQty, 1); assert.equal(stocks[1].unknown, 1);
assert.equal(trades.sideCounts(stocks[0]), '매수 1건 2주 · 매도 1건 1주');
assert.equal(trades.profitRate({ profit: 1, cost: 4 }), '+25.00%');
assert.equal(trades.profitRate({ profit: 1, cost: 0 }), '');

// Filings
const forms = ['8-K', '4', '4/A', '144', 'SC 13G'].map(form => ({ form }));
assert.equal(filings.filterFilings(forms, 'all').length, 5);
assert.deepEqual(Array.from(filings.filterFilings(forms, 'insider'), f => f.form), ['4', '4/A', '144']);
assert.deepEqual(Array.from(filings.filterFilings(forms, 'major'), f => f.form), ['8-K', 'SC 13G']);

// Ticker report
const base = { ticker: 'AAA', name: 'Acme', volumes: [], volumesLoading: false, shortInterest: [], filings: [], filingError: false };
assert(report.tickerReport(base).startsWith('# AAA — Acme'));
assert(report.tickerReport({ ...base, filings: null }).includes('불러오는 중'));
assert(report.tickerReport({ ...base, filingError: true }).includes('공시 조회 실패'));

// Crosshair labels
const at = Date.parse('2026-10-05T01:02:00Z');
assert.equal(chart.barLabel('m1', at), '10.05 10:02');
assert.equal(chart.barLabel('d', at), '2026.10.05');
assert.equal(chart.barLabel('mo', at), '2026.10');

// Portfolio figures
{
  const calc = load('src/domain/calculator.ts', { './models': models });
  const marketTime = load('src/domain/marketTime.ts');
  const pf = load('src/domain/portfolio.ts', { './models': models, './calculator': calc, './marketTime': marketTime, '../utils': util });
  const view = { usdKrw: 1300, prices: { 'sec:AAA': 12 }, prevClose: { 'sec:AAA': 10 }, data: { trades: [], settings: { displayCurrency: 'krw', usWatchlist: ['zzz'] }, accounts: [{ id: 'a', cashKRW: 100, cashUSD: 1 }],
    holdings: [{ accountId: 'a', ticker: 'AAA', name: 'A', assetType: 'stock', market: 'us', quantity: 2, avgPrice: 8, lastPrice: 10 }] } };
  const [m] = pf.merged(view);
  assert.equal(m.price, 12, 'live price wins over the snapshot');
  const s = pf.summary(view);
  assert.equal(s.value, 24 * 1300); assert.equal(s.cost, 16 * 1300); assert.equal(s.cash, 100 + 1300);
  assert.equal(pf.sum.total(s), 24 * 1300 + 1400);
  assert.equal(pf.holdingPnl(view, m), 8 * 1300);
  assert.equal(pf.holdingReturn(view, m), 50);
  assert.equal(pf.dayChange(view, m).amount, 4); assert.equal(pf.dayChange(view, m).rate, 19.999999999999996);
  const day = pf.daySummary(view);
  assert.equal(day.amount, 4 * 1300); assert.equal(day.rate, 25, 'daily rate is over principal');
  assert.deepEqual(Array.from(pf.usTickers(view)), ['AAA', 'zzz']);
  assert.equal(pf.heldQuantity(view, 'missing', 'sec:AAA'), undefined);
}


// Bubble map: no overlaps, everything inside the box, bigger value = bigger circle, same input = same layout
const bubbles = load('src/domain/bubbles.ts');
const items = [50, 30, 20, 12, 9, 7, 5, 3, 2, 1, 1].map((value, i) => ({ key: `k${i}`, value }));
for (const [w, h] of [[350, 360], [900, 300], [328, 190]]) {
  const packed = Array.from(bubbles.packBubbles(items.map(i => ({ ...i })), w, h));
  assert.equal(packed.length, items.length);
  for (const [i, a] of packed.entries()) {
    assert(a.x - a.r >= -0.5 && a.y - a.r >= -0.5 && a.x + a.r <= w + 0.5 && a.y + a.r <= h + 0.5, `bubble inside ${w}x${h}`);
    for (const b of packed.slice(i + 1)) assert(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r - 0.5, 'bubbles do not overlap');
  }
  assert(packed[0].r > packed[1].r && packed[1].r > packed[2].r);
  assert.equal(JSON.stringify(packed), JSON.stringify(Array.from(bubbles.packBubbles(items.map(i => ({ ...i })), w, h))));
}
assert.equal(bubbles.packBubbles([], 100, 100).length, 0);
assert.equal(bubbles.packBubbles([{ key: 'a', value: 0 }, { key: 'b', value: NaN }], 100, 100).length, 0);
assert.equal(bubbles.packBubbles([{ key: 'a', value: 5 }], 0, 100).length, 0, 'no size yet');

// Sentences
const story = load('src/domain/story.ts', { '../utils': util });
assert.equal(story.dayHeadline({ amount: 12300.9 }, 0, false).title, '어제보다 12,300원 늘었어요');
assert.equal(story.dayHeadline({ amount: -500.2 }, 0, false).title, '어제보다 500원 줄었어요');
assert.equal(story.dayHeadline({ amount: 0.4 }, 0, false).title, '어제와 같아요');
assert.equal(story.dayHeadline({ amount: 100 }, 0, true).title, '금액 숨김', 'hidden amounts hide the direction');
assert.equal(story.dayHeadline(null, 2400000, false).title, '2,400,000원');
assert.equal(story.dayLabel('2026-11-02'), '11월 2일');
assert.equal(story.holdingHeadline(96000, false), '지금 96,000원 벌고 있어요');
assert.equal(story.holdingHeadline(-12000, false), '지금 12,000원 손실 중이에요');
assert.equal(story.holdingHeadline(NaN, false), '손익을 아직 알 수 없어요');
assert.equal(story.tradeHeadline(3, 1, 21000, true), '3번 사고 1번 팔아서 21,000원 벌었어요');
assert.equal(story.tradeHeadline(0, 2, -500, true), '2번 팔아서 500원 손실이 났어요');
assert.equal(story.tradeHeadline(2, 0, 0, false), '2번 샀어요');
assert.equal(story.tradeHeadline(2, 1, 0, false), '2번 사고 1번 팔았어요', 'unknown cost: no amount');
assert.equal(story.tradeHeadline(0, 0, 0, false), '거래가 없었어요');
const moved = story.movers([{ n: 'a', r: 2 }, { n: 'b', r: -1 }, { n: 'c', r: 5 }, { n: 'd' }], x => x.r);
assert.equal(moved.up.row.n, 'c');
assert.equal(moved.down.row.n, 'b');
assert.equal(story.movers([{ r: 1 }], x => x.r).down, undefined);
const vol = ratio => ({ date: '', short: 0, total: 0, ratio });
assert.equal(story.shortTrend([vol(60), vol(45), vol(45)]), '공매도는 평소보다 늘었어요');
assert.equal(story.shortTrend([vol(30), vol(45), vol(45)]), '공매도는 평소보다 줄었어요');
assert.equal(story.shortTrend([vol(45), vol(46), vol(44)]), '공매도는 평소와 비슷해요');
assert.equal(story.shortTrend([vol(45)]), null);
const now = Date.UTC(2026, 10, 2);
const filed = [{ date: now - 86400_000 }, { date: now - 6 * 86400_000 }, { date: now - 8 * 86400_000 }];
assert.equal(story.tickerHeadline(filed, [vol(45), vol(46), vol(44)], now), '이번 주 새 공시 2건,\n공매도는 평소와 비슷해요');
assert.equal(story.tickerHeadline(null, [], now), '데이터를 확인하고 있어요');
assert.equal(filings.formSentence('8-K/A'), '회사에 중요한 일이 있었어요');
assert.equal(filings.formSentence('XYZ', '기타'), '기타');

// Goals
const goals = load('src/domain/goals.ts');
assert.equal(goals.goalPercent(2400000, 3000000), 80);
assert.equal(goals.goalPercent(4000000, 3000000), 100, 'capped');
assert.equal(goals.goalPercent(100, 0), 0);
assert.equal(goals.goalPercent(-5, 100), 0);
const bought = (y, m) => ({ side: 'buy', ticker: 'A', date: Date.UTC(y, m, 15) });
assert.equal(goals.steadyBuying([bought(2026, 7), bought(2026, 8), bought(2026, 9)]), true);
assert.equal(goals.steadyBuying([bought(2025, 11), bought(2026, 0), bought(2026, 1)]), true, 'across a year');
assert.equal(goals.steadyBuying([bought(2026, 6), bought(2026, 8), bought(2026, 9)]), false, 'a gap breaks it');
assert.equal(goals.steadyBuying([{ ...bought(2026, 7), side: 'sell' }, bought(2026, 8), bought(2026, 9)]), false, 'sells do not count');
assert.equal(goals.heldOneYear([bought(2025, 0)], ['A'], now), true);
assert.equal(goals.heldOneYear([bought(2025, 0)], ['B'], now), false, 'no longer held');
assert.equal(goals.heldOneYear([bought(2026, 9)], ['A'], now), false);
assert.equal(Array.from(goals.badges([], ['a', 'b', 'c', 'd', 'e'], now))[0].earned, true);
assert.equal(Array.from(goals.badges([], ['a'], now))[0].earned, false);


// The copy for AI tools carries no market prices or anything computed from them
{
  const reports = load('src/store/reports.ts', { '../utils': util, '../domain/models': models, './store': { sum: { pnl: () => 999111, ret: () => 77, total: () => 888222 } } });
  const m = { name: 'Acme', ticker: 'ACM', market: 'krx', assetType: 'stock', quantity: 3, price: 123456, identityKey: 'sec:ACM', lots: [], cost: 300 };
  const store = {
    usdKrw: 1400, lastPriceRefresh: 1, prevClose: {}, summary: () => ({ value: 370368, cost: 300, cash: 50, stock: 370368, crypto: 0, profit: 999111 }),
    daySummary: () => ({ amount: 555333, rate: 12 }), realizedByAsset: () => ({ 'sec:ACM': 40 }), merged: () => [m], holdingCost: () => 300,
    avgPriceText: () => '100원', holdingPnl: () => 999111, holdingReturn: () => 77, dayChange: () => ({ amount: 1, rate: 12 }), toKRW: v => v, account: () => ({ name: '내 계좌' }),
    data: { accounts: [{ id: 'a', name: '내 계좌', broker: 'toss', lastSyncDate: 0 }], snapshots: [{ date: 0, totalValue: 777444, cash: 0, cost: 300 }],
      trades: [{ id: 't', date: 0, side: 'buy', name: 'Acme', ticker: 'ACM', market: 'krx', quantity: 3, price: 100, accountId: 'a' }] },
  };
  const text = reports.portfolioMarkdown(store);
  for (const leak of ['123,456', '370,368', '999,111', '555,333', '777,444', '888,222', '현재가', '평가손익', '시세 갱신']) assert(!text.includes(leak), `no ${leak} in the AI copy`);
  for (const kept of ['Acme', '100원', '실현손익', '체결가']) assert(text.includes(kept), `${kept} stays`);
  const chat = reports.portfolioContext(store);
  for (const leak of ['123,456', '370,368', '999,111', '888,222', '현재가', '평가손익', '평가금액', '수익률']) assert(!chat.includes(leak), `no ${leak} in the AI chat context`);
  for (const kept of ['Acme', '100원', '실현손익']) assert(chat.includes(kept), `${kept} stays in the chat context`);
}

console.log('PASS: period filter, trade and stock totals, filing filter, ticker report, chart labels.');
