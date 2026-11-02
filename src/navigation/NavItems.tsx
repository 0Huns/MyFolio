import React from 'react';
import { View } from 'react-native';
import { C, T } from '../ui';

export function Icon({ glyph, accent }: { glyph: string; accent?: boolean }) {
  return (
    <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: accent ? C.chipOn : C.fill, alignItems: 'center', justifyContent: 'center' }}>
      <T style={{ fontWeight: '700', color: accent ? C.onChipOn : C.secondary }}>{glyph}</T>
    </View>
  );
}
