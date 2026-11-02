import React from 'react';
import { Pressable, View } from 'react-native';
import { C, isIOS } from '../theme';

/** Simple column chart built from Views (no native chart dependency). */
export function Bars({ values, height = 220, color, baseline, onHover }: {
  values: number[]; height?: number; color?: any; baseline?: number[]; onHover?: (i: number | null) => void;
}) {
  const max = Math.max(1, ...values, ...(baseline ?? []));
  const min = Math.min(...values, ...(baseline ?? []), max) * 0.9;
  const scale = (v: number) => Math.max(1, ((v - min) / (max - min || 1)) * height);
  return (
    <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: values.length > 120 ? 0 : 2 }}>
      {values.map((v, i) => (
        <Pressable key={i} style={{ flex: 1, height, justifyContent: 'flex-end' }} onPressIn={isIOS ? () => onHover?.(i) : undefined}
          {...({ onHoverIn: () => onHover?.(i), onHoverOut: () => onHover?.(null) } as any)}>
          <View style={{ height: scale(v), backgroundColor: color ?? C.accent, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
          {baseline ? <View style={{ position: 'absolute', bottom: scale(baseline[i]), left: 0, right: 0, height: 1.5, backgroundColor: C.label, opacity: 0.45 }} /> : null}
        </Pressable>
      ))}
    </View>
  );
}
