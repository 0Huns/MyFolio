import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { Native } from '../../platform/native';
import { Filing, ShortInterest, ShortVolume } from '../../domain/models';
import { useStoreData } from '../../store/store';
import { FilingFilter, filingURL, filterFilings, formLabel, formSentence } from '../../domain/filings';
import { tickerHeadline } from '../../domain/story';
import { tickerReport } from '../../domain/tickerReport';
import { Fmt } from '../../utils';
import { Chip, Bars, Btn, C, Card, Chips, FS, Fold, HeroCard, Notice, Skeleton, Stat, Sub, T, Title, num, useCompact } from '../../ui';

export function TickerDetail({ ticker, volumes, volumesLoading, watch, onRemove }: { ticker: string; volumes: ShortVolume[]; volumesLoading: boolean; watch: boolean; onRemove: () => void }) {
  const s = useStoreData();
  const contact = s.data.settings.secContact;
  const [name, setName] = useState<string | null>(null);
  const [list, setList] = useState<Filing[] | null>(null);
  const [si, setSi] = useState<ShortInterest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outstanding, setOutstanding] = useState<number | null>(null);
  const [filingCount, setFilingCount] = useState(5);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, []);
  const [formFilter, setFormFilter] = useState<FilingFilter>('all');
  const compact = useCompact();

  useEffect(() => {
    s.us.companyName(ticker).then(setName).catch(() => {});
    s.us.filings(ticker, 60).then(setList).catch(e => setError(e.message));
    s.us.shortInterest(ticker).then(setSi).catch(() => setSi([]));
    s.us.sharesOutstanding(ticker).then(setOutstanding).catch(() => {});
  }, [s, ticker, contact]);

  const shownFilings = filterFilings(list ?? [], formFilter);
  const latestSI = si?.[0];
  const vols = [...volumes].reverse();
  const copyInfo = async () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
    setCopyStatus('copying');
    try {
      const ok = await Native.copyText(tickerReport({ ticker, name, volumes, volumesLoading, shortInterest: si, filings: list, filingError: !!error }));
      if (!mounted.current) return;
      setCopyStatus(ok ? 'copied' : 'failed');
    } catch { if (mounted.current) setCopyStatus('failed'); }
    if (mounted.current) copyTimer.current = setTimeout(() => setCopyStatus('idle'), 2500);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 12 }}>
      <HeroCard label={name ? `${ticker} · ${name}` : ticker} title={tickerHeadline(list, volumes, Date.now())} />

      <Card style={{ padding: 18, borderRadius: 22, gap: 10 }}>
        <Title>최근 공시</Title>
        <Chips value={formFilter} onChange={setFormFilter} options={[['all', '전체'], ['major', '주요 공시'], ['insider', '내부자']]} />
        {error ? <Notice title="공시를 불러오지 못했어요" message={error} /> : null}
        {!list && !error ? Array.from({ length: 4 }, (_, i) => (
          <View key={i} style={{ paddingVertical: 6, gap: 6, minHeight: 48 }}>
            <Skeleton width={`${50 + ((i * 13) % 35)}%`} height={16} />
            <Skeleton width={140} height={13} />
          </View>
        )) : null}
        {shownFilings.slice(0, filingCount).map(f => (
          <Pressable key={f.accession} onPress={() => Linking.openURL(filingURL(f))} accessibilityRole="link"
            style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', gap: 1, opacity: pressed ? 0.6 : 1 })}>
            <T style={{ fontWeight: '700' }} numberOfLines={1}>{formSentence(f.form, formLabel(f.form, f.description)) || f.form}</T>
            <Sub style={{ fontSize: FS - 2 }} numberOfLines={1}>{f.form} · {Fmt.date(f.date)}</Sub>
          </Pressable>
        ))}
        {shownFilings.length > filingCount ? <Btn title={`더 보기 (${shownFilings.length - filingCount}건 남음)`} onPress={() => setFilingCount(n => n + 20)} /> : null}
        <Sub style={{ fontSize: 11 }}>공시 종류를 쉽게 풀어쓴 말이에요. 실제 내용은 눌러서 원문을 확인하세요.</Sub>
      </Card>

      <View style={{ flexDirection: compact ? 'column' : 'row', gap: 12 }}>
        <Card style={{ flex: compact ? undefined : 1, gap: 10 }}>
          <Title>공매도</Title>
          {vols.length ? (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 20, rowGap: 8 }}>
                <Stat big title="오늘 거래 중 비율" value={`${vols[vols.length - 1].ratio.toFixed(1)}%`} />
                <Stat big title="최근 10일 평균" value={`${(vols.reduce((a, v) => a + v.ratio, 0) / vols.length).toFixed(1)}%`} />
                <Stat big title="최근 공매도량" value={Fmt.big(vols[vols.length - 1].short)} />
              </View>
              <Bars height={90} values={vols.map(v => v.ratio)} color={C.orange} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Sub>{vols[0].date}</Sub><Sub>{vols[vols.length - 1].date}</Sub>
              </View>
            </>
          ) : volumesLoading ? <StatsSkeleton chart={90} /> : <Sub>공매도 데이터가 없어요.</Sub>}
          <Sub style={{ fontSize: 11 }}>장내 거래 중 공매도 거래 비율입니다(FINRA 보고 거래소 기준). 마켓메이커 헤지가 포함되어 미국 주식은 평소에도 40~50%대가 흔해요. 높다고 바로 나쁜 신호는 아니에요.</Sub>
        </Card>
        <Card style={{ flex: compact ? undefined : 1, gap: 10 }}>
          <Title>공매도 잔고 (월 2회)</Title>
          {latestSI ? (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 20, rowGap: 8 }}>
                <Stat big title="잔고" value={Fmt.big(latestSI.shares)} />
                <Stat big title="발행주식 대비" value={outstanding ? `${((latestSI.shares / outstanding) * 100).toFixed(1)}%` : '미확인'} />
                <Stat big title="직전 대비" value={Fmt.pct(latestSI.changePct)} color={latestSI.changePct > 0 ? C.red : C.blue} />
              </View>
              <Sub>평균 거래량으로 다 갚는 데 {latestSI.daysToCover.toFixed(2)}일 걸려요 (Days to cover).</Sub>
              {si!.slice(0, 6).map(r => (
                <View key={r.date} style={{ flexDirection: 'row' }}>
                  <Sub style={[{ flex: 1 }, num]}>{r.date}</Sub>
                  <T style={[{ flex: 1, textAlign: 'right' }, num]}>{Fmt.big(r.shares)}</T>
                  <T style={[{ flex: 1, textAlign: 'right', color: r.changePct > 0 ? C.red : C.blue }, num]}>{Fmt.pct(r.changePct)}</T>
                </View>
              ))}
              <Sub style={{ fontSize: 11 }}>발행주식 대비 비율은 유통주식 기준(Short % of Float)과 달라요. 발행주식 수는 최근 SEC 보고서 값이에요.</Sub>
            </>
          ) : si ? <Sub>데이터 없음</Sub> : <StatsSkeleton lines={6} />}
        </Card>
      </View>

      <Fold title="원문 · AI용 복사 더 보기">
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <Chip title={copyStatus === 'copied' ? '복사됨 ✓' : copyStatus === 'failed' ? '복사 실패 · 다시 시도' : copyStatus === 'copying' ? '복사 중…' : 'AI용으로 복사'} off={copyStatus === 'copying'} onPress={copyInfo} />
          <Chip title="SEC EDGAR" onPress={() => Linking.openURL(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${ticker}&owner=include`)} />
          {watch ? <Chip danger title="관심 종목 삭제" onPress={onRemove} /> : null}
        </View>
      </Fold>
    </ScrollView>
  );
}

/** Placeholder for a stats card: three big stats, then a chart area or a few table lines (same heights as the real ones). */
function StatsSkeleton({ chart, lines }: { chart?: number; lines?: number }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', columnGap: 20 }}>
        {[0, 1, 2].map(i => (
          <View key={i} style={{ gap: 4 }}><Skeleton width={56} height={15} /><Skeleton width={72} height={24} /></View>
        ))}
      </View>
      {chart ? <Skeleton width="100%" height={chart} radius={8} /> : null}
      {chart ? <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Skeleton width={70} height={15} /><Skeleton width={70} height={15} /></View> : null}
      {Array.from({ length: lines ?? 0 }, (_, i) => <Skeleton key={i} width="100%" height={16} />)}
    </View>
  );
}
