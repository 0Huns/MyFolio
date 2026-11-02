import React from 'react';
import { ScrollView, View } from 'react-native';
import { Brokers, MergedHolding } from '../domain/models';
import { AssetSummary } from '../screens/AssetHome';
import { sum, useStore } from '../store/store';
import { Fmt, describeError } from '../utils';
import { C, Card, FS, ListRow, T, Title, pnlColor } from '../ui';
import { Icon } from './NavItems';
import { Page, pages } from './pages';

/** Home on every window size: today's sentence and total assets, then grouped cards for pages and accounts. */
export function Home({ onPage, onAsset, onAdd, footer }: { onPage: (p: Page) => void; onAsset: (m: MergedHolding) => void; onAdd: (exchange: boolean) => void; footer: React.ReactNode }) {
  const s = useStore();
  const hide = s.data.settings.hideAmounts;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ width: '100%', maxWidth: 640, alignSelf: 'center', padding: 16, gap: 12 }}>
        <T style={{ fontSize: 22, fontWeight: '800', letterSpacing: -0.5, paddingHorizontal: 4, paddingTop: 4 }}>MyFolio</T>

        <AssetSummary onHoldings={() => onPage('portfolio')} onAsset={onAsset} />

        <Card style={{ paddingVertical: 8 }}>
          {pages.map(([p, label, icon]) => (
            <ListRow key={p} left={<Icon glyph={icon} />} title={label} onPress={() => onPage(p)} chevron />
          ))}
        </Card>

        {(['증권사', '거래소'] as const).map(section => {
          const exchange = section === '거래소';
          return (
            <Card key={section} style={{ paddingVertical: 14 }}>
              <Title style={{ marginBottom: 4 }}>{section}</Title>
              {s.data.accounts.filter(a => Brokers[a.broker].exchange === exchange).map(a => {
                const as = s.summary(a.id);
                return (
                  <ListRow key={a.id} left={<Icon glyph={a.name.slice(0, 1)} />} onPress={() => onPage(`account:${a.id}`)}
                    title={a.name}
                    subtitle={a.lastError
                      ? <T style={{ fontSize: FS - 2, color: C.red, fontWeight: '600' }} numberOfLines={1}>{describeError(a.lastError).title}</T>
                      : a.lastSyncDate ? `동기화 ${Fmt.dateTime(a.lastSyncDate)}` : a.broker === 'manual' ? '수동 계좌' : '동기화 필요'}
                    right={Fmt.krw(sum.total(as), hide)} rightSub={Fmt.pct(sum.ret(as))} rightSubColor={pnlColor(sum.pnl(as))} />
                );
              })}
              <ListRow left={<Icon glyph="＋" accent />} title={<T style={{ fontWeight: '700' }}>{exchange ? '거래소 추가' : '증권사 추가'}</T>} onPress={() => onAdd(exchange)} />
            </Card>
          );
        })}

        <Card style={{ paddingVertical: 8 }}>
          <ListRow left={<Icon glyph={'⚙︎'} />} title="설정" onPress={() => onPage('settings')} chevron />
        </Card>
      </ScrollView>
      {footer}
    </View>
  );
}
