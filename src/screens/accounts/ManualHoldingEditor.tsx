import React, { useState } from 'react';
import { View } from 'react-native';
import { Market, marketLabel } from '../../domain/models';
import { store } from '../../store/store';
import { num, uuid } from '../../utils';
import { Btn, Chips, Field, H, Sheet } from '../../ui';

export function ManualHoldingEditor({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const [market, setMarket] = useState<Market>('krx');
  const [ticker, setTicker] = useState('');
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [avg, setAvg] = useState('');
  const save = () => {
    const t = ticker.trim().toUpperCase();
    if (!t || num(quantity) <= 0) return;
    store.accounts.saveManualHolding({
      id: uuid(), accountId, ticker: t, name: name || t, assetType: market === 'crypto' ? 'crypto' : 'stock', market,
      quantity: num(quantity), avgPrice: num(avg), lastPrice: num(avg),
    });
    onClose();
  };
  return (
    <Sheet onClose={onClose} width={420}>
      <H>종목 추가</H>
      <Chips value={market} onChange={setMarket} options={(['krx', 'us', 'crypto'] as Market[]).map(m => [m, marketLabel[m]] as [Market, string])} />
      <Field label="티커" value={ticker} onChange={setTicker} placeholder={market === 'krx' ? '005930' : market === 'us' ? 'AAPL' : 'BTC'} />
      <Field label="종목명" value={name} onChange={setName} />
      <Field label="수량" value={quantity} onChange={setQuantity} />
      <Field label={`평균단가 (${market === 'us' ? 'USD' : '원'})`} value={avg} onChange={setAvg} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn title="취소" onPress={onClose} style={{ flex: 1 }} />
        <Btn title="저장" kind="primary" onPress={save} disabled={!ticker || num(quantity) <= 0} style={{ flex: 2 }} />
      </View>
    </Sheet>
  );
}
