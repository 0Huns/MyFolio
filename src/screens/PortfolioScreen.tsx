import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { BrokerAccount, MergedHolding, marketLabel, mh } from '../domain/models';
import { Native } from '../platform/native';
import { store, sum, useStore } from '../store/store';
import { holdingsCSV } from '../store/reports';
import { Fmt } from '../utils';
import { Avatar, BubbleItem, BubbleMap, Btn, C, Card, Chip, Chips, Empty, FS, HeroCard, Notice, SkeletonRows, Sub, T, Title, num, pnlColor, useAfterFirstFrame, useCompact } from '../ui';
import { CopyPortfolio } from '../ui/CopyPortfolio';
import { ManualHoldingEditor } from './accounts/ManualHoldingEditor';
import { AccountError } from './accounts/AccountError';

type Sort = 'value' | 'ret' | 'name';

export function PortfolioScreen({ account, startWith = 'map', onEdit, onAdd, onSelectAsset }: { account?: BrokerAccount; startWith?: 'map' | 'list'; onEdit?: () => void; onAdd?: (exchange: boolean) => void; onSelectAsset: (holding: MergedHolding) => void }) {
  const s = useStore();
  const [sort, setSort] = useState<Sort>('value');
  const [layout, setLayout] = useState<'map' | 'list'>(startWith);
  const [addingManual, setAddingManual] = useState(false);
  const hide = s.data.settings.hideAmounts;
  const compact = useCompact();
  const ready = useAfterFirstFrame();

  if (!account && !s.data.accounts.length) {
    return (
      <Empty title="연결된 증권사가 없어요" message={'증권사나 거래소 계좌를 연결하면\n보유 종목과 손익을 한눈에 볼 수 있어요.'}>
        <Btn title="증권사 추가하기" kind="primary" onPress={() => onAdd?.(false)} />
        <Btn title="거래소 추가" onPress={() => onAdd?.(true)} />
      </Empty>
    );
  }

  const summary = s.summary(account?.id);
  const krw = (m: MergedHolding) => s.toKRW(mh.value(m), mh.currency(m));
  const rows = s.merged(account?.id);
  rows.sort(sort === 'value' ? (a, b) => krw(b) - krw(a) : sort === 'ret' ? (a, b) => s.holdingReturn(b) - s.holdingReturn(a) : (a, b) => a.name.localeCompare(b.name));
  const pnl = sum.pnl(summary);
  const parts = [['증권', summary.stock, C.accent], ['코인', summary.crypto, C.orange], ['현금', summary.cash, C.green]] as const;
  const total = sum.total(summary) || 1;
  const holdingPnl = (m: MergedHolding) => s.holdingPnl(m);
  const day = s.daySummary(account?.id);

  // Bubble map: the largest holdings, the rest grouped, and cash when the whole portfolio is shown.
  const byValue = [...rows].sort((a, b) => krw(b) - krw(a));
  const bubbles: BubbleItem[] = byValue.slice(0, 11).map(m => {
    const rate = s.dayChange(m)?.rate;
    const share = total > 0 ? (krw(m) / total) * 100 : 0;
    return {
      key: m.identityKey, label: m.name, value: krw(m), onPress: () => onSelectAsset(m),
      sub: rate === undefined ? `${share.toFixed(0)}%` : Fmt.pct(rate),
      tone: rate === undefined || rate === 0 ? 'flat' : rate > 0 ? 'up' : 'down',
    };
  });
  const rest = byValue.slice(11).reduce((a, m) => a + krw(m), 0);
  if (rest > 0) bubbles.push({ key: 'rest', label: `그 외 ${byValue.length - 11}종목`, value: rest, tone: 'flat' });
  if (summary.cash > 0) bubbles.push({ key: 'cash', label: '현금', sub: '쉬는 돈', value: summary.cash, tone: 'flat' });
  const largest = byValue[0];
  const largestShare = largest && total > 0 ? (krw(largest) / total) * 100 : 0;
  // Dark in both appearances, so the colored circles stand out.
  const map = (
    <View style={{ backgroundColor: C.panel, borderRadius: 24, padding: compact ? 18 : 24, gap: 14 }}>
      <View style={{ gap: 2 }}>
        <T style={{ color: '#FFFFFF', fontWeight: '700' }}>{account ? `${account.name} 지도` : '내 자산 지도'}</T>
        <T style={[{ color: '#FFFFFF', fontSize: 32, fontWeight: '800', letterSpacing: -1 }, num]}>{Fmt.krw(sum.total(summary), hide)}</T>
        {day ? <T style={[{ color: '#FF8A8F', fontWeight: '600' }, num, day.amount < 0 && { color: '#8FB4FF' }, day.amount === 0 && { color: '#C9D2E6' }]}>오늘 {Fmt.signedKRW(day.amount, hide)} ({Fmt.pct(day.rate)})</T> : null}
      </View>
      <BubbleMap items={bubbles} height={compact ? 360 : 480} />
      <T style={{ color: '#C9D2E6', fontSize: FS - 2 }}>크기는 금액, 빨강은 오름, 파랑은 내림이에요.</T>
      {largestShare >= 40 ? (
        <View style={{ backgroundColor: C.panelBox, borderRadius: 16, padding: 14 }}>
          <T style={{ color: '#FFFFFF', fontSize: FS - 1, lineHeight: FS + 6 }}>{largest.name} 비중이 {largestShare.toFixed(0)}%예요. 한 종목의 움직임이 전체에 크게 반영돼요.</T>
        </View>
      ) : null}
    </View>
  );

  const heroLine = { color: C.onHero, fontSize: FS - 1 };
  const summaryCard = (
    <View style={{ gap: 12 }}>
      <HeroCard label={account ? `${account.name} 전체 자산` : '내 전체 자산'} title={Fmt.krw(sum.total(summary), hide)}>
        <T style={[{ color: C.onHero, fontWeight: '700' }, num]}>넣은 돈보다 {Fmt.signedKRW(pnl, hide)} ({Fmt.pct(sum.ret(summary))})</T>
        {day ? <T style={[heroLine, num]}>오늘 {Fmt.signedKRW(day.amount, hide)} ({Fmt.pct(day.rate)})</T> : null}
        <T style={{ color: C.onHero, fontSize: FS - 3 }}>{s.rates.label}</T>
      </HeroCard>

      <Card style={{ padding: 18, borderRadius: 22, gap: 12 }}>
        <Title>내 돈은 어디에 있나요</Title>
        <View style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: C.fill, gap: 2 }}>
          {parts.map(([label, v, color]) => (v > 0 ? <View key={label} style={{ flex: v / total, backgroundColor: color }} /> : null))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 }}>
          {[...parts.map(([label, v, color]) => ({ label: `${label} ${((v / total) * 100).toFixed(1)}%`, value: v, color })), { label: '넣은 돈', value: summary.cost, color: undefined }].map(({ label, value, color }) => (
            <View key={label} style={{ width: '50%', gap: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {color ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} /> : null}
                <Sub style={{ fontSize: FS - 2 }}>{label}</Sub>
              </View>
              <T style={[{ fontWeight: '700' }, num]}>{Fmt.krw(value, hide)}</T>
            </View>
          ))}
        </View>
        {s.fxError ? <Notice warn message="환율을 새로 받지 못해 마지막 값을 쓰고 있어요." /> : null}
        {s.data.accounts.some(a => a.broker === 'toss' && (!account || a.id === account.id)) ? (
          <Sub style={{ fontSize: FS - 3, lineHeight: FS + 2 }}>토스 평가금은 공제 후 평가액에 실시간 가격 변동분을 반영한 추정액이에요. 확인된 수수료율로 변동 비용을 추정하며, 세금·기타 비용은 잔고 동기화 시 갱신돼요. 원화 평가금은 달러 평가금의 환산 추정치로 토스 화면과 다를 수 있어요. 토스 현금은 마지막 동기화의 원화·달러 매수가능금액 합계예요. 달러는 현재 환율로 환산하며, 주문 등에 묶인 금액은 제외될 수 있어요.</Sub>
        ) : null}
        {s.data.holdings.some(h => (!account || h.accountId === account.id) && s.account(h.accountId)?.broker === 'toss' && h.amountAfterCost == null) ? (
          <Notice warn message="공제 후 평가금액을 적용하려면 토스 계좌를 동기화해 주세요. 기존 데이터에는 공제 전 금액이 표시돼요." />
        ) : null}
      </Card>

      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        {account?.broker === 'manual' ? <Chip title="종목 추가" onPress={() => setAddingManual(true)} /> : null}
        {onEdit ? <Chip title="계좌 편집" onPress={onEdit} /> : null}
        <Chip title={hide ? '금액 보기' : '금액 숨기기'} onPress={() => s.updateSettings({ hideAmounts: !hide })} />
        <Chip title={s.data.settings.displayCurrency === 'usd' ? '원화로 보기' : '달러로 보기'}
          onPress={() => s.updateSettings({ displayCurrency: s.data.settings.displayCurrency === 'usd' ? 'krw' : 'usd' })} />
        <Chip title={compact ? 'CSV 공유' : 'CSV로 내보내기'} onPress={() => Native.saveFile('holdings.csv', holdingsCSV(s))} />
        {account ? null : <CopyPortfolio />}
      </View>
    </View>
  );

  const empty = <Empty title="보유 종목이 없어요" message={account?.broker === 'manual' ? '종목을 추가하세요.' : '증권사를 추가하면 보유 종목이 자동으로 연동돼요'} />;

  const list = rows.map(m => {
    const p = holdingPnl(m);
    const change = s.dayChange(m);
    const share = (krw(m) / total) * 100;
    return (
      <Pressable key={m.identityKey} onPress={() => onSelectAsset(m)} accessibilityRole="button">
        {({ pressed }) => (
          <Card style={{ padding: 16, borderRadius: 22, gap: 10, opacity: pressed ? 0.8 : 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Avatar text={m.name} color={m.assetType === 'crypto' ? C.orange : C.accent} />
              <View style={{ flex: 1, gap: 1 }}>
                <T numberOfLines={1} style={{ fontWeight: '700', fontSize: FS + 1 }}>{m.name}</T>
                <Sub numberOfLines={1} style={{ fontSize: FS - 2 }}>{m.ticker} · {marketLabel[m.market]} · {Fmt.qty(m.quantity)}{m.assetType === 'crypto' ? '' : '주'}</Sub>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 1, flexShrink: 0 }}>
                <T style={[{ fontWeight: '700', fontSize: FS + 1 }, num]}>{Fmt.krw(krw(m), hide)}</T>
                <T style={[{ fontSize: FS - 2, fontWeight: '700', color: pnlColor(p) }, num]}>{Fmt.signedKRW(p, hide)} ({Fmt.pct(s.holdingReturn(m))})</T>
              </View>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Sub numberOfLines={1} style={[{ fontSize: FS - 2, flexShrink: 1 }, num]}>지금 {Fmt.price(m.price, mh.currency(m))}</Sub>
              {change
                ? <T style={[{ fontSize: FS - 2, fontWeight: '700', color: pnlColor(change.rate) }, num]}>오늘 {Fmt.pct(change.rate)}</T>
                : <Sub style={{ fontSize: FS - 2 }}>오늘 등락 정보 없음</Sub>}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Sub numberOfLines={1} style={[{ fontSize: FS - 2, flexShrink: 1 }, num]}>평균 {s.avgPriceText(m)}</Sub>
              <Sub style={[{ fontSize: FS - 2 }, num]}>내 돈의 {share.toFixed(1)}%</Sub>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: C.fill, overflow: 'hidden' }}>
              <View style={{ width: `${Math.min(100, share)}%`, height: 6, borderRadius: 3, backgroundColor: C.chipOn }} />
            </View>
          </Card>
        )}
      </Pressable>
    );
  });

  const errorCard = account ? <AccountError account={account} onEdit={onEdit} /> : null;

  // One column on every window size. The map is its own summary; the list starts with the details.
  return (
    <View style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ width: '100%', maxWidth: 960, alignSelf: 'center', padding: 16, paddingTop: 4, gap: 12 }}>
        {errorCard}
        <Chips value={layout} onChange={setLayout} options={[['map', '지도'], ['list', '목록']]} />
        {layout === 'map' ? (
          rows.length === 0 ? <View style={{ height: 240 }}>{empty}</View> : map
        ) : (
          <>
            {summaryCard}
            <Title style={{ marginTop: 4, paddingHorizontal: 4 }}>내 종목 {rows.length}개</Title>
            <Chips fill value={sort} onChange={setSort} options={[['value', '평가금순'], ['ret', '수익률순'], ['name', '이름순']]} />
            {!ready ? <SkeletonRows rows={5} avatar /> : rows.length === 0 ? <View style={{ height: 200 }}>{empty}</View> : list}
          </>
        )}
      </ScrollView>
      {addingManual && account ? <ManualHoldingEditor accountId={account.id} onClose={() => setAddingManual(false)} /> : null}
    </View>
  );
}

export { store };
