import React from 'react';
import { Text } from 'react-native';
import { C, FONT, FS, isIOS } from './theme';

export function T({ style, children, ...p }: React.ComponentProps<typeof Text>) {
  return <Text {...p} style={[{ fontFamily: FONT, color: C.label, fontSize: FS, letterSpacing: -0.2 }, style]}>{children}</Text>;
}
export const Sub = ({ style, ...p }: React.ComponentProps<typeof Text>) => <T {...p} style={[{ color: C.secondary, fontSize: FS - 1 }, style]} />;
export const H = ({ style, ...p }: React.ComponentProps<typeof Text>) => <T {...p} style={[{ fontSize: isIOS ? 24 : 22, fontWeight: '700', letterSpacing: -0.5 }, style]} />;
/** Card / section heading. */
export const Title = ({ style, ...p }: React.ComponentProps<typeof Text>) => <T {...p} style={[{ fontSize: FS + 2, fontWeight: '700' }, style]} />;
