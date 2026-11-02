import React, { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { C, FS, useCompact, isIOS } from './theme';
import { T } from './text';
import { Btn } from './controls';

/** Modal overlay: a bottom sheet on phones, a centered card on wider windows. */
export function Sheet({ children, onClose, width = 560 }: { children: ReactNode; onClose: () => void; width?: number }) {
  const compact = useCompact();
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: compact ? 'flex-end' : 'center', zIndex: 100 }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={compact
        ? { width: '100%', maxHeight: '92%', backgroundColor: C.control, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden', paddingBottom: isIOS ? 24 : 0 }
        : { width, maxWidth: '94%', maxHeight: '90%', backgroundColor: C.control, borderRadius: 24, overflow: 'hidden' }}>
        {compact ? <View style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: C.separator, marginTop: 8 }} /> : null}
        <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, gap: 14 }}>{children}</ScrollView>
      </View>
    </View>
  );
}

export function Confirm({ message, action, onConfirm, onClose }: { message: string; action: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Sheet onClose={onClose} width={400}>
      <T style={{ fontSize: FS + 2, fontWeight: '700', lineHeight: FS + 10 }}>{message}</T>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
        <Btn title="취소" onPress={onClose} style={{ flex: 1 }} />
        <Btn title={action} kind="primary" onPress={() => { onConfirm(); onClose(); }} style={{ flex: 1 }} />
      </View>
    </Sheet>
  );
}
