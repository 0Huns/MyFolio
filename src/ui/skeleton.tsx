import React from 'react';
import * as RN from 'react-native';
import { View, ViewStyle } from 'react-native';
import { C } from './theme';

/** One pulse shared by every skeleton on screen, so placeholders breathe in sync (runs on the native driver). */
let pulse: RN.Animated.Value | null = null;
function sharedPulse() {
  if (!pulse) {
    pulse = new RN.Animated.Value(0.45);
    RN.Animated.loop(RN.Animated.sequence([
      RN.Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      RN.Animated.timing(pulse, { toValue: 0.45, duration: 650, useNativeDriver: true }),
    ])).start();
  }
  return pulse;
}

/**
 * Placeholder block with the same size as the content it stands in for, so nothing shifts when data arrives.
 * Text placeholders: pass the line height as `height` (e.g. FS + 4) so the block occupies a text line exactly.
 */
export function Skeleton({ width, height = 12, radius = 6, style }: { width: RN.DimensionValue; height?: number; radius?: number; style?: ViewStyle }) {
  return <RN.Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: C.fill, opacity: sharedPulse() }, style]} />;
}

/** Placeholder list rows (title/subtitle left, value/sub-value right), matching ListRow's height. */
export function SkeletonRows({ rows = 8, avatar }: { rows?: number; avatar?: boolean }) {
  return (
    <View style={{ gap: 18, paddingVertical: 12 }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {avatar ? <Skeleton width={40} height={40} radius={20} /> : null}
          <View style={{ flex: 1, gap: 7 }}><Skeleton width={`${45 + ((i * 17) % 30)}%`} /><Skeleton width="30%" height={10} /></View>
          <View style={{ alignItems: 'flex-end', gap: 7 }}><Skeleton width={80} /><Skeleton width={56} height={10} /></View>
        </View>
      ))}
    </View>
  );
}
