import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { packBubbles } from '../../domain/bubbles';
import { T } from '../text';

export type BubbleItem = { key: string; label: string; sub?: string; value: number; tone: 'up' | 'down' | 'flat'; onPress?: () => void };

// Fixed in both appearances: white text stays readable on all three.
const tones = { up: '#D92D3A', down: '#2563EB', flat: '#4A5368' };

/** Circles sized by value and colored by today's move. Fills its parent; give it a height or flex. */
export function BubbleMap({ items, height }: { items: BubbleItem[]; height?: number }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const total = items.reduce((a, i) => a + i.value, 0) || 1;
  // Rounded shares: live ticks shouldn't reshuffle the map.
  const shape = items.map(i => `${i.key}:${Math.round((i.value / total) * 60)}`).join();
  const packed = useMemo(
    () => packBubbles(items.map(i => ({ key: i.key, value: Math.max(1, Math.round((i.value / total) * 60)) })), box.w, box.h),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shape, box.w, box.h],
  );
  const byKey = new Map(items.map(i => [i.key, i]));
  return (
    <View style={height ? { height } : { flex: 1, minHeight: 260 }}
      onLayout={e => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {packed.map(b => {
        const item = byKey.get(b.key);
        if (!item) return null;
        const size = b.r * 2;
        const name = Math.max(11, Math.min(20, b.r / 3.4));
        return (
          <Pressable key={b.key} onPress={item.onPress} disabled={!item.onPress} accessibilityRole="button"
            accessibilityLabel={[item.label, item.sub].filter(Boolean).join(' ')}
            style={({ pressed }) => ({
              position: 'absolute', left: b.x - b.r, top: b.y - b.r, width: size, height: size, borderRadius: b.r,
              backgroundColor: tones[item.tone], alignItems: 'center', justifyContent: 'center', padding: 6, opacity: pressed ? 0.8 : 1,
            })}>
            {b.r >= 22 ? <T numberOfLines={1} style={{ color: '#FFFFFF', fontWeight: '800', fontSize: name, textAlign: 'center' }}>{item.label}</T> : null}
            {b.r >= 34 && item.sub ? <T numberOfLines={1} style={{ color: '#FFFFFF', fontWeight: '600', fontSize: Math.max(11, name - 2), textAlign: 'center' }}>{item.sub}</T> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
