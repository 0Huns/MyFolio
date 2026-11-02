import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { AIProviders } from '../domain/aiProviders';
import { Keychain } from '../platform/native';
import { useStoreData } from '../store/store';
import { portfolioContext } from '../store/reports';
import { CopyPortfolio } from '../ui/CopyPortfolio';
import { Btn, C, Chip, Confirm, Empty, FS, Field, HeroCard, Notice, Skeleton, Sub, T } from '../ui';

export function ChatScreen({ openSettings }: { openSettings: () => void }) {
  const s = useStoreData();
  const provider = s.data.settings.aiProvider;
  const [key, setKey] = useState<string | null | undefined>(undefined);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => { Keychain.get(`ai-${provider}`).then(setKey); }, [provider]);
  useEffect(() => { setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50); }, [s.data.chat.length, sending]);

  async function send(text = input) {
    text = text.trim();
    if (!text || sending || !key) return;
    setInput('');
    setError(null);
    setSending(true);
    try {
      await s.chat.send(text, key, portfolioContext(s));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSending(false);
    }
  }

  // Checking the keychain for an API key: sketch the chat layout instead of rendering nothing.
  if (key === undefined) {
    return (
      <View style={{ flex: 1, padding: 20, gap: 14 }}>
        <Skeleton width={110} height={26} />
        <Skeleton width="72%" height={64} radius={18} />
        <Skeleton width="46%" height={42} radius={18} style={{ alignSelf: 'flex-end' }} />
        <Skeleton width="64%" height={84} radius={18} />
      </View>
    );
  }
  if (!key) {
    return (
      <Empty title="API 키를 설정하세요"
        message={`${AIProviders[provider].label} API 키를 등록하면\n포트폴리오 데이터를 참고한 AI 분석을 이용할 수 있어요.\n\nAPI 키 없이 쓰려면 포트폴리오를 복사해서\nClaude Code나 claude.ai에 붙여넣으세요.`}>
        <Btn title="설정 열기" kind="primary" onPress={openSettings} />
        <CopyPortfolio small={false} />
      </Empty>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}>
      <View style={{ width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 6 }}>
          <CopyPortfolio />
          <Chip title="대화 삭제" off={!s.data.chat.length} onPress={() => setConfirmClear(true)} />
        </View>
      </View>
      <ScrollView ref={scroll} style={{ flex: 1 }} keyboardDismissMode="interactive" contentContainerStyle={{ width: '100%', maxWidth: 720, alignSelf: 'center', padding: 16, gap: 10 }}>
        {!s.data.chat.length ? (
          <View style={{ gap: 12 }}>
            <HeroCard label="AI 채팅" title="포트폴리오에 대해 무엇이든 물어보세요" note="보유 종목, 원금 비중, 거래 기록을 함께 살펴봐요. 현재 시세와 평가금액은 AI에 보내지 않아요. 모든 대화는 기기에만 저장돼요." />
            <View style={{ gap: 8 }}>
              {['투자원금 기준으로 섹터·자산 집중도를 평가해줘', '실현손익을 종목별로 정리해줘', '최근 거래 패턴에서 개선할 점은?'].map(q => (
                <Btn key={q} title={q} onPress={() => send(q)} style={{ alignItems: 'flex-start', backgroundColor: C.control }} />
              ))}
            </View>
          </View>
        ) : null}
        {s.data.chat.map(m => (
          <View key={m.id} style={{ alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <View style={{ maxWidth: '84%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18,
              borderBottomRightRadius: m.role === 'user' ? 6 : 18, borderBottomLeftRadius: m.role === 'user' ? 18 : 6,
              backgroundColor: m.role === 'user' ? C.chipOn : C.control }}>
              <T selectable style={{ lineHeight: FS + 6, color: m.role === 'user' ? C.onChipOn : C.label }}>{m.text}</T>
            </View>
          </View>
        ))}
        {sending ? <Sub>답변 생성 중…</Sub> : null}
        {error ? <Notice title="답변을 받지 못했어요" message={error} /> : null}
        <Sub style={{ fontSize: 11, color: C.tertiary }}>면책 고지: 이 분석은 정보 제공 목적으로 작성되었으며 투자 조언이 아닙니다.</Sub>
      </ScrollView>
      <View style={{ width: '100%', maxWidth: 720, alignSelf: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'flex-end' }}>
        <Field onWindow value={input} onChange={setInput} placeholder="메시지를 입력하세요…" multiline style={{ flex: 1 }} />
        <Btn title="보내기" kind="primary" disabled={!input.trim() || sending} onPress={() => send()} />
      </View>
      {confirmClear ? (
        <Confirm message="대화 내용을 삭제하시겠습니까?" action="삭제"
          onConfirm={() => { s.data.chat = []; s.save(); }} onClose={() => setConfirmClear(false)} />
      ) : null}
    </KeyboardAvoidingView>
  );
}
