import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useStoreData } from '../../store/store';
import { ShortVolume } from '../../domain/models';
import { Chip, Empty, Field, useCompact } from '../../ui';
import { TickerDetail } from './TickerDetail';

/** 미국주식: SEC 공시 + FINRA 공매도 for US holdings and the watchlist. */
export function USScreen() {
  const s = useStoreData();
  const tickers = s.usTickers();
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [volumes, setVolumes] = useState<Record<string, ShortVolume[]>>({});
  const [loadingVol, setLoadingVol] = useState(false);
  const cur = selected && tickers.includes(selected) ? selected : tickers[0] ?? null;
  const tickerKey = tickers.join(',');
  const compact = useCompact();

  useEffect(() => {
    if (!tickers.length) return;
    setLoadingVol(true);
    s.us.shortVolumes(tickers, 10).then(setVolumes).catch(() => {}).finally(() => setLoadingVol(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey]);

  const addTicker = () => {
    const t = adding.trim().toUpperCase();
    if (!t || s.data.settings.usWatchlist.includes(t)) return;
    s.updateSettings({ usWatchlist: [...s.data.settings.usWatchlist, t] });
    setAdding('');
    setShowAdd(false);
    setSelected(t);
  };

  return (
    <View style={{ flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
      <View style={{ paddingHorizontal: 16, paddingTop: compact ? 4 : 24, paddingBottom: 12, gap: 12 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {tickers.map(t => <Chip key={t} title={t} on={t === cur} onPress={() => setSelected(t)} />)}
          <Chip title={showAdd ? '닫기' : '종목 추가'} onPress={() => setShowAdd(!showAdd)} />
        </View>
        {showAdd ? (
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <Field onWindow value={adding} onChange={setAdding} placeholder="티커 (예: TSLA)" style={{ flex: 1 }} />
            <Chip title="추가" on onPress={addTicker} />
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        {cur ? (
          <TickerDetail key={cur} ticker={cur} volumes={volumes[cur] ?? []} volumesLoading={loadingVol && !volumes[cur]} watch={s.data.settings.usWatchlist.includes(cur)}
            onRemove={() => s.updateSettings({ usWatchlist: s.data.settings.usWatchlist.filter(x => x !== cur) })} />
        ) : (
          <Empty title="미국 종목이 없어요" message={'미국 주식을 보유하거나 관심 종목을 추가하면\nSEC 공시와 FINRA 공매도 데이터를 보여드려요.'} />
        )}
      </View>
    </View>
  );
}
