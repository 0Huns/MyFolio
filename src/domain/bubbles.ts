export type Bubble = { key: string; x: number; y: number; r: number };

/**
 * Packs circles (area ∝ value) into a width × height box, largest first, each on the first free spot of a spiral
 * around the center. Deterministic, so the same values always give the same map. `x`, `y` are circle centers.
 */
export function packBubbles(items: { key: string; value: number }[], width: number, height: number, gap = 4): Bubble[] {
  const sorted = items.filter(i => i.value > 0 && Number.isFinite(i.value)).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((a, i) => a + i.value, 0);
  if (!total || width <= 0 || height <= 0) return [];
  const aspect = width / height;
  const unitGap = 0.02;
  const placed: Bubble[] = [];
  for (const item of sorted) {
    const r = Math.sqrt(item.value / total);
    for (let t = 0; ; t += 0.15) {
      const x = t * 0.03 * Math.cos(t) * aspect, y = t * 0.03 * Math.sin(t);
      if (placed.every(b => Math.hypot(b.x - x, b.y - y) >= b.r + r + unitGap)) {
        placed.push({ key: item.key, x, y, r });
        break;
      }
    }
  }
  const minX = Math.min(...placed.map(b => b.x - b.r)), maxX = Math.max(...placed.map(b => b.x + b.r));
  const minY = Math.min(...placed.map(b => b.y - b.r)), maxY = Math.max(...placed.map(b => b.y + b.r));
  const scale = Math.min(width / (maxX - minX), height / (maxY - minY));
  const offX = (width - (maxX - minX) * scale) / 2, offY = (height - (maxY - minY) * scale) / 2;
  return placed.map(b => ({
    key: b.key,
    x: (b.x - minX) * scale + offX,
    y: (b.y - minY) * scale + offY,
    r: Math.max(1, b.r * scale - gap / 2 + (unitGap * scale) / 2),
  }));
}
