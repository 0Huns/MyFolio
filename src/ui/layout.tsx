import React, { ReactNode } from 'react';
import { ColorValue, Pressable, View, ViewStyle } from 'react-native';
import { Fmt } from '../utils';
import { C, FS, num, pnlColor } from './theme';
import { Sub, T } from './text';

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ backgroundColor: C.control, borderRadius: 22, padding: 18 }, style]}>{children}</View>;
}

/** Something went wrong (or needs attention): the same card everywhere, with actions as children. */
export function Notice({ title, message, warn, children }: { title?: string; message?: string; warn?: boolean; children?: ReactNode }) {
  const color = warn ? C.orange : C.red;
  return (
    <View style={{ gap: 8, padding: 16, borderRadius: 18, backgroundColor: warn ? C.orangeSoft : C.redSoft }}>
      {title ? <T style={{ color, fontWeight: '700' }}>{title}</T> : null}
      {message ? <T selectable numberOfLines={6} style={{ fontSize: FS - 1, lineHeight: FS + 5 }}>{message}</T> : null}
      {children}
    </View>
  );
}

/** The one-sentence summary at the top of a page. */
export function HeroCard({ label, title, note, onPress, children }: { label: string; title: string; note?: string; onPress?: () => void; children?: ReactNode }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => ({ backgroundColor: C.hero, borderRadius: 24, padding: 22, gap: 8, opacity: pressed ? 0.9 : 1 })}>
      <T style={{ color: C.onHero, fontSize: FS - 1, fontWeight: '500' }}>{label}</T>
      <T style={[{ color: C.onHero, fontSize: 28, lineHeight: 37, fontWeight: '800', letterSpacing: -0.8 }, num]}>{title}</T>
      {note ? <T style={{ color: C.onHero, fontSize: FS - 1, lineHeight: FS + 6 }}>{note}</T> : null}
      {children}
    </Pressable>
  );
}

/** Details kept out of the way until asked for. */
export function Fold({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <View style={{ gap: 12 }}>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={({ pressed }) => ({ alignItems: 'center', justifyContent: 'center', minHeight: 52, paddingHorizontal: 36, borderRadius: 18, backgroundColor: pressed ? C.fill : C.control })}>
        <T style={{ fontWeight: '700', textAlign: 'center' }}>{title}</T>
        <T style={{ position: 'absolute', right: 16, color: C.tertiary, fontSize: FS + 4 }}>{open ? '⌃' : '⌄'}</T>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

export function Stat({ title, value, color, big }: { title: string; value: string; color?: any; big?: boolean }) {
  return (
    <View style={{ gap: 3 }}>
      <Sub style={{ fontSize: FS - 2 }}>{title}</Sub>
      <T style={{ fontSize: big ? FS + 4 : FS, fontWeight: big ? '700' : '600', color: color ?? C.label, fontVariant: ['tabular-nums'] }}>{value}</T>
    </View>
  );
}

export function Empty({ title, message, children }: { title: string; message?: string; children?: ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 40 }}>
      <T style={{ fontSize: FS + 4, fontWeight: '700' }}>{title}</T>
      {message ? <Sub style={{ textAlign: 'center', lineHeight: FS + 7 }}>{message}</Sub> : null}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>{children}</View>
    </View>
  );
}

/** "오늘 +12,300원 (+0.52%)" */
export function DayLine({ day, hide }: { day: { amount: number; rate: number }; hide: boolean }) {
  return (
    <T style={[{ fontSize: FS - 1 }, num]}>
      <T style={{ fontSize: FS - 1, color: C.secondary }}>오늘 </T>
      <T style={{ fontSize: FS - 1, color: pnlColor(day.amount), fontWeight: '600' }}>{Fmt.signedKRW(day.amount, hide)} ({Fmt.pct(day.rate)})</T>
    </T>
  );
}

/** Round badge with the first letter of a name. */
export function Avatar({ text, color, size = 40 }: { text: string; color?: ColorValue; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.fill, alignItems: 'center', justifyContent: 'center' }}>
      <T style={{ fontWeight: '700', fontSize: size * 0.38, color: color ?? C.secondary }}>{text.slice(0, 1).toUpperCase()}</T>
    </View>
  );
}

/** List item: optional leading view, title/subtitle on the left, value/sub-value on the right. */
export function ListRow({ left, title, subtitle, right, rightSub, rightSubColor, onPress, chevron }: {
  left?: ReactNode; title: ReactNode; subtitle?: ReactNode; right?: ReactNode; rightSub?: ReactNode; rightSubColor?: ColorValue; onPress?: () => void; chevron?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 12, backgroundColor: pressed ? C.fill : undefined })}>
      {left}
      <View style={{ flex: 1, gap: 2 }}>
        {typeof title === 'string' ? <T style={{ fontWeight: '600' }} numberOfLines={1}>{title}</T> : title}
        {typeof subtitle === 'string' ? <Sub style={{ fontSize: FS - 2 }} numberOfLines={1}>{subtitle}</Sub> : subtitle}
      </View>
      {right !== undefined ? (
        <View style={{ alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
          {typeof right === 'string' ? <T style={[{ fontWeight: '600' }, num]}>{right}</T> : right}
          {typeof rightSub === 'string' ? <T style={[{ fontSize: FS - 2, color: rightSubColor ?? C.secondary }, num]}>{rightSub}</T> : rightSub}
        </View>
      ) : null}
      {chevron ? <T style={{ color: C.tertiary, fontSize: FS + 4 }}>›</T> : null}
    </Pressable>
  );
}
