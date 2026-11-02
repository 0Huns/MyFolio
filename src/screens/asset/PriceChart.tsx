import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import { Candle, MergedHolding, mh } from '../../domain/models';
import { ChartTick, applyTicks, barLabel, fillGaps, mergeChartSnapshot } from '../../domain/chart';
import { ChartRange, barMinutes, useStore } from '../../store/store';
import { Fmt, describeError, fmtKST } from '../../utils';
import { CandleChart } from '../../ui/charts/CandleChart';
import { C, Card, Chips, FS, Fold, Notice, Skeleton, Sub, T, num, pnlColor } from '../../ui';

const RANGES: [ChartRange, string][] = [['m1', '1분'], ['m3', '3분'], ['m5', '5분'], ['d', '일'], ['w', '주'], ['mo', '월']];
/** Bars across the chart width per bar type. */
const VISIBLE: Record<ChartRange, number> = { m1: 60, m3: 60, m5: 60, d: 60, w: 52, mo: 36 };
const PREV_LABEL: Record<ChartRange, string> = { m1: '오늘', m3: '오늘', m5: '오늘', d: '전일 대비', w: '전주 대비', mo: '전월 대비' };

/**
 * Candlestick chart for one asset: pick a bar type, scroll left for older bars (loaded page by page).
 * Data: Toss candles when connected, Upbit for crypto, otherwise Yahoo.
 * Live: Toss websocket trades when connected (falls back to 5 s polling), applied to the last bar on the next animation frame.
 */
