import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, StyleSheet, View, ViewProps, requireNativeComponent } from 'react-native';
import { fmtKST } from '../../utils';
import { chartAxis, chartTimeTicks } from '../../domain/chartAxis';
import { Candle } from '../../domain/models';
import { C, FS, T } from '..';

type Pointer = { x: number; y: number };
type TrackerProps = ViewProps & {
  onChartPointer?: (e: { nativeEvent: Pointer }) => void;
  onChartLeave?: () => void;
  onChartWheel?: (e: { nativeEvent: { dx: number; dy: number; precise: boolean } }) => void;
  onChartDrag?: (e: { nativeEvent: { dx: number } }) => void;
};
/** macOS: native overlay reporting pointer position, scroll wheel and drags (MFNative.m › MFChartTracker). */
const Tracker = Platform.OS === 'macos' ? requireNativeComponent<TrackerProps>('MFChartTracker') : null;

const MIN_BARS = 15;
const MAX_BARS = 240;

/**
 * Candlestick chart with its own pan / zoom (no ScrollView), so pointer, wheel and gestures share one model:
 * the window is `[end - span, end)` in bar indices.
 * - Mac: crosshair follows the mouse (price at the pointer on the right axis); horizontal trackpad swipe or drag pans;
 *   vertical scroll zooms around the pointer.
 * - iPhone: drag pans, pinch zooms, long-press then drag shows the crosshair.
 * Only bars in the window are drawn and the price scale fits them. Near the oldest bar `onReachStart` loads more
 * (the view keeps its place); while showing the newest bar, new bars keep it in view.
 */
