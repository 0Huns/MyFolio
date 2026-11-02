import React, { useEffect, useState } from 'react';
import { Platform, Switch, View } from 'react-native';
import { BrokerAccount, BrokerType, Brokers } from '../../domain/models';
import { Keychain } from '../../platform/native';
import { store } from '../../store/store';
import { uuid } from '../../utils';
import { Btn, C, Chips, FS, Field, H, KeySaved, Link, Notice, Sheet, Sub, T } from '../../ui';

export function AccountEditor({ account, exchange, onClose, onDelete, onFull }: {
  account?: BrokerAccount; exchange: boolean; onClose: () => void; onDelete?: () => void; onFull?: () => void;
}) {
  const brokers: BrokerType[] = exchange ? ['upbit', 'bithumb', 'coinone'] : ['kis', 'kiwoom', 'toss', 'manual'];
  const [broker, setBroker] = useState<BrokerType>(account?.broker ?? brokers.find(b => !Brokers[b].preparing) ?? brokers[0]);
  const [name, setName] = useState(account?.name ?? '');
  const [accountNumber, setAccountNumber] = useState(account?.accountNumber ?? '');
  const [isPaper, setIsPaper] = useState(account?.isPaper ?? false);
  const [key, setKey] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  // null while the keychain is being read.
  const [storedKeys, setStoredKeys] = useState<boolean | null>(account ? null : false);
  const [editingKeys, setEditingKeys] = useState(false);
  const keysSaved = !!storedKeys && !editingKeys;
  const keysKnown = storedKeys !== null;
  const info = Brokers[broker];
  const hasCreds = broker !== 'manual';

  useEffect(() => {
    if (account) Keychain.credentials(account.id).then(c => { if (c) { setKey(c.key); setSecret(c.secret); } setStoredKeys(!!c); }).catch(() => setStoredKeys(false));
  }, [account]);

  async function save() {
    const k = key.trim(), sec = secret.trim();
    const digits = accountNumber.replace(/\D/g, '');
    if (hasCreds && (!k || !sec)) {
      const empty = [!k && info.keyLabels[0], !sec && info.keyLabels[1]].filter(Boolean).join(', ');
      return setError(`${empty}이(가) 비어 있어요. 붙여넣기가 안 됐다면 '보기'를 켜고 다시 붙여넣어 보세요.`);
    }
    if (info.needsAccountNumber && digits.length < 8) return setError('계좌번호 (8자리)를 확인해 주세요.');
    if (!account && info.needsAccountNumber && store.data.accounts.some(a => a.broker === broker && a.accountNumber.replace(/\D/g, '') === digits)) {
      return setError('동일한 계좌번호의 계좌가 이미 등록되어 있습니다.');
    }
    const a: BrokerAccount = { ...(account ?? { id: uuid(), cashKRW: 0 } as BrokerAccount), broker, name: name || info.name, accountNumber, isPaper };
    if (hasCreds) {
      const old = await Keychain.credentials(a.id);
      if (old?.key !== k || old?.secret !== sec) await Keychain.dropToken(a.id); // credentials changed → drop cached token
      await Keychain.saveCredentials(a.id, { key: k, secret: sec });
    }
    store.accounts.upsert(a);
    onClose();
    // New account, or keys re-entered: connect right away so a fixed error clears (or a new one shows) immediately.
    if (hasCreds) store.sync.one(a.id);
  }

  if (!account && brokers.every(b => Brokers[b].preparing))
    return (
      <Sheet onClose={onClose} width={540}>
        <H>{exchange ? '새 거래소 추가' : '새 계좌 추가'}</H>
        <Chips value={broker} onChange={setBroker} disabled={brokers}
          options={brokers.map(b => [b, `${Brokers[b].name} (준비중)`] as [BrokerType, string])} />
        <Sub>거래소 연동은 준비중이에요.</Sub>
        <Btn title="닫기" onPress={onClose} />
      </Sheet>
    );

  return (
    <Sheet onClose={onClose} width={540}>
      <H>{account ? (exchange ? '거래소 편집' : '계좌 편집') : exchange ? '새 거래소 추가' : '새 계좌 추가'}</H>
      {!account ? <Chips value={broker} onChange={setBroker} disabled={brokers.filter(b => Brokers[b].preparing)}
        options={brokers.map(b => [b, Brokers[b].preparing ? `${Brokers[b].name} (준비중)` : Brokers[b].name] as [BrokerType, string])} /> : <T>{info.name}</T>}
      <Field label="별칭" value={name} onChange={setName} placeholder={exchange ? '예: 업비트' : '예: 토스증권'} />
      {info.needsAccountNumber ? <Field label="계좌번호" value={accountNumber} onChange={setAccountNumber} placeholder="12345678-01" /> : null}
      {info.supportsPaper ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Switch value={isPaper} onValueChange={setIsPaper} />
          <T>모의투자</T>
        </View>
      ) : null}
      {hasCreds && keysSaved ? <KeySaved title="API 키 등록 완료" onEdit={() => setEditingKeys(true)} /> : null}
      {hasCreds && !keysSaved && keysKnown ? (
        <>
          <Field label={info.keyLabels[0]} value={key} onChange={setKey} placeholder={`${info.keyLabels[0]}를 입력하세요`} />
          <Field label={info.keyLabels[1]} value={secret} onChange={setSecret} placeholder={`${info.keyLabels[1]}을 입력하세요`} secure />
          <Sub>🔒 인증 정보는 {Platform.OS === 'ios' ? 'iOS' : 'macOS'} Keychain에 안전하게 저장돼요</Sub>
          <View style={{ gap: 6, padding: 16, borderRadius: 16, backgroundColor: C.fill }}>
            <T style={{ fontWeight: '700' }}>{info.name} API 키 발급 방법</T>
            {info.guide.map((g, i) => <T key={i} style={{ lineHeight: FS + 6, fontSize: FS - 1 }}>{i + 1}. {g}</T>)}
            {info.guideURL ? <Link title="키 발급 페이지 열기" url={info.guideURL} /> : null}
            <Sub>{Platform.OS === 'ios'
              ? '대부분의 증권사·거래소는 API 키 발급 시 공인 IP 등록이 필요해요. 모바일 데이터는 IP가 자주 바뀌니 등록한 Wi-Fi에서 동기화하세요.'
              : '대부분의 증권사·거래소는 API 키 발급 시 이 Mac의 공인 IP 등록이 필요해요.'}</Sub>
          </View>
        </>
      ) : null}
      {error ? <Notice message={error} /> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn title="취소" onPress={onClose} style={{ flex: 1 }} />
        <Btn title="저장" kind="primary" onPress={save} style={{ flex: 2 }} />
      </View>
      {onFull || onDelete ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 20 }}>
          {onFull ? <Btn kind="link" title="전체 내역 다시 받기" onPress={() => { onFull(); onClose(); }} /> : null}
          {onDelete ? <Btn kind="link" title="계좌 삭제" onPress={onDelete} /> : null}
        </View>
      ) : null}
    </Sheet>
  );
}
