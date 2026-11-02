import React from 'react';
import { View } from 'react-native';
import { useStore } from '../store/store';
import { Btn, C, FS, Notice, Sub } from '../ui';
import { Fmt } from '../utils';

/** Sync button with its status; subscribes to live prices for the "시세 갱신" time. */
export function SyncFooter() {
  const s = useStore();
  const syncable = s.data.accounts.some(a => a.broker !== 'manual');
  return (
    <View style={{ width: '100%', maxWidth: 640, alignSelf: 'center', padding: 16, gap: 6 }}>
      <Btn title={s.isSyncing ? '동기화 중…' : '전체 동기화'} kind="primary" disabled={s.isSyncing || !syncable} onPress={() => s.sync.all()} />
      {s.syncStatus ? <Sub style={{ fontSize: FS - 2 }} numberOfLines={2}>{s.syncStatus}</Sub>
        : s.lastSyncMessage ? (s.lastSyncFailed ? <Notice title="동기화에 실패했어요" message={s.lastSyncMessage} /> : <Sub style={{ fontSize: FS - 2 }} numberOfLines={2}>{s.lastSyncMessage}</Sub>) : null}
      {s.lastPriceRefresh ? <Sub style={{ fontSize: FS - 3, color: C.tertiary }}>시세 갱신 {Fmt.dateTime(s.lastPriceRefresh)}</Sub> : null}
    </View>
  );
}
