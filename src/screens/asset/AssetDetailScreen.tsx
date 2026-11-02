import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { MergedHolding, identity, marketLabel, mh, sideLabel } from '../../domain/models';
import { holdingHeadline } from '../../domain/story';
import { sum, useStore } from '../../store/store';
import { Fmt } from '../../utils';
import { Chip, Avatar, Btn, C, Confirm, FS, Fold, H, HeroCard, Sub, T, Title, num, pnlColor, useCompact } from '../../ui';
import { InfoRow, InfoSection } from './InfoSection';
import { PriceChart } from './PriceChart';

/** Per-asset trade history + realized/unrealized breakdown. */
export function AssetDetailScreen({ holding: selectedHolding, accountId, onBack }: { holding: MergedHolding; accountId?: string; onBack: () => void }) {
  const s = useStore();
  const compact = useCompact();
  const scrollRef = useRef<ScrollView>(null);
  const [chartInteracting, setChartInteracting] = useState(false);
  const onChartInteraction = useCallback((active: boolean) => {
    // Apply immediately so the parent native scroll view cannot take this gesture.
    scrollRef.current?.setNativeProps({ scrollEnabled: !active });
    setChartInteracting(active);
  }, []);
  const holding = s.merged(accountId).find(m => m.identityKey === selectedHolding.identityKey) ?? selectedHolding;
  const [confirmReset, setConfirmReset] = useState(false);
  // Long histories: draw 30 rows, then 50 more per tap, so the page opens instantly.
  const [tradeCount, setTradeCount] = useState(30);
  // The trade table scrolls sideways only when narrower than its columns: a horizontal ScrollView takes the mouse wheel
  // on macOS, so on wide windows it would stop the page from scrolling while the pointer is over the table.
  const TABLE_MIN = 850;
  const [tableWidth, setTableWidth] = useState(0);
  const TableScroll = tableWidth > 0 && tableWidth < TABLE_MIN ? ScrollView : View;
  const c = mh.currency(holding);
  const trades = s.data.trades
    .filter(t => identity(t.assetType, t.ticker) === holding.identityKey && (!accountId || t.accountId === accountId))
    .sort((a, b) => b.date - a.date);
  const fees = trades.reduce((sum, t) => sum + (t.fee + t.tax) * (s.data.settings.displayCurrency === 'usd' ? 1 : (s.tradeRate(t) ?? NaN)), 0);
  const gainCurrency = s.data.settings.displayCurrency === 'usd' ? c : 'krw';
  const resyncable = s.sync.resyncTargets(holding.identityKey).length > 0;
  const manual = s.data.holdings.filter(h => identity(h.assetType, h.ticker) === holding.identityKey && s.account(h.accountId)?.broker === 'manual');
  const day = s.dayChange(holding);
  const hide = s.data.settings.hideAmounts;
  const assets = sum.total(s.summary(accountId));
  const share = assets > 0 ? (s.toKRW(mh.value(holding), c) / assets) * 100 : 0;

  return (
    // The confirm sheet is an overlay of this wrapper, not of the scroll content, so it opens on screen.
    <View style={{ flex: 1 }}>
    <ScrollView ref={scrollRef} scrollEnabled={!chartInteracting} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ width: '100%', maxWidth: 720, alignSelf: 'center', padding: compact ? 16 : 24, paddingBottom: 32, gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar size={44} text={holding.name} />
        <View style={{ flexShrink: 1 }}>
          <H>{holding.name}</H>
          <Sub>{holding.ticker} · {marketLabel[holding.market]}</Sub>
        </View>
      </View>

      <HeroCard label="이 종목에서" title={holdingHeadline(s.holdingPnl(holding), hide)}
            note={[day ? `오늘은 ${Fmt.pct(day.rate)}` : null, `내 자산의 ${share.toFixed(0)}%를 차지해요.`].filter(Boolean).join(', ')} />
      <PriceChart holding={holding} onInteractionChange={onChartInteraction} />
      <InfoSection title="내 보유" rows={[
            ['넣은 돈', Fmt.krw(s.holdingCost(holding))],
            ['지금 가치', Fmt.price(mh.value(holding), c)],
            ['벌거나 잃은 돈', Fmt.signedKRW(s.holdingPnl(holding)), pnlColor(s.holdingPnl(holding)), Fmt.pct(s.holdingReturn(holding))],
            ...(day ? [['오늘 변동', Fmt.signedPrice(day.amount, c), pnlColor(day.amount), Fmt.pct(day.rate)] as InfoRow] : []),
            ['갖고 있는 수량', `${Fmt.qty(holding.quantity)}${holding.assetType === 'crypto' ? '' : '주'}`],
            ['내가 산 평균 가격', s.avgPriceText(holding)],
            ['현재가', Fmt.price(holding.price, c)],
          ]} />
          {holding.valuationAt ? <Sub style={{ fontSize: FS - 3, lineHeight: FS + 3 }}>
            수수료·세금 공제 후 평가금액 기준 · {Fmt.dateTime(holding.valuationAt)} 잔고 조회. 이후 가격 변동과 확인된 수수료율을 반영한 추정액이에요. 세금·기타 비용은 잔고 동기화 시 갱신되며, 원화 환산액은 토스 화면과 다를 수 있어요.
          </Sub> : null}

      <Fold title={`거래 기록 ${trades.length}건 · 수수료 자세히 보기`}>
      <View style={{ gap: 16 }}>
      <InfoSection title="누적 기록" rows={[
        ['총 수수료·세금', Fmt.price(fees, gainCurrency)],
      ]} />
      {resyncable ? <View style={{ flexDirection: 'row' }}><Chip title="거래내역 다시 받기" off={s.isSyncing} onPress={() => setConfirmReset(true)} /></View> : null}

      {manual.map(h => (
        <View key={h.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <T>수동 보유: {Fmt.qty(h.quantity)} @ {Fmt.price(h.avgPrice, c)}</T>
          <Chip danger title="삭제" onPress={() => { s.accounts.deleteHolding(h.id); onBack(); }} />
        </View>
      ))}

      <Title>거래 내역 <T style={{ color: C.secondary, fontWeight: '700', fontSize: FS + 2 }}>{trades.length}</T></Title>
      {trades.length === 0 ? (
        <Sub>동기화 후 거래 내역이 여기에 표시됩니다</Sub>
      ) : (
        <View onLayout={e => setTableWidth(e.nativeEvent.layout.width)}>
          <TableScroll {...(TableScroll === ScrollView ? { horizontal: true, directionalLockEnabled: true, showsHorizontalScrollIndicator: true, contentContainerStyle: { flexGrow: 1 } } : {})}>
          <View style={{ minWidth: TableScroll === ScrollView ? TABLE_MIN : undefined, flexGrow: 1 }}>
          {trades.slice(0, tradeCount).map(t => (
            <View key={t.id} style={{ flexDirection: 'row', paddingVertical: 9, columnGap: 16, alignItems: 'center' }}>
              <T numberOfLines={1} style={[{ flex: 1.4, minWidth: 160 }, num]}>{Fmt.dateTime(t.date)}</T>
              <T numberOfLines={1} style={{ width: 40, flexShrink: 0, color: t.side === 'buy' ? C.red : C.blue }}>{sideLabel[t.side]}</T>
              <T numberOfLines={1} style={[{ flex: 1, minWidth: 100, textAlign: 'right' }, num]}>{Fmt.qty(t.quantity)}</T>
              <T numberOfLines={1} style={[{ flex: 1, minWidth: 100, textAlign: 'right' }, num]}>{s.tradeAmount(t, t.price)}</T>
              <T numberOfLines={1} style={[{ flex: 1.2, minWidth: 130, textAlign: 'right' }, num]}>{s.tradeAmount(t, t.quantity * t.price)}</T>
              <Sub numberOfLines={1} style={{ flex: 1, minWidth: 120, textAlign: 'right' }}>{s.account(t.accountId)?.name}</Sub>
            </View>
          ))}
          </View>
          </TableScroll>
          {trades.length > tradeCount ? (
            <Btn title={`더 보기 (${trades.length - tradeCount}건 남음)`} onPress={() => setTradeCount(n => n + 50)} style={{ marginTop: 8 }} />
          ) : null}
        </View>
      )}

      </View>
      </Fold>

      </View>
    </ScrollView>
      {confirmReset ? (
        <Confirm message={`이 종목의 거래내역을 지우고 ${s.sync.resyncTargets(holding.identityKey).map(a => a.name).join(', ')}에서 다시 받을까요? 계좌 전체 기간을 다시 동기화해서 시간이 걸릴 수 있어요.`} action="다시 받기"
          onConfirm={() => s.sync.resetAndResync(holding.identityKey)} onClose={() => setConfirmReset(false)} />
      ) : null}
    </View>
  );
}
