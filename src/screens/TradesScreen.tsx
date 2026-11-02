import React, { useDeferredValue, useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Trade } from '../domain/models';
import { Period, isLatestPeriod, periodLabel, periodPrefix, shiftPeriod } from '../domain/period';
import { StockTotal, profitRate, sideCounts, stockTotals, tradeTotals } from '../domain/trades';
import { fxDay } from '../domain/marketTime';
import { dayLabel, qtyLine, saleLine, tradeHeadline } from '../domain/story';
import { Native } from '../platform/native';
import { useStoreData } from '../store/store';
import { tradesCSV } from '../store/reports';
import { Fmt } from '../utils';
import {
  C, Card, Chip, Chips, Empty, FS, Field, HeroCard, ListRow, Notice, SkeletonRows, Stat, Sub, T, pnlColor, useAfterFirstFrame, useCompact, usePaged,
} from '../ui';

/** Phone list item: a date header or a trade. */
type Item = { kind: 'day'; key: string; day: string } | { kind: 'trade'; key: string; t: Trade };

export function TradesScreen() {
  const s = useStoreData();
  const [search, setSearch] = useState('');
  const [side, setSide] = useState<'all' | 'buy' | 'sell'>('all');
  const [accountId, setAccountId] = useState<string>('all');
  const [view, setView] = useState<'trade' | 'stock'>('trade');
  const [filtering, setFiltering] = useState(false);
  const [period, setPeriod] = useState<Period>('month');
  const today = fxDay(Date.now());
  const [anchor, setAnchor] = useState(today.slice(0, 7)); // YYYY-MM
  const prefix = periodPrefix(period, anchor);
  const compact = useCompact();
  const ready = useAfterFirstFrame();
  // Typing stays instant; the filtered list catches up a moment later.
  const q = useDeferredValue(search).trim().toLowerCase();

  // Trades are appended in place, so the array identity alone doesn't change — key on its length too.
  const all = s.data.trades;
  const count = all.length;
  const trades = useMemo(
    () => all
      .filter(t => (accountId === 'all' || t.accountId === accountId) && (side === 'all' || t.side === side)
        && (!q || t.name.toLowerCase().includes(q) || t.ticker.toLowerCase().includes(q)) && (!prefix || fxDay(t.date).startsWith(prefix)))
      .sort((a, b) => b.date - a.date),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, count, accountId, side, q, prefix],
  );
  const rateOf = s.displayRate;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sales = useMemo(() => s.tradeSales(), [all, count, s.data.holdings, s.usdKrw, s.data.dailyFx, s.data.settings.displayCurrency]);
  const totals = useMemo(() => tradeTotals(trades, rateOf, sales), [trades, sales, rateOf]);
  const stocks = useMemo(() => stockTotals(trades, rateOf, sales), [trades, sales, rateOf]);
  const step = (n: number) => setAnchor(shiftPeriod(period, anchor, n));
  const atLatest = isLatestPeriod(period, anchor, today);
  const { shown, more } = usePaged(trades, 100);
  const sideColor = (sd: 'buy' | 'sell') => (sd === 'buy' ? C.red : C.blue);

  const buys = trades.filter(t => t.side === 'buy').length;
  const sells = trades.length - buys;
  const narrowed = side !== 'all' || accountId !== 'all';

  const header = (
    <View style={{ gap: 12 }}>
      <HeroCard label={period === 'all' ? '지금까지' : `${periodLabel(period, anchor)}에는`}
        title={tradeHeadline(buys, sells, totals.profit, sells > totals.unknown)}
        note={totals.unknown ? `원가를 모르는 매도 ${totals.unknown}건은 금액에서 뺐어요.` : undefined} />
      <Field onWindow label="종목 검색" value={search} onChange={setSearch} placeholder="종목명 또는 티커" />
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Chip title="날짜별" on={view === 'trade'} onPress={() => setView('trade')} />
        <Chip title="종목별" on={view === 'stock'} onPress={() => setView('stock')} />
        <Chip title={period === 'all' ? '전체 기간' : periodLabel(period, anchor)} onPress={() => setFiltering(!filtering)} />
        <Chip title={narrowed ? '필터 적용 중' : '필터'} onPress={() => setFiltering(!filtering)} />
      </View>
      {filtering ? (
        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chips value={period} onChange={setPeriod} options={[['all', '전체 기간'], ['year', '년'], ['month', '월']]} />
            {period !== 'all' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Chip title="◀" onPress={() => step(-1)} />
                <T style={{ fontWeight: '700', minWidth: 90, textAlign: 'center' }}>{periodLabel(period, anchor)}</T>
                <Chip title="▶" off={atLatest} onPress={() => step(1)} />
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Chips value={side} onChange={setSide} options={[['all', '전체'], ['buy', '매수'], ['sell', '매도']]} />
            <Chips value={accountId} onChange={setAccountId} options={[['all', '전체 계좌'], ...s.data.accounts.map(a => [a.id, a.name] as [string, string])]} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 }}>
            {[['거래 수', `${trades.length}건`], ['매수 금액', Fmt.krw(totals.buy)], ['매도 금액', Fmt.krw(totals.sell)]].map(([t, v]) => (
              <View key={t} style={{ width: '50%' }}><Stat title={t} value={v} /></View>
            ))}
            {side !== 'buy' ? (
              <View style={{ width: '50%' }}>
                <Stat title={`판매수익 ${profitRate(totals)}`} value={Fmt.signedKRW(totals.profit)} color={pnlColor(totals.profit)} />
              </View>
            ) : null}
          </View>
          <Sub style={{ fontSize: FS - 2 }}>미국 주식의 원화 금액은 각 거래일의 서울외국환중개 기준환율로 환산해요.</Sub>
          {side !== 'buy' ? <Sub style={{ fontSize: FS - 2 }}>판매수익은 매도한 주식의 이동평균 원가(매수 수수료 포함)와 매도 금액(수수료·세금 차감)의 차이예요.</Sub> : null}
          {side !== 'buy' && totals.unknown ? <Notice warn message={`매수 기록이 부족한 매도 ${totals.unknown}건은 원가를 알 수 없어 판매수익에서 제외했어요. 액면병합·티커 변경·입고처럼 주문이 아닌 방법으로 들어온 주식은 주문내역에 없어요.`} /> : null}
          <View style={{ flexDirection: 'row' }}><Chip title={compact ? 'CSV 공유' : 'CSV로 내보내기'} onPress={() => Native.saveFile('trades.csv', tradesCSV(s, trades))} /></View>
        </Card>
      ) : null}
    </View>
  );

  const empty = <Empty title="거래 내역이 없어요" message="동기화 후 거래 내역이 여기에 표시돼요" />;

  // Bank-statement style on every window size: a date header before each day's trades. Virtualized and paged.
  const items: Item[] = [];
  let lastDay = '';
  for (const t of view === 'stock' ? [] : shown) {
    const day = Fmt.date(t.date);
    if (day !== lastDay) items.push({ kind: 'day', key: `d-${day}`, day });
    lastDay = day;
    items.push({ kind: 'trade', key: t.id, t });
  }
  // The rows sit inside one white card: its top and bottom are drawn by the first and last pieces.
  const body = { backgroundColor: C.control, paddingHorizontal: 20 } as const;
  return (
    <FlatList<Item | StockTotal>
      data={ready ? (view === 'stock' ? stocks : items) : []}
      keyExtractor={i => i.key}
      initialNumToRender={20}
      maxToRenderPerBatch={30}
      windowSize={9}
      onEndReached={view === 'stock' ? undefined : more}
      onEndReachedThreshold={0.6}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 16, paddingTop: compact ? 4 : 24, paddingBottom: 24 }}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          {header}
          <View style={[body, { height: 12, borderTopLeftRadius: 22, borderTopRightRadius: 22 }]} />
        </View>
      }
      ListEmptyComponent={
        <View style={[body, { minHeight: 200, justifyContent: 'center' }]}>{ready ? empty : <SkeletonRows rows={6} />}</View>
      }
      ListFooterComponent={<View style={[body, { height: 14, borderBottomLeftRadius: 22, borderBottomRightRadius: 22 }]} />}
      renderItem={({ item }) => !('kind' in item) ? (
        <View style={body}>
          <ListRow title={item.name} subtitle={`${item.ticker} · ${sideCounts(item)}`}
            right={item.sellN && item.cost > 0
              ? <T style={{ fontWeight: '700', color: pnlColor(item.profit), fontVariant: ['tabular-nums'] }}>{Fmt.signedKRW(item.profit)} <T style={{ fontSize: FS - 2, color: pnlColor(item.profit) }}>{profitRate(item)}</T></T>
              : item.sellN ? <Sub>판매수익 미확인</Sub> : undefined}
            rightSub={[item.buyN ? `매수 ${Fmt.krw(item.buyAmt)}` : '', item.sellN ? `매도 ${Fmt.krw(item.sellAmt)}` : '', item.unknown ? `미확인 ${item.unknown}건` : ''].filter(Boolean).join(' · ')} />
        </View>
      ) : item.kind === 'day' ? (
        <View style={body}><Sub style={{ fontSize: FS - 2, fontWeight: '600', marginTop: 12 }}>{dayLabel(item.day)}</Sub></View>
      ) : (
        <View style={body}>
          <ListRow title={item.t.name}
            subtitle={[qtyLine(Fmt.qty(item.t.quantity), item.t.side, item.t.assetType === 'crypto'), item.t.side === 'sell' ? (sales[item.t.id] ? saleLine(sales[item.t.id]!.profit) : '판매수익 미확인') : ''].filter(Boolean).join(' · ')}
            right={<T style={{ fontWeight: '700', color: sideColor(item.t.side), fontVariant: ['tabular-nums'] }}>{s.tradeAmount(item.t, item.t.quantity * item.t.price)}</T>} />
        </View>
      )}
    />
  );
}
