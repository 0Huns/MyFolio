import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { BrokerAccount, MergedHolding } from '../domain/models';
import { sum, useStore } from '../store/store';
import { Fmt } from '../utils';
import { C, Card, FS, Sub, T, num, pnlColor, useCompact } from '../ui';
import { AccountError } from './accounts/AccountError';
import { TodayHero, TodayMovers } from './TodayHero';

/** Today's sentence, total assets, then the day's movers, for everything or one account. */
export function AssetSummary({ account, onHoldings, onAsset, onEdit }: { account?: BrokerAccount; onHoldings: () => void; onAsset: (m: MergedHolding) => void; onEdit?: () => void }) {
  const s = useStore();
  const hide = s.data.settings.hideAmounts;
  const summary = s.summary(account?.id);
  const pnl = sum.pnl(summary);
  const toss = s.data.accounts.some(a => a.broker === 'toss' && (!account || a.id === account.id));
  return (
    <View style={{ gap: 12 }}>
      {account ? <AccountError account={account} onEdit={onEdit} /> : null}
      <TodayHero accountId={account?.id} onOpen={onHoldings} />
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <Sub>{account ? `${account.name} 자산` : '내 전체 자산'}</Sub>
          <T style={[{ fontSize: FS + 5, fontWeight: '800' }, num]}>{Fmt.krw(sum.total(summary), hide)}</T>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <Sub>넣은 돈 대비</Sub>
          <T style={[{ color: pnlColor(pnl), fontWeight: '700' }, num]}>{Fmt.signedKRW(pnl, hide)} ({Fmt.pct(sum.ret(summary))})</T>
        </View>
        {toss ? <Sub style={{ fontSize: FS - 3 }}>토스 평가금은 공제 후 기준의 추정액이에요. 비용은 잔고 동기화 시 갱신돼요.</Sub> : null}
      </Card>
      <TodayMovers accountId={account?.id} onAsset={onAsset} />
      <Pressable onPress={onHoldings} accessibilityRole="button"
        style={({ pressed }) => ({ minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: C.chipOn, opacity: pressed ? 0.85 : 1 })}>
        <T style={{ color: C.onChipOn, fontWeight: '700' }}>내 종목 전체 보기</T>
      </Pressable>
    </View>
  );
}

/** Mac home and an account's first page. */
export function AssetHome(props: React.ComponentProps<typeof AssetSummary>) {
  const compact = useCompact();
  return (
    <ScrollView contentContainerStyle={{ width: '100%', maxWidth: 640, alignSelf: 'center', padding: compact ? 16 : 24, paddingTop: compact ? 4 : 24 }}>
      <AssetSummary {...props} />
    </ScrollView>
  );
}
