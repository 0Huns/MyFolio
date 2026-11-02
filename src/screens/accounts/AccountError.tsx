import React from 'react';
import { View } from 'react-native';
import { BrokerAccount } from '../../domain/models';
import { useStore } from '../../store/store';
import { describeError } from '../../utils';
import { Chip, FS, Notice, Sub } from '../../ui';

/** Why an account's last sync failed, with the ways to fix it. */
export function AccountError({ account, onEdit }: { account: BrokerAccount; onEdit?: () => void }) {
  const s = useStore();
  const err = account.lastError ? describeError(account.lastError) : null;
  if (!err) return null;
  return (
    <Notice title={err.title} message={err.hint || undefined}>
      <Sub selectable style={{ fontSize: FS - 3 }} numberOfLines={4}>{err.detail}</Sub>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
        <Chip on title={s.isSyncing ? '연결 중…' : '다시 시도'} off={s.isSyncing} onPress={() => s.sync.one(account.id)} />
        {onEdit ? <Chip title="키 다시 입력" onPress={onEdit} /> : null}
      </View>
    </Notice>
  );
}
