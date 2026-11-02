import type { Candle } from './models';

/** Sparse time slots: absent bars occupy time, without allocating or inventing candles. */
export function chartAxis(data: Candle[], intervalMs = 0) {
  const first = data[0]?.t ?? 0;
  const slots = data.map((bar, index) => intervalMs > 0 ? Math.round((bar.t - first) / intervalMs) : index);
  const indices = new Map(slots.map((slot, index) => [slot, index]));
  return {
    slots,
    count: slots.length ? slots[slots.length - 1] + 1 : 0,
    indexAt: (slot: number) => indices.get(slot) ?? null,
    timeAt: (slot: number) => intervalMs > 0 ? first + slot * intervalMs : data[slot]?.t,
  };
}

/** Clock-aligned ticks sized for the visible time range and available label width. */
export function chartTimeTicks(axis: ReturnType<typeof chartAxis>, start: number, span: number, width: number, intervalMs = 0, labelWidth = 64) {
  if (width <= 0 || span <= 0 || !axis.count) return [];
  const minSlot = Math.max(0, Math.ceil(start));
  const maxSlot = Math.min(axis.count - 1, Math.floor(start + span));
  if (minSlot > maxSlot) return [];
  const capacity = Math.max(1, Math.floor(width / (labelWidth + 12)));
  const desiredSlots = span / capacity;
  const steps = intervalMs ? [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].map(m => m * 60_000) : [1, 2, 5, 10, 20, 30, 60, 120];
  const wanted = desiredSlots * (intervalMs || 1);
  const step = steps.find(value => value >= wanted) ?? Math.ceil(wanted / steps[steps.length - 1]) * steps[steps.length - 1];
  const origin = axis.timeAt(0) ?? 0;
  // Match the KST labels, including 12/24-hour steps.
  const offset = 9 * 3600_000;
  let slot = intervalMs ? (Math.ceil((origin + minSlot * intervalMs + offset) / step) * step - offset - origin) / intervalMs : Math.ceil(minSlot / step) * step;
  const increment = intervalMs ? step / intervalMs : step;
  const result: { t: number; x: number; left: number }[] = [];
  const actualWidth = Math.min(labelWidth, width);
  for (; slot <= maxSlot; slot += increment) {
    const t = axis.timeAt(slot);
    if (t == null) continue;
    const x = (slot - start + 0.5) / span * width;
    if (x < 0 || x > width) continue;
    const left = Math.max(0, Math.min(width - actualWidth, x - actualWidth / 2));
    if (result.length && left < result[result.length - 1].left + actualWidth + 8) continue;
    result.push({ t, x, left });
  }
  if (!result.length) {
    const slot0 = Math.round((minSlot + maxSlot) / 2);
    const t = axis.timeAt(slot0);
    if (t != null) {
      const x = (slot0 - start + 0.5) / span * width;
      result.push({ t, x, left: Math.max(0, Math.min(width - actualWidth, x - actualWidth / 2)) });
    }
  }
  return result;
}
