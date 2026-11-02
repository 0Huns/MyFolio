import React from 'react';
import { Pressable, View } from 'react-native';
import { MergedHolding } from '../domain/models';
import { dayHeadline, moverLine, movers } from '../domain/story';
import { sum, useStore } from '../store/store';
import { Fmt } from '../utils';
import { C, Card, FS, HeroCard, Sub, T, num, pnlColor } from '../ui';

/** The day in one sentence. */
export function TodayHero({ accountId, onOpen }: { accountId?: string; onOpen?: () => void }) {
  const s = useStore();
  const { label, title } = dayHeadline(s.daySummary(accountId), sum.total(s.summary(accountId)), s.data.settings.hideAmounts);
  const { up, down } = movers(s.merged(accountId), m => s.dayChange(m)?.rate);
  const top = up ?? down;
  return <HeroCard label={label} title={title} note={top ? moverLine(top.row.name, top.rate) : undefined} onPress={onOpen} />;
}

/** The day's biggest rise and fall; a single mover takes the whole row. */
export function TodayMovers({ accountId, onAsset }: { accountId?: string; onAsset: (m: MergedHolding) => void }) {
  const s = useStore();
  const { up, down } = movers(s.merged(accountId), m => s.dayChange(m)?.rate);
  const cards = [
    { caption: '가장 많이 오름', mover: up },
    { caption: '가장 많이 내림', mover: down },
  ].flatMap(({ caption, mover }) => (mover ? [{ caption, ...mover }] : []));
  return (
    <View style={{ gap: 12 }}>
      <T style={{ fontSize: FS + 1, fontWeight: '700', marginTop: 6, paddingHorizontal: 4 }}>오늘의 주인공</T>
      {cards.length ? (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {cards.map(({ caption, row, rate }) => (
            <Pressable key={caption} style={{ flex: 1 }} accessibilityRole="button" onPress={() => onAsset(row)}>
              <Card style={{ padding: 16, gap: 3 }}>
                <Sub style={{ fontSize: FS - 2 }}>{caption}</Sub>
                <T numberOfLines={1} style={{ fontWeight: '700' }}>{row.name}</T>
                <T style={[{ fontSize: FS + 7, fontWeight: '800', color: pnlColor(rate) }, num]}>{Fmt.pct(rate)}</T>
              </Card>
            </Pressable>
          ))}
        </View>
      ) : <Sub style={{ color: C.secondary, paddingHorizontal: 4 }}>오늘의 등락 정보를 기다리고 있어요.</Sub>}
    </View>
  );
}
