import React from 'react';
import { ColorValue, View } from 'react-native';
import { C, FS, Sub, T, Title, num } from '../../ui';

export type InfoRow = [string, string, ColorValue?, string?];

/** Labeled rows in a rounded block: label on the left, value on the right. */
export function InfoSection({ title, rows }: { title: string; rows: InfoRow[] }) {
  return (
    <View style={{ gap: 8 }}>
      <Title>{title}</Title>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 24, paddingHorizontal: 16, paddingVertical: 4, borderRadius: 16, backgroundColor: C.control }}>
        {rows.map(([label, value, color, note]) => (
          <View key={label} style={{ width: '100%', flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, paddingVertical: 11 }}>
            <Sub numberOfLines={1} style={{ flexShrink: 1 }}>{label}</Sub>
            <T numberOfLines={1} style={[{ fontWeight: '700', color: color ?? C.label }, num]}>
              {value}
              {note ? <T style={[{ fontSize: FS - 2, fontWeight: '600', color: color ?? C.secondary }, num]}>{`  ${note}`}</T> : null}
            </T>
          </View>
        ))}
      </View>
    </View>
  );
}