export function CandleChart({ data, visible, intervalMs = 0, height = 200, fmt, label, reference, onHover, onReachStart, onInteractionChange }: {
  data: Candle[];
  visible: number;
  intervalMs?: number;
  height?: number;
  fmt: (v: number) => string;
  label: (t: number) => string;
  reference?: number;
  onHover: (i: number | null) => void;
  onReachStart?: () => void;
  onInteractionChange?: (active: boolean) => void;
}) {
  const axis = useMemo(() => chartAxis(data, intervalMs), [data, intervalMs]);
  const n = axis.count;
  const [width, setWidth] = useState(0);
  const [span, setSpan] = useState(Math.min(visible, Math.max(n, MIN_BARS)));
  const [end, setEnd] = useState(n);
  const [pointer, setPointer] = useState<Pointer | null>(null);

  // Right price axis: wide enough for the longest label at this price level (e.g. 107,660,000).
  const sample = n ? fmt(Math.max(...data.slice(-200).map(d => d.h))) : '0';
  const AXIS = Math.max(52, Math.ceil(sample.length * (FS - 4) * 0.62) + 14);
  const plotW = Math.max(0, width - AXIS);
  const barW = plotW && span ? plotW / span : 0;

  // Right edge may overshoot the newest bar a little; the window never starts before the first bar.
  const clampEnd = (e: number, sp: number, count: number) => Math.min(count + sp * 0.15, Math.max(Math.min(sp, count), e));

  // Keep the same bars on screen when older ones are prepended; follow the newest bar while it is in view.
  const firstT = useRef(data[0]?.t);
  const lastN = useRef(n);
  useEffect(() => {
    const prevFirst = firstT.current;
    const added = prevFirst !== undefined && n && data[0].t < prevFirst ? (intervalMs ? Math.round((prevFirst - data[0].t) / intervalMs) : data.findIndex(d => d.t === prevFirst)) : 0;
    const grew = n - lastN.current - added;
    setEnd(e => {
      if (added > 0) return e + added;
      if (grew > 0 && e >= lastN.current - 0.5) return e + grew;
      return e;
    });
    firstT.current = data[0]?.t;
    lastN.current = n;
  }, [data, n, intervalMs]);

  const start = end - span;
  const timeLabelWidth = intervalMs ? 64 : 80;
  const timeTicks = chartTimeTicks(axis, start, span, plotW, intervalMs, timeLabelWidth);
  const timeLabel = (t: number) => intervalMs ? fmtKST(t, 'MM.dd') + '\n' + fmtKST(t, 'HH:mm') : label(t);
  const from = Math.max(0, Math.floor(start));
  const to = Math.min(n, Math.ceil(end));
  const visibleIndices = axis.slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot >= from && slot < to);
  const win = visibleIndices.map(({ index }) => data[index]);
  useEffect(() => {
    if (start < 10) onReachStart?.();
  }, [start, onReachStart]);

  const scaleBars = win.length ? win : data.filter((_, index) => axis.slots[index] < from).slice(-1);
  const lo0 = scaleBars.length ? Math.min(...scaleBars.map(d => d.l)) : 0;
  const hi0 = scaleBars.length ? Math.max(...scaleBars.map(d => d.h)) : 1;
  const pad = (hi0 - lo0) * 0.08 || hi0 * 0.01 || 1;
  const lo = lo0 - pad, hi = hi0 + pad;
  const y = (v: number) => ((v - lo) / (hi - lo)) * height; // from the bottom
  const priceAt = (py: number) => hi - (py / height) * (hi - lo); // py from the top
  const xOf = (i: number) => (i - start) * barW;
  const inRange = (v: number) => v >= lo && v <= hi;

  const hoverIndex = pointer && barW ? Math.floor(start + pointer.x / barW) : null;
  const hovered = hoverIndex != null && hoverIndex >= 0 && hoverIndex < n ? axis.indexAt(hoverIndex) : null;
  const lastHover = useRef<number | null>(null);
  useEffect(() => {
    if (lastHover.current !== hovered) {
      lastHover.current = hovered;
      onHover(hovered);
    }
  }, [hovered, onHover]);

  // Pan by pixels / zoom around a pixel x, batched to one update per frame.
  const pending = useRef({ dx: 0, zoom: 1, at: 0 });
  const frame = useRef<number | null>(null);
  // Latest values for handlers created once (PanResponder) or run later (animation frame).
  const state = useRef({ span, end, barW, plotW, n });
  state.current = { span, end, barW, plotW, n };
  const schedule = () => {
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const p = pending.current;
      pending.current = { dx: 0, zoom: 1, at: p.at };
      const { span: sp, end: e, barW: bw, plotW: pw, n: count } = state.current;
      if (!bw) return;
      let nextSpan = sp, nextEnd = e - p.dx / bw;
      if (p.zoom !== 1) {
        nextSpan = Math.min(MAX_BARS, Math.max(MIN_BARS, sp * p.zoom));
        const anchor = nextEnd - sp + (p.at / pw) * sp; // bar index under the pointer stays put
        nextEnd = anchor + (1 - p.at / pw) * nextSpan;
      }
      setSpan(nextSpan);
      setEnd(clampEnd(nextEnd, nextSpan, count));
    });
  };
  const pan = (dx: number) => { pending.current.dx += dx; schedule(); };
  const zoom = (factor: number, at: number) => { pending.current.zoom *= factor; pending.current.at = at; schedule(); };

  // iPhone gestures: one finger pans, two fingers pinch, long-press then drag = crosshair.
  const touch = useRef({ startEnd: 0, startSpan: 0, dist: 0, lastDx: 0, crosshair: false, timer: null as ReturnType<typeof setTimeout> | null });
  const interactionCallback = useRef(onInteractionChange);
  interactionCallback.current = onInteractionChange;
  const finishTouch = () => {
    const t = touch.current;
    if (t.timer) clearTimeout(t.timer);
    t.timer = null;
    t.crosshair = false;
    t.dist = 0;
    setPointer(null);
    interactionCallback.current?.(false);
  };
  useEffect(() => () => {
    if (touch.current.timer) clearTimeout(touch.current.timer);
    if (frame.current != null) cancelAnimationFrame(frame.current);
    interactionCallback.current?.(false);
  }, []);
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => true,
      onStartShouldSetPanResponder: () => true,
      onShouldBlockNativeResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: e => {
        interactionCallback.current?.(true);
        const t = touch.current;
        t.lastDx = 0;
        t.dist = 0;
        t.crosshair = false;
        const { locationX, locationY } = e.nativeEvent;
        t.timer = setTimeout(() => { t.crosshair = true; setPointer({ x: locationX, y: locationY }); }, 300);
      },
      onPanResponderMove: (e, g) => {
        const t = touch.current;
        const ts = e.nativeEvent.touches;
        if (ts.length === 2) {
          if (t.timer) clearTimeout(t.timer);
          const d = Math.hypot(ts[0].pageX - ts[1].pageX, ts[0].pageY - ts[1].pageY);
          if (t.dist) zoom(t.dist / d, (ts[0].locationX + ts[1].locationX) / 2);
          t.dist = d;
          return;
        }
        if (t.crosshair) { setPointer({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }); return; }
        if ((Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) && t.timer) { clearTimeout(t.timer); t.timer = null; }
        pan(g.dx - t.lastDx);
        t.lastDx = g.dx;
      },
      onPanResponderRelease: finishTouch,
      onPanResponderTerminate: finishTouch,
    }),
  ).current;

  const last = data[data.length - 1];
  const ticks = [0.15, 0.5, 0.85].map(f => lo0 + (hi0 - lo0) * f);
  const tagAt = (bottom: number, text: string, bg: any, key: string) => (
    <View key={key} style={[styles.tag, { bottom: Math.min(height - 9, Math.max(-9, bottom - 9)), backgroundColor: bg }]}>
      <T numberOfLines={1} style={styles.tagText}>{text}</T>
    </View>
  );
  const pointerPrice = pointer ? priceAt(Math.min(height, Math.max(0, pointer.y))) : null;

  const overlay = Tracker ? (
    <Tracker style={StyleSheet.absoluteFill}
      onChartPointer={e => setPointer({ x: e.nativeEvent.x, y: e.nativeEvent.y })}
      onChartLeave={() => setPointer(null)}
      onChartDrag={e => pan(e.nativeEvent.dx)}
      onChartWheel={e => {
        const { dx, dy, precise } = e.nativeEvent;
        if (Math.abs(dx) > Math.abs(dy)) pan(dx);
        else zoom(Math.exp(-dy * (precise ? 0.01 : 0.08)), pointer?.x ?? plotW);
      }} />
  ) : (
    <View style={StyleSheet.absoluteFill} {...responder.panHandlers} />
  );

  return (
    <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ height: height + 34 }}>
      <View style={{ flexDirection: 'row', height }}>
        <View style={{ width: plotW, height, overflow: 'hidden' }}>
          {timeTicks.map(tick => <View key={`grid-${tick.t}`} pointerEvents="none" style={{ position: 'absolute', left: tick.x, top: 0, bottom: 0, borderLeftWidth: StyleSheet.hairlineWidth, borderColor: C.separator }} />)}
          {/* Lines need a measured width: macOS aborts drawing a one-sided border on a zero-width view. */}
          {barW ? ticks.map(v => <View key={v} pointerEvents="none" style={[styles.hline, { bottom: y(v), borderColor: C.separator }]} />) : null}
          {barW && reference && inRange(reference) ? (
            <View pointerEvents="none" style={[styles.hline, { bottom: y(reference), borderColor: C.tertiary, borderStyle: 'dashed' }]} />
          ) : null}
          {barW && last && inRange(last.c) ? (
            <View pointerEvents="none" style={[styles.hline, { bottom: y(last.c), borderColor: last.c >= last.o ? C.red : C.blue, borderStyle: 'dashed' }]} />
          ) : null}
          {barW ? win.map((d, k) => {
            const i = visibleIndices[k].slot;
            const color = d.c >= d.o ? C.red : C.blue;
            const top = y(Math.max(d.o, d.c)), bottom = y(Math.min(d.o, d.c));
            return (
              <View key={d.t} pointerEvents="none" style={{ position: 'absolute', left: xOf(i), width: barW, height }}>
                <View style={{ position: 'absolute', left: barW / 2 - 0.5, width: 1, bottom: y(d.l), height: Math.max(1, y(d.h) - y(d.l)), backgroundColor: color }} />
                <View style={{ position: 'absolute', left: barW * 0.15, width: Math.max(1, barW * 0.7), bottom, height: Math.max(1, top - bottom), backgroundColor: color, borderRadius: 1 }} />
              </View>
            );
          }) : null}
          {/* crosshair: vertical through the bar under the pointer, horizontal at the pointer's height */}
          {hovered != null && barW ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: xOf(axis.slots[hovered]) + barW / 2, top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: C.secondary }} />
          ) : null}
          {pointer ? (
            <View pointerEvents="none" style={[styles.hline, { top: Math.min(height, Math.max(0, pointer.y)), borderColor: C.secondary }]} />
          ) : null}
          {!win.length && n > 0 ? <View pointerEvents="none" style={{ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' }}>
            <T style={{ color: C.secondary, fontSize: FS - 2 }}>이 시간대에는 체결 봉이 없어요</T>
          </View> : null}
          {overlay}
        </View>

        {/* right price axis */}
        <View style={{ width: AXIS, height }}>
          {ticks
            // hide a level label that a price tag would cover
            .filter(v => !(last && Math.abs(y(v) - y(last.c)) < 16) && !(pointer && Math.abs(y(v) - (height - pointer.y)) < 16))
            .map(v => <T key={v} numberOfLines={1} style={[styles.axisText, { bottom: y(v) - 7 }]}>{fmt(v)}</T>)}
          {last ? tagAt(y(last.c), fmt(last.c), last.c >= last.o ? C.red : C.blue, 'last') : null}
          {pointerPrice != null && pointer ? tagAt(height - pointer.y, fmt(pointerPrice), C.label, 'pointer') : null}
        </View>
      </View>
      <View pointerEvents="none" style={{ width: plotW, height: 30, marginTop: 4, overflow: 'hidden' }}>
        {timeTicks.map(tick => <T key={tick.t} numberOfLines={2} style={[styles.time, {
          position: 'absolute', left: tick.left, width: Math.min(timeLabelWidth, plotW), textAlign: 'center', lineHeight: 13,
        }]}>{timeLabel(tick.t)}</T>)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hline: { position: 'absolute', left: 0, right: 0, borderTopWidth: StyleSheet.hairlineWidth },
  axisText: { position: 'absolute', left: 6, fontSize: FS - 4, color: C.tertiary as any },
  tag: { position: 'absolute', left: 2, right: 0, height: 18, borderRadius: 4, justifyContent: 'center', paddingHorizontal: 4 },
  tagText: { fontSize: FS - 4, fontWeight: '700', color: C.control as any },
  time: { fontSize: FS - 4, color: C.tertiary as any },
});
