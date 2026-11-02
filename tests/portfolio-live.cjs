const fs=require('fs'),ts=require(process.cwd()+'/node_modules/typescript'),vm=require('vm'),assert=require('assert');
let sockets=[],frames=new Map(),frameId=0;class WS {constructor(){this.sent=[];this.readyState=1;sockets.push(this);}send(x){this.sent.push(x);}close(){this.closed=true;}}
const client={token:async()=> 'fake',prices:async()=>({}),usBasePrices:async()=>({}),reserveStream:async()=>{}};let mockUuid=0;const util={uuid:()=>String(++mockUuid),dict:x=>x&&typeof x==='object'?x:{},num:Number,str:String,parseISO:Date.parse};
function load(file,req){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:req,WebSocket:WS,Date,Math,JSON,console,setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId},cancelAnimationFrame:id=>frames.delete(id)});return exports;}
const models=load('src/domain/models.ts',()=>({}));const toss=load('src/api/brokers/toss.ts',n=>n.endsWith('/utils')||n.endsWith('/http')?util:{});const prices={upbit:async()=>({}),usdKrw:async()=>1400,naver:async()=>({}),basePrices:async()=>({})};
const calculator=load('src/domain/calculator.ts',()=>models);
let eximKey=null, eximCalls=0; class EximAuthError extends Error {}
let eximResult=async()=>{throw new EximAuthError('invalid');};
const fxMock={EximAuthError,EXIM_KEY:'exim-fx',fetchEximFixing:async()=>{eximCalls++;return eximResult();},fxDay:at=>new Date(at+32400000).toISOString().slice(0,10),usTradeDay:(()=>{const m={exports:{}};require('vm').runInNewContext(ts.transpileModule(fs.readFileSync('src/domain/marketTime.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:m.exports,Date});return m.exports.usTradeDay;})()};
const path=require('path');const mocks={'src/api/brokers/toss':toss,'src/api/exim':fxMock,'src/domain/marketTime':fxMock,'src/domain/calculator':calculator,'src/domain/models':models,'src/api/prices':{Prices:prices},'src/utils':{...util,DAY:86400000,setDisplayCurrency(){}},'src/platform/native':{EXIM_KEY:'exim-fx',Keychain:{get:async()=>eximKey},Native:{writeData:async()=>{}}}};
const real={};const loadReal=file=>real[file]??=load(file+'.ts',n=>{if(!n.startsWith('.'))return n==='react-native'?{Platform:{OS:'ios'}}:{};const to=path.normalize(path.join(path.dirname(file),n));if(mocks[to])return mocks[to];return to.startsWith('src/store/')||to==='src/domain/portfolio'?loadReal(to):{};});
const store=loadReal('src/store/store').store;
const settle=()=>new Promise(setImmediate);const flush=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());};const send=(socket,payload)=>socket.onmessage({data:JSON.stringify(payload)});
(async()=>{
store.clients.toss=async()=>client;store.quotes.running=true;store.history.record=()=>{};store.data.accounts=[{id:'a',cashKRW:100}];store.data.holdings=[{id:'1',accountId:'a',ticker:'AAPL',assetType:'stock',market:'us',quantity:2,avgPrice:100,lastPrice:100},{id:'2',accountId:'a',ticker:'005930',assetType:'stock',market:'krx',quantity:3,avgPrice:1000,lastPrice:1000}];
await store.quotes.reconcile();await settle();assert.equal(sockets.length,1);const ws=sockets[0];ws.onopen();const declaration=JSON.parse(ws.sent[0]);assert.equal(declaration.length,2);
const statuses=[],ticks=[];const stopDetail=await store.quotes.liveTrades({ticker:'AAPL',market:'us'},(p,t)=>ticks.push(p),s=>statuses.push(s));await settle();assert.equal(sockets.length,1,'detail must reuse socket');
send(ws,{type:'subscriptions',subscribed:['trade:us:AAPL','trade:kr:005930']});assert.equal(statuses.at(-1),'waiting');let emits=0;store.subscribe(()=>emits++);
send(ws,{type:'message',topic:'trade:us:AAPL',data:{price:'110',timestamp:new Date().toISOString()}});send(ws,{type:'message',topic:'trade:kr:005930',data:{price:'1200',timestamp:new Date().toISOString()}});assert.equal(frames.size,1);flush();assert.equal(emits,1);assert.equal(store.summary().value,2*110*1400+3*1200);assert.equal(ticks[0],110);
send(ws,{type:'message',topic:'trade:us:AAPL',data:{price:'90',timestamp:new Date(Date.now()-60000).toISOString()}});assert.equal(store.merged().find(h=>h.ticker==='AAPL').price,110,'late trade must not rewind current quote');flush();
let resolvePrices;client.usdKrw=async()=>1400;client.prices=()=>new Promise(r=>resolvePrices=r);client.prevCloses=async()=>({});const refreshing=store.quotes.refresh();assert.equal(store.quotes.refresh(),refreshing,'overlapping refresh shares one request');await settle();send(ws,{type:'message',topic:'trade:us:AAPL',data:{price:'115',timestamp:new Date().toISOString()}});resolvePrices({AAPL:105,'005930':1200});await refreshing;assert.equal(store.merged().find(h=>h.ticker==='AAPL').price,115,'REST must not overwrite newer tick');
client.prices=async()=>({AAPL:90});await store.quotes.refresh();assert.equal(store.merged().find(h=>h.ticker==='AAPL').price,115,'REST cannot replace active live quote even without a tick during the request');
store.quotes.setLivePrice('sec:AAPL',80);assert.equal(store.merged().find(h=>h.ticker==='AAPL').price,115,'detail snapshot cannot replace active live quote');
store.quotes.status.set('AAPL','failed');await store.quotes.refresh();assert.equal(store.merged().find(h=>h.ticker==='AAPL').price,90,'REST can recover price after live feed fails');
client.prices=async()=>({});stopDetail();await settle();assert.equal(sockets.length,1,'leaving detail keeps portfolio stream');
store.data.holdings.push({ticker:'TSLA',market:'us'});await store.quotes.reconcile();await settle();assert(ws.closed);assert.equal(sockets.length,2);store.quotes.running=false;store.quotes.stop();assert(sockets[1].closed);assert.equal(frames.size,0);
store.data.holdings=Array.from({length:110},(_,i)=>({ticker:'S'+i,market:'us'}));store.quotes.running=true;await store.quotes.reconcile();await settle();const large=sockets.at(-1);large.onopen();assert.equal(JSON.parse(large.sent[0])[0].codes.length,100);store.quotes.stop();store.data.holdings=[];store.data.accounts=[{id:'cash',cashKRW:11,cashUSD:100.5},{id:'other',cashKRW:1000}];store.usdKrw=1400;
assert.equal(store.summary('cash').cash,140711);assert.equal(store.summary().cash,141711);
store.usdKrw=1500;assert.equal(store.summary('cash').cash,150761,'USD cash follows current FX');
store.sync.applyBalance({holdings:[],cashKRW:20,cashUSD:200},'cash');assert.equal(store.summary('cash').cash,300020);
store.sync.applyBalance({holdings:[],cashKRW:30},'cash');assert.equal(store.summary('cash').cash,30,'non-USD balance clears stale USD');
client.candles=async()=>{throw new Error('Toss candle unavailable');};
await assert.rejects(store.quotes.candles({ticker:'TSTB',market:'us'},'m1'),/Toss candle unavailable/,'configured Toss chart must not silently fall back to Yahoo');
client.prices=async()=>{throw new Error('Toss quote unavailable');};
await assert.rejects(store.quotes.quote({ticker:'TSTA',market:'us'}),/Toss quote unavailable/,'configured Toss quote must not silently fall back to Yahoo');
store.data.accounts=[{id:'net',broker:'toss',cashKRW:11,cashUSD:5.50},{id:'manual',broker:'manual',cashKRW:0}];
store.data.holdings=[{accountId:'net',ticker:'TSTA',assetType:'stock',market:'us',quantity:10000,avgPrice:0.2,lastPrice:0.1749,amountAfterCost:1740.00,valuationAt:1000,valuationCommission:{rate:0.001}}];
store.prices={};store.usdKrw=1300.25;
let netHolding=store.merged('net')[0];assert(Math.abs(models.mh.value(netHolding)-1740.00)<1e-9,'broker net valuation used exactly at snapshot price');
assert(Math.abs(store.summary('net').value-1740.00*1300.25)<1e-6);
assert(Math.abs(store.summary('net').cash-(5.50*1300.25+11))<1e-6,'cash is not charged stock costs');
store.prices['sec:TSTA']=0.175;netHolding=store.merged('net')[0];const expectedNet=1740.00+10000*(0.175-0.1749)*(1-0.001);
assert(Math.abs(models.mh.value(netHolding)-expectedNet)<1e-9,'only documented commission on the price delta changes, historic costs stay fixed');assert.equal(netHolding.price,0.175,'current quote remains gross trade price');
assert(Math.abs(models.mh.pnl(netHolding)-(expectedNet-netHolding.cost))<1e-9);
store.data.holdings.push({accountId:'manual',ticker:'TSTA',assetType:'stock',market:'us',quantity:10,avgPrice:0.1,lastPrice:0.175});
assert(Math.abs(models.mh.value(store.merged()[0])-(expectedNet+1.75))<1e-9,'merged account fees applied once only to broker quantity');
store.sync.applyBalance({cashKRW:11,cashUSD:5.50,holdings:[{ticker:'TSTA',assetType:'stock',market:'us',quantity:10000,avgPrice:0.2,lastPrice:0.175,amountAfterCost:3393,valuationAt:2000}]},'net');
assert(Math.abs(models.mh.value(store.merged('net')[0])-3393)<1e-9,'next broker snapshot replaces fee basis without double deduction');
let fxCalls=0,publicFxCalls=0;client.usdKrw=async()=>{fxCalls++;return 1375;};prices.usdKrw=async()=>{publicFxCalls++;return 1400;};
store.data.accounts=[{id:'fx',broker:'toss',cashKRW:0}];store.clients.toss=async()=>client;store.rates.checkedAt=0;store.data.dailyFx={};await Promise.all([store.rates.refresh(),store.rates.refresh()]);assert.equal(fxCalls,1);assert.equal(store.usdKrw,1375);assert.equal(store.fxSource,'toss-mid');
await store.rates.refresh();assert.equal(fxCalls,1,'rate refresh limited to once per minute');
store.rates.checkedAt=0;store.data.dailyFx={};client.usdKrw=async()=>{throw new Error('auth failure');};await store.rates.refresh();assert.equal(store.usdKrw,1375);assert.equal(publicFxCalls,0,'Toss failure must not switch to Yahoo FX');assert(store.fxError);
eximKey='dummy';client.usdKrw=async()=>{fxCalls++;return 1330;};
store.rates.checkedAt=0;await store.rates.refresh();
assert.equal(store.usdKrw,1330);assert.equal(store.fxSource,'toss-mid');assert(!store.fxError);assert(store.fxNotice);
store.rates.checkedAt=0;await store.rates.refresh();assert.equal(eximCalls,1,'auth retry throttled while fallback keeps updating');assert.equal(fxCalls,3);
store.data.accounts=[];store.rates.checkedAt=0;await store.rates.refresh();assert.equal(store.fxSource,'yahoo');assert.equal(store.usdKrw,1400);
eximResult=async()=>({date:'2026-10-28',rate:1336.3});store.rates.eximCheckedAt=0;store.rates.checkedAt=0;await store.rates.refresh();assert.equal(store.fxSource,'exim-daily');assert.equal(store.fxBaseDate,'2026-10-28');assert.equal(store.fxNotice,'');
eximResult=async()=>{throw new Error('network');};store.rates.eximCheckedAt=0;store.rates.checkedAt=0;await store.rates.refresh();assert.equal(store.usdKrw,1336.3);assert.equal(store.fxSource,'exim-daily');assert(store.fxError,'network error retains prior fixing');
eximKey=null;
store.data.accounts=[{id:'broker',broker:'toss',cashKRW:11,cashUSD:3}];
store.data.trades=[];store.data.holdings=[];store.prices={};store.usdKrw=1300;
store.sync.applyBalance({cashKRW:11,cashUSD:3,valuation:{value:{krw:0,usd:101},purchase:{krw:0,usd:80},profit:{krw:0,usd:20},at:1000},holdings:[{ticker:'XYZ',name:'XYZ',assetType:'stock',market:'us',quantity:2,lastPrice:50,avgPrice:40,purchaseAmount:80,amountAfterCost:100,profitAfterCost:19,valuationAt:1000}]},'broker');
assert.equal(store.summary().value,101*1300,'use broker aggregate, not item sum');
assert.equal(store.summary().profit,20*1300,'use broker aggregate profit, not inferred difference');
assert.equal(store.summary().cost,80*1300,'no replay of purchase history');
assert.equal(store.summary().cash,3*1300+11);
store.prices['sec:XYZ']=51;
assert.equal(store.summary().value,103*1300,'add only 2-share live delta to broker base');
assert.equal(store.summary().profit,22*1300);
store.data.trades=[{id:'b',accountId:'broker',ticker:'XYZ',assetType:'stock',market:'us',side:'buy',date:1,quantity:1,price:10,fee:0,tax:0},{id:'s',accountId:'broker',ticker:'XYZ',assetType:'stock',market:'us',side:'sell',date:2,quantity:1,price:20,fee:0,tax:0}];
store.data.settings.displayCurrency='usd';
assert.equal(store.saleProfits().s,null,'never substitute locally reconstructed Toss realized gains');

const baseline={quantity:100,lastPrice:10,market:'us',amountAfterCost:990,valuationCommission:{rate:0.001},valuationAt:1000};
assert.equal(models.liveHoldingValue(baseline,10),990,'exact broker baseline');
assert.equal(models.liveHoldingValue(baseline,20),1989,'price doubling must not double historic cost');
assert.equal(models.liveHoldingValue(baseline,5),490.5,'falling prices reduce only marginal commission');
assert.equal(models.liveHoldingValue({...baseline,valuationCommission:undefined},20),1990,'unknown commission retains official cost');
assert.equal(models.liveHoldingValue({...baseline,valuationCommission:{rate:0.001,endDate:'2000-01-01'}},20),1990,'expired commission is not extrapolated');
assert.equal(models.liveHoldingValue({...baseline,valuationCommission:{rate:0.001,startDate:'2999-01-01'}},20),1990,'future commission is not applied');
assert.equal(models.liveHoldingValue({...baseline,valuationCommission:{rate:0}},20),1990,'zero commission is valid');
assert.equal(models.liveHoldingValue({...baseline,quantity:1,lastPrice:8,amountAfterCost:7.9},12),11.9,'crossing small-order exemption boundary keeps snapshot deduction');
assert.equal(models.liveHoldingValue({...baseline,amountAfterCost:undefined},20),2000,'manual positions remain gross');
// Trade-day FX: EXIM fixing per missing US trade day; today only once today's fixing is known; failures stop the run.
{const fxs=require('fs'),tsx=require(process.cwd()+'/node_modules/typescript'),vmx=require('vm');const realFx={exports:{}};vmx.runInNewContext(tsx.transpileModule(fxs.readFileSync('src/domain/marketTime.ts','utf8'),{compilerOptions:{module:tsx.ModuleKind.CommonJS,target:tsx.ScriptTarget.ES2020}}).outputText,{exports:realFx.exports,Date});
const days=[];fxMock.fetchEximFixing=async(k,c,now)=>{const d=realFx.exports.fxDay(now);days.push(d);if(d==='2026-10-02')throw new Error('network');return {date:d,rate:d==='2026-10-05'?1300:1200};};
store.quotes.running=false;store.quotes.stop();eximKey='dummy';const at=d=>Date.parse(d+'T23:30:00+09:00');const today=realFx.exports.fxDay(Date.now());
store.data.dailyFx={'2026-10-01':1111};store.fxSource='exim-daily';store.fxBaseDate='2000-01-01';store.usdKrw=1350;
store.data.trades=[{market:'us',date:at('2026-10-01')},{market:'us',date:at('2026-10-05')},{market:'us',date:at('2026-10-05')},{market:'krx',date:at('2026-10-06')},{market:'us',date:at(today)},{market:'us',date:at('2026-10-02')},{market:'us',date:at('2026-09-30')}];
await Promise.all([store.rates.fillTradeDays(),store.rates.fillTradeDays()]);
assert.deepEqual(days,['2026-10-05','2026-10-02'],'newest first, known and KR days skipped, one run, stops on failure');
assert.equal(store.data.dailyFx['2026-10-05'],1300);assert.equal(store.data.dailyFx['2026-10-01'],1111,'existing rates kept');assert.equal(store.data.dailyFx[today],undefined,'today waits for its own fixing');assert.equal(store.data.dailyFx['2026-09-30'],undefined);
store.fxBaseDate=today;days.length=0;fxMock.fetchEximFixing=async(k,c,now)=>{const d=realFx.exports.fxDay(now);days.push(d);return {date:d,rate:1200};};await store.rates.fillTradeDays();
assert.equal(store.data.dailyFx[today],1350,'today uses current EXIM fixing');assert.deepEqual(days.slice(0,2),['2026-10-02','2026-09-30'],'trade days before chart-only days');
assert(days.length>2&&days.slice(2).every(d=>d<today&&![0,6].includes(new Date(d+'T00:00:00Z').getUTCDay())),'then weekdays since first trade for the chart');
eximKey=null;days.length=0;delete store.data.dailyFx['2026-10-02'];await store.rates.fillTradeDays();assert.equal(days.length,0,'no key, no requests');}
// KRW principal at purchase fixings (Toss): moving average of qty × price × US trading-day fixing, fees excluded.
{store.data.settings.displayCurrency='krw';store.usdKrw=1300;store.prices={};store.data.accounts=[{id:'t',broker:'toss',cashKRW:0}];
const at=d=>Date.parse(d+'T23:30:00+09:00');store.data.dailyFx={'2026-10-01':1400,'2026-10-02':1350,'2026-10-05':1200};
store.data.trades=[{accountId:'t',ticker:'ABC',market:'us',side:'buy',date:at('2026-10-01'),quantity:10,price:10,fee:1},{accountId:'t',ticker:'ABC',market:'us',side:'buy',date:at('2026-10-02'),quantity:10,price:20,fee:1},{accountId:'t',ticker:'ABC',market:'us',side:'sell',date:at('2026-10-05'),quantity:5,price:30,fee:1}];
store.data.holdings=[{id:'x',accountId:'t',ticker:'ABC',assetType:'stock',market:'us',quantity:15,avgPrice:15,lastPrice:20,purchaseAmount:225,amountAfterCost:300,profitAfterCost:75}];
const m=store.merged('t')[0];const krwCost=(10*10*1400+10*20*1350)*0.75;
assert(Math.abs(store.holdingCost(m)-krwCost)<1e-6,'principal at purchase fixings, fees excluded, reduced pro rata on sale');
assert(Math.abs(store.holdingPnl(m)-(300*1300-krwCost))<1e-6,'KRW P&L includes FX change');
assert(Math.abs(store.summary('t').cost-krwCost)<1e-6);assert(Math.abs(store.summary('t').profit-(300*1300-krwCost))<1e-6);
store.data.settings.displayCurrency='usd';assert.equal(store.holdingCost(m),225*1300,'USD display keeps broker USD principal');store.data.settings.displayCurrency='krw';
store.data.holdings[0].quantity=16;assert.equal(store.holdingCost(store.merged('t')[0]),225*1300,'history not matching broker quantity falls back');store.data.holdings[0].quantity=15;
store.prevClose={'sec:ABC':21};store.prices={'sec:ABC':20};const day=store.daySummary('t');assert(Math.abs(day.amount-(-15*1300))<1e-6);assert(Math.abs(day.rate-(-15*1300)/krwCost*100)<1e-9,'daily rate over principal, as Toss');store.prices={};delete store.prevClose['sec:ABC'];
delete store.data.dailyFx['2026-10-01'];store.data.dailyFx={...store.data.dailyFx};assert.equal(store.holdingCost(store.merged('t')[0]),225*1300,'missing fixing falls back');}
// US data cache: results and in-flight requests are shared; failures are not kept.
{let calls=0;const ok=()=>{calls++;return Promise.resolve(calls);};
assert.equal(await Promise.all([store.us.cached('a',ok),store.us.cached('a',ok)]).then(r=>r[0]),1);assert.equal(await store.us.cached('a',ok),1);assert.equal(calls,1,'cached');
let fails=0;const bad=()=>{fails++;return Promise.reject(new Error('down'));};
await assert.rejects(store.us.cached('b',bad));await assert.rejects(store.us.cached('b',bad));assert.equal(fails,2,'failure retried');
store.us.cache.get('a').at=0;await store.us.cached('a',ok);assert.equal(calls,2,'expires after 5 minutes');}
// Subscriptions: live ticks reach `subscribe` only; data changes reach both.
{let all=0,dataOnly=0;const u1=store.subscribe(()=>all++),u2=store.subscribeData(()=>dataOnly++);store.emitPrices();assert.equal(all,1);assert.equal(dataOnly,0,'price tick skips data subscribers');store.emit();assert.equal(all,2);assert.equal(dataOnly,1);u1();u2();const v=store.getDataVersion();store.emitPrices();assert.equal(store.getDataVersion(),v);}
// Saving keeps quote subscriptions in step with holdings; settings changes reach the schedule.
{let saved=0;const was=store.onSave;store.onSave=()=>saved++;store.save();assert.equal(saved,1);store.onSave=was;let patch;const prev=store.onSettingsChanged;store.onSettingsChanged=p=>patch=p;store.updateSettings({hideAmounts:true});assert.equal(patch.hideAmounts,true);store.onSettingsChanged=prev;store.data.settings.hideAmounts=false;}
console.log('PASS: shared KR/US stream, frame batching, valuations, REST race, portfolio retention, subscription changes, stop, 100-topic cap');
})().catch(e=>{console.error(e);process.exitCode=1;});
