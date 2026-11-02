import React from 'react';
import { Linking, Platform, Pressable, StyleSheet, TextInput, View, ViewStyle } from 'react-native';
import { C, FONT, FS } from './theme';
import { Sub, T } from './text';

export function Btn({ title, onPress, kind = 'normal', disabled, small, style }: {
  title: string; onPress: () => void; kind?: 'normal' | 'primary' | 'danger' | 'link'; disabled?: boolean; small?: boolean; style?: ViewStyle;
}) {
  const bg = kind === 'primary' ? C.chipOn : kind === 'danger' ? C.redSoft : kind === 'link' ? undefined : C.chip;
  const color = kind === 'primary' ? C.onChipOn : kind === 'danger' ? C.red : kind === 'link' ? C.accent : C.label;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        {
          paddingHorizontal: kind === 'link' ? 0 : small ? 12 : 18, paddingVertical: kind === 'link' ? 4 : small ? 7 : 12,
          minHeight: kind === 'link' || small ? undefined : 48, borderRadius: small ? 10 : 14, backgroundColor: bg, alignItems: 'center', justifyContent: 'center',
          opacity: disabled ? 0.35 : pressed ? 0.75 : 1, transform: [{ scale: pressed && !disabled ? 0.97 : 1 }],
        },
        style,
      ]}>
      <T style={{ color, fontSize: small ? FS - 1 : FS, fontWeight: '600' }}>{title}</T>
    </Pressable>
  );
}

export const Link = ({ title, url }: { title: string; url: string }) => <Btn kind="link" title={title} onPress={() => Linking.openURL(url)} />;

/** Pill button; dark when on. */
export function Chip({ title, on, onPress, fill, off, danger }: { title: string; on?: boolean; onPress: () => void; fill?: boolean; off?: boolean; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={off} accessibilityRole="button" accessibilityState={{ selected: !!on, disabled: !!off }}
      style={({ pressed }) => ({ flex: fill ? 1 : undefined, minHeight: 44, paddingHorizontal: fill ? 2 : 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: danger ? C.redSoft : on ? C.chipOn : C.chip, opacity: off ? 0.45 : pressed ? 0.8 : 1 })}>
      <T numberOfLines={1} style={{ fontSize: FS - 1, fontWeight: on ? '700' : '500', textAlign: 'center', color: danger ? C.red : on ? C.onChipOn : C.label }}>{title}</T>
    </Pressable>
  );
}

/** One choice out of a few, as pills. `fill` shares the row evenly. */
export function Chips<V extends string | number>({ value, options, onChange, fill, disabled }: { value: V; options: [V, string][]; onChange: (v: V) => void; fill?: boolean; disabled?: V[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, flexWrap: fill ? 'nowrap' : 'wrap' }}>
      {options.map(([v, label]) => {
        const off = disabled?.includes(v);
        return <Chip key={String(v)} title={label} on={v === value && !off} off={off} fill={fill} onPress={() => onChange(v)} />;
      })}
    </View>
  );
}

/** A saved key: a check mark instead of the input, until the user asks to change it. */
export function KeySaved({ title, onEdit, children }: { title: string; onEdit: () => void; children?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: 12, borderRadius: 14, backgroundColor: C.fill }}>
      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' }}>
        <T style={{ color: '#FFFFFF', fontWeight: '800', fontSize: FS - 1, lineHeight: FS + 3 }}>✓</T>
      </View>
      <T style={{ flex: 1, minWidth: 110, fontWeight: '700' }}>{title}</T>
      <Chip title="수정" onPress={onEdit} />
      {children}
    </View>
  );
}

export function Field({ label, value, onChange, placeholder, secure, multiline, style, onWindow }: {
  label?: string; value: string; onChange: (s: string) => void; placeholder?: string; secure?: boolean; multiline?: boolean; style?: ViewStyle;
  /** Sits directly on the window background rather than inside a card. */
  onWindow?: boolean;
}) {
  const [reveal, setReveal] = React.useState(false);
  // macOS's secure text field drops pasted text before it reaches JS, so mask a plain field ourselves there.
  const maskInJS = Platform.OS === 'macos';
  const masked = !!secure && !reveal && maskInJS;
  return (
    <View style={[{ gap: 6 }, style]}>
      {label || secure ? (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Sub style={{ flex: 1, fontSize: FS - 2, fontWeight: onWindow ? '400' : '600' }}>{label}</Sub>
          {secure ? (
            <Pressable hitSlop={8} onPress={() => setReveal(r => !r)}>
              <Sub style={{ fontSize: FS - 2, color: C.accent, fontWeight: '600' }}>{reveal ? '숨기기' : '보기'}</Sub>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {/* The box is drawn here so one line of text sits in its vertical center on iOS and macOS alike. */}
      <View style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 14, backgroundColor: (onWindow ? C.control : C.fill) as any }}>
        <TextInput
          value={value} onChangeText={onChange} placeholder={placeholder} multiline={multiline}
          secureTextEntry={secure && !reveal && !maskInJS}
          placeholderTextColor={C.tertiary as any}
          style={{ fontFamily: FONT, color: (masked ? 'transparent' : C.label) as any, fontSize: FS, padding: 0, paddingVertical: multiline ? 10 : 0, textAlignVertical: 'center', backgroundColor: 'transparent' }}
        />
        {masked && value ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { justifyContent: 'center', paddingHorizontal: 14 }]}>
            <T numberOfLines={1} style={{ fontSize: FS, letterSpacing: 1 }}>{'•'.repeat(value.length)}</T>
          </View>
        ) : null}
      </View>
    </View>
  );
}