export function PriceChart({ holding, onInteractionChange }: { holding: MergedHolding; onInteractionChange: (active: boolean) => void }) {
  const s = useStore();
  const [range, setRange] = useState<ChartRange>('m1');
  const [rows, setRows] = useState<Candle[] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [feed, setFeed] = useState<'live' | 'waiting' | 'poll' | 'connecting' | 'failed' | null>(null);
  const [resume, setResume] = useState(0);
  const [chartError, setChartError] = useState<string | null>(null);
  const [lastTradeAt, setLastTradeAt] = useState<number | null>(null);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') setResume(n => n + 1);
    });
    return () => listener.remove();
  }, []);
  const pending = useRef<ChartTick[]>([]);
  const snapshotTicks = useRef<ChartTick[] | null>(null);
  const refreshChart = useRef<(() => void) | null>(null);
  const older = useRef<{ loading: boolean; done: boolean }>({ loading: false, done: false });
  const olderAbort = useRef<AbortController | null>(null);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const c = mh.currency(holding);
  const avg = mh.avg(holding);
  const intraday = barMinutes(range) > 0;
  // Depend on ticker/market only: `holding` is rebuilt on every price refresh.
  const { ticker, market, identityKey } = holding;

  useEffect(() => {
    let live = true;
    let fetching = false;
    const abort = new AbortController();
    pending.current = [];
    setRows(null);
    setChartError(null);
    setHover(null);
    older.current = { loading: false, done: false };
    const refresh = async () => {
      if (!live || fetching || AppState.currentState === 'background' || AppState.currentState === 'inactive') return;
      fetching = true;
      const buffered: ChartTick[] = [];
      snapshotTicks.current = buffered;
      try {
        const snapshot = await s.quotes.candles({ ticker, market }, range, undefined, abort.signal);
        if (live) {
          setChartError(null);
          const received = [...buffered];
          setRows(previous => mergeChartSnapshot(previous ?? [], snapshot, received, range));
        }
      } catch (error) {
        if (live) {
          setRows(previous => previous ?? []);
          setChartError(`차트 조회 실패 · ${describeError(String((error as Error)?.message ?? error)).title}`);
        }
      }
      finally {
        fetching = false;
        if (snapshotTicks.current === buffered) snapshotTicks.current = null;
      }
    };
    refreshChart.current = refresh;
    void refresh();
    // Websocket ticks render immediately. REST only repairs dropped frames and late-reported candles.
    const timer = setInterval(refresh, 30_000);
    return () => {
      live = false;
      abort.abort();
      clearInterval(timer);
      olderAbort.current?.abort();
      snapshotTicks.current = null;
      refreshChart.current = null;
    };
  }, [s, ticker, market, range, resume]);

  // Scrolled near the left edge: prepend the page before the oldest bar (once at a time, until there's no more).
  const loadOlder = () => {
    const first = rows?.[0];
    if (!first || older.current.loading || older.current.done) return;
    older.current.loading = true;
    const forRange = range;
    const abort = new AbortController();
    olderAbort.current = abort;
    s.quotes.candles({ ticker, market }, range, first.t, abort.signal).then(page => {
      if (abort.signal.aborted || rangeRef.current !== forRange) return; // bar type changed while loading
      if (!page.length) { older.current.done = true; return; }
      setRows(cs => (cs ? [...page.filter(p => p.t < cs[0].t), ...cs] : cs));
    }).catch(() => { if (!abort.signal.aborted) older.current.done = true; }).finally(() => { if (!abort.signal.aborted) older.current.loading = false; });
  };

  // Coalesce only ticks within one display frame; publish chart and price together.
  useEffect(() => {
    let cancelled = false;
    setLastTradeAt(null);
    let stop: (() => void) | null = null;
    let poll: ReturnType<typeof setInterval> | undefined;
    let pollingEpoch = 0;
    let receivedTrade = false;
    let frame: number | undefined;
    const tick = (p: number, t: number) => {
      if (cancelled) return;
      const received = { p, t, hi: p, lo: p };
      pending.current.push(received);
      snapshotTicks.current?.push(received);
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (cancelled) return;
        const next = pending.current;
        pending.current = [];
        if (!next.length) return;
        setRows(cs => (cs?.length ? applyTicks(cs, next, rangeRef.current) : cs));
      });
    };
    const startPolling = () => {
      if (cancelled || poll) return;
      setFeed('poll');
      const epoch = ++pollingEpoch;
      let fetching = false;
      const once = async () => {
        if (cancelled || fetching || epoch !== pollingEpoch) return;
        fetching = true;
        try {
          const p = await s.quotes.quote({ ticker, market });
          if (cancelled || epoch !== pollingEpoch) return;
          if (p) {
            // A quote has no trade timestamp: never invent a candle at the device's current time.
            s.quotes.setLivePrice(identityKey, p);
            refreshChart.current?.();
            setFeed('poll');
          }
          else setFeed('failed');
        } catch { if (!cancelled && epoch === pollingEpoch) setFeed('failed'); }
        finally { fetching = false; }
      };
      once();
      poll = setInterval(once, 5000);
    };
    // The trade socket has no initial snapshot. Fetch the current quote immediately.
    s.quotes.quote({ ticker, market }).then(p => {
      if (!cancelled && !receivedTrade && p) s.quotes.setLivePrice(identityKey, p);
    }).catch(() => {});
    s.quotes.liveTrades({ ticker, market }, (p, t) => {
      if (cancelled) return;
      receivedTrade = true;
      setLastTradeAt(previous => Math.max(previous ?? 0, t));
      tick(p, t);
    }, st => {
      if (cancelled) return;
      if (st === 'failed') startPolling();
      else {
        if (poll) { clearInterval(poll); poll = undefined; pollingEpoch++; }
        setFeed(st);
      }
    }).then(fn => {
      if (cancelled) fn?.();
      else if (fn) stop = fn;
      else startPolling();
    }).catch(startPolling);
    return () => {
      cancelled = true;
      stop?.();
      if (poll) clearInterval(poll);
      if (frame !== undefined) cancelAnimationFrame(frame);
      pending.current = [];
    };
  }, [s, ticker, market, identityKey, resume]);

  // Flat bars at the previous close for minutes without trades, so the chart has no holes; hover indexes this series.
  const shown = useMemo(() => (rows ? fillGaps(rows, barMinutes(range) * 60_000) : null), [rows, range]);
  const n = shown?.length ?? 0;
  const i = hover != null && hover < n ? hover : n - 1;
  const cur = n ? shown![i] : null;
  // Change vs the bar before (intraday: vs the previous session's close = today's change).
  const prev = intraday ? s.prevClose[identityKey] || shown?.[0]?.o : shown?.[i - 1]?.c;
  const displayedPrice = hover != null && cur ? cur.c : holding.price;
  const change = displayedPrice && prev ? (displayedPrice / prev - 1) * 100 : 0;
  const when = (t: number) => barLabel(range, t);
  // Axis labels/tags in the display currency, without the 원 suffix to save width.
  const fmtAxis = (v: number) => Fmt.price(v, c).replace('원', '');

  return (
    <Card style={{ padding: 18, borderRadius: 22, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, minHeight: 32 }}>
        {rows === null ? (
          // Same line as the loaded header, so the chart below doesn't jump.
          <>
            <Skeleton width={150} height={26} />
            <Skeleton width={90} height={15} />
          </>
        ) : (
          <>
            <T numberOfLines={1} style={[{ flexShrink: 1, fontSize: FS + 8, fontWeight: '800', letterSpacing: -0.5 }, num]}>{hover != null && cur ? Fmt.price(cur.c, c) : Fmt.price(holding.price, c)}</T>
            <T numberOfLines={1} style={[{ fontSize: FS - 1, color: pnlColor(change), fontWeight: '700' }, num]}>
              {cur ? `${Fmt.pct(change)} · ${hover != null ? when(cur.t) : PREV_LABEL[range]}` : '차트 없음'}
            </T>
          </>
        )}
      </View>
      {n ? (
        <CandleChart key={range} data={shown!} visible={VISIBLE[range]} intervalMs={barMinutes(range) * 60_000} height={180} fmt={fmtAxis} label={when}
          reference={avg > 0 ? avg : undefined} onInteractionChange={onInteractionChange} onHover={setHover} onReachStart={loadOlder} />
      ) : (
        // Chart (180) + time labels (34): same box while loading or when there's nothing to draw.
        <View style={{ height: 214 }}>{rows === null ? <Skeleton width="100%" height={180} radius={12} /> : null}</View>
      )}
      <View style={{ height: 20, justifyContent: 'center' }}>
        {hover != null && cur ? (
          <Sub numberOfLines={1} style={[{ fontSize: FS - 2 }, num]}>시 {Fmt.price(cur.o, c)}  고 {Fmt.price(cur.h, c)}  저 {Fmt.price(cur.l, c)}  종 {Fmt.price(cur.c, c)}</Sub>
        ) : n && avg > 0 ? (
          <Sub numberOfLines={1} style={{ fontSize: FS - 2 }}>점선 = 내가 산 평균 가격 ({Fmt.price(avg, c)})</Sub>
        ) : null}
      </View>
      <Chips fill value={range} onChange={setRange} options={RANGES} />
      {chartError ? <Notice title="차트를 새로 받지 못했어요" message={`${chartError} · 다음 조회에서 재시도해요.`} /> : null}
      <Fold title="차트 안내">
        <View style={{ gap: 6 }}>
          <Sub style={{ fontSize: FS - 2, lineHeight: 19 }}>{Platform.OS === 'macos' ? '좌우로 밀어 이동 · 위아래 스크롤로 확대/축소' : '밀어서 이동 · 두 손가락으로 확대 · 길게 눌러 가격 보기'}</Sub>
          {feed ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: feed === 'live' ? C.green : feed === 'failed' ? C.red : feed === 'poll' ? C.orange : C.tertiary }} />
              <Sub style={{ fontSize: FS - 3 }}>{feed === 'live' ? `체결 실시간 · 최근 체결 ${lastTradeAt ? fmtKST(lastTradeAt, 'HH:mm:ss') : '—'}` : feed === 'waiting' ? '연결됨 · 체결 대기' : feed === 'poll' ? '5초 주기 조회' : feed === 'failed' ? '시세 조회 실패' : '연결 중'}</Sub>
            </View>
          ) : null}
          {market === 'us' && s.data.settings.displayCurrency !== 'usd' ? <Sub style={{ fontSize: FS - 3, color: s.fxError ? C.orange : C.secondary }}>{s.rates.label}</Sub> : null}
          {intraday ? <Sub style={{ fontSize: FS - 3 }}>체결이 없던 분은 직전 가격의 가로선으로 표시해요.</Sub> : null}
          {market === 'us' ? <Sub style={{ fontSize: FS - 3 }}>미국 시세는 일부 거래소 기준으로 토스 앱과 다를 수 있어요.</Sub> : null}
        </View>
      </Fold>
    </Card>
  );
}
