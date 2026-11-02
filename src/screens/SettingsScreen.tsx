import React, { useEffect, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { AIProvider, AIProviders } from '../domain/aiProviders';
import { EXIM_KEY } from '../platform/native';
import { Keychain, Native } from '../platform/native';
import { useStoreData } from '../store/store';
import { Btn, C, Card, Chip, Chips, Confirm, FS, Field, KeySaved, Link, Sub, T, Title } from '../ui';

const section = { padding: 18, borderRadius: 22, gap: 14 };

export function SettingsScreen() {
  const s = useStoreData();
  const st = s.data.settings;
  const [aiKey, setAiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [fxKey, setFxKey] = useState('');
  const [fxHasKey, setFxHasKey] = useState(false);
  const [fxBusy, setFxBusy] = useState(false);
  const [fxEditing, setFxEditing] = useState(false);
  const [fxMessage, setFxMessage] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => { setSaved(false); Keychain.get(`ai-${st.aiProvider}`).then(k => { setAiKey(k ?? ''); setSaved(!!k); }); }, [st.aiProvider]);
  useEffect(() => { Keychain.get(EXIM_KEY).then(k => setFxHasKey(!!k)).catch(() => setFxMessage('저장된 인증키를 확인하지 못했습니다')); }, []);

  const saveFx = async (remove = false) => {
    setFxBusy(true);
    setFxMessage('');
    try {
      await s.rates.saveKey(remove ? '' : fxKey);
      setFxHasKey(!remove);
      setFxKey('');
      setFxEditing(false);
      setFxMessage(remove ? '인증키를 삭제했습니다.' : s.fxError ? '키는 저장했지만 환율 조회에 실패했습니다. 아래 오류를 확인해주세요.' : s.fxNotice ? '키 저장 완료 · 인증 오류로 대체 환율을 적용했습니다.' : '인증키 저장 및 환율 적용 완료');
    } catch { setFxMessage('인증키 저장에 실패했습니다. 다시 시도해주세요.'); }
    finally { setFxBusy(false); }
  };

  return (
    <View style={{ flex: 1 }}>
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ width: '100%', maxWidth: 720, alignSelf: 'center', padding: 16, paddingTop: 4, gap: 12 }}>

      <Card style={section}>
        <Title>일반</Title>
        <Row label="표시 통화">
          <Chips value={st.displayCurrency} onChange={v => s.updateSettings({ displayCurrency: v })}
            options={[['krw', '원화 (₩)'], ['usd', '달러 ($)']]} />
        </Row>
        <Row label="외관">
          <Chips value={st.appearance} onChange={v => { s.updateSettings({ appearance: v }); Native.setAppearance(v); }}
            options={[['system', '시스템 기본값'], ['light', '라이트'], ['dark', '다크']]} />
        </Row>
        <Row label="백그라운드 동기화">
          <Chips value={st.backgroundSyncMinutes} onChange={v => s.updateSettings({ backgroundSyncMinutes: v })}
            options={[[0, '끄기'], [15, '15분'], [30, '30분'], [60, '1시간'], [180, '3시간']]} />
        </Row>
        <Sub>{Platform.OS === 'ios'
          ? '앱을 열 때 간격이 지났으면 바로 동기화하고, 닫혀 있을 때는 iOS가 허용하는 시점에 백그라운드로 동기화합니다. (설정 › 일반 › 백그라운드 앱 새로 고침이 켜져 있어야 해요)'
          : '앱이 실행 중일 때 일정 간격으로 포트폴리오를 자동 동기화합니다.'}</Sub>
        <Row label="거래 내역 동기화">
          <Chips value={st.syncDays} onChange={v => s.updateSettings({ syncDays: v })}
            options={[[365, '최근 1년'], [1095, '최근 3년'], [1825, '최근 5년']]} />
        </Row>
        <Sub>실제 동기화 범위는 각 증권사·거래소 API 제한에 따라 달라질 수 있습니다. (키움은 최대 2개월)</Sub>
      </Card>

      <Card style={section}>
        <Title>원화 환산 기준환율</Title>
        <Sub>한국수출입은행 API의 서울외국환중개 매매기준율을 사용합니다. 영업일 오전 11시 전후에 갱신되며, 당일 값이 없으면 이전 영업일 값을 유지합니다.</Sub>
        {fxHasKey && !fxEditing ? (
          <KeySaved title="인증키 등록 완료" onEdit={() => setFxEditing(true)}>
            <Chip title="키 삭제" off={fxBusy} onPress={() => void saveFx(true)} />
          </KeySaved>
        ) : (
          <>
            <Field label="수출입은행 API 인증키" value={fxKey} onChange={setFxKey} secure placeholder={fxHasKey ? '새 인증키 입력' : '발급받은 인증키 입력'} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip on title={fxBusy ? '처리 중…' : '저장하고 환율 적용'} off={fxBusy || !fxKey.trim()} onPress={() => void saveFx()} />
              {fxHasKey ? <Chip title="취소" onPress={() => { setFxKey(''); setFxEditing(false); }} /> : null}
            </View>
          </>
        )}
        {fxMessage ? <Sub>{fxMessage}</Sub> : null}
        <Sub>{s.rates.label}</Sub>
        <Sub>인증키는 이 기기의 Keychain에 저장합니다. 아이폰과 맥에서 각각 입력해주세요. 기준환율은 30분 간격으로 확인합니다. 인증 오류 시 토스 참고환율을 사용하고, 토스 연결이 없으면 Yahoo 환율을 사용합니다. 대체 환율은 1분 간격으로 확인하며 토스 화면과 다를 수 있습니다.</Sub>
      </Card>

      <Card style={section}>
        <Title>미국주식 공시</Title>
        <Field label="SEC 연락처 이메일 (SEC EDGAR 이용 정책상 User-Agent에 포함)" value={st.secContact}
          onChange={v => s.updateSettings({ secContact: v.trim() })} placeholder="you@example.com" />
      </Card>

      <Card style={section}>
        <Title>AI</Title>
        <Row label="프로바이더">
          <Chips value={st.aiProvider} onChange={(v: AIProvider) => s.updateSettings({ aiProvider: v, aiModel: '' })}
            options={[['anthropic', AIProviders.anthropic.label], ['openai', AIProviders.openai.label]]} />
        </Row>
        <Field label="모델" value={st.aiModel} onChange={v => s.updateSettings({ aiModel: v })} placeholder={AIProviders[st.aiProvider].defaultModel} />
        {saved ? (
          <KeySaved title={`${AIProviders[st.aiProvider].label} 키 등록 완료`} onEdit={() => setSaved(false)}>
            <Chip title="키 삭제" onPress={() => { Keychain.delete(`ai-${st.aiProvider}`); setAiKey(''); setSaved(false); }} />
          </KeySaved>
        ) : (
          <>
            <Field label={`${AIProviders[st.aiProvider].label} API 키`} value={aiKey} onChange={setAiKey} secure />
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Link title="키 발급 페이지 열기" url={AIProviders[st.aiProvider].keyURL} />
              <View style={{ flex: 1 }} />
              <Chip on title="저장" off={!aiKey.trim()} onPress={() => Keychain.set(`ai-${st.aiProvider}`, aiKey.trim()).then(() => setSaved(true))} />
            </View>
          </>
        )}
        <Sub>AI 제공자의 API 키를 직접 발급받아야 해요. 사용 요금은 해당 제공자에게 직접 지불하세요. 키는 Keychain에, 대화는 기기에만 저장돼요.</Sub>
      </Card>

      <Card style={section}>
        <Title>데이터 초기화</Title>
        <Sub style={{ lineHeight: 18 }}>
          동기화된 잔고·거래내역·일별 자산 기록을 삭제합니다. 증권사/거래소 계좌, API 인증 정보(Keychain), 수동 계좌 보유 종목은 유지됩니다.
        </Sub>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Btn kind="danger" title="데이터 초기화" disabled={s.isSyncing} onPress={() => setConfirmReset(true)} />
          {resetDone ? <Sub>데이터가 초기화되었습니다.</Sub> : null}
        </View>
      </Card>

    </ScrollView>
      {confirmReset ? (
        <Confirm message="모든 잔고 및 거래내역 데이터가 영구 삭제됩니다. 이 작업은 되돌릴 수 없습니다." action="초기화"
          onConfirm={() => { s.accounts.resetSyncedData(); setResetDone(true); }} onClose={() => setConfirmReset(false)} />
      ) : null}
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <T style={{ fontWeight: '600', fontSize: FS - 1 }}>{label}</T>
      {children}
    </View>
  );
}

export { C };
