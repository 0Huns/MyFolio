import React, { useState } from 'react';
import { Pressable, ScrollView, View, useColorScheme } from 'react-native';
import { badges, goalPercent, quests } from '../domain/goals';
import { sum, useStore } from '../store/store';
import { Fmt } from '../utils';
import { Btn, C, Card, Field, T, Title, num } from '../ui';

const cardInk = '#0F3D2E'; // the green goal card and text on the amber badges, the same in both appearances
const reward = '#FFB74A';
const strong = { fontWeight: '700' } as const;
export const goalsTitle = { ...strong, fontSize: 20, color: C.goalInk };
const heading = { ...goalsTitle, marginTop: 4 };

/** Investment goal, today's checklist and habit badges. */
export function GoalsScreen() {
  const s = useStore();
  const goal = s.data.goal;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const hide = s.data.settings.hideAmounts;
  const total = sum.total(s.summary());
  const percent = goal ? goalPercent(total, goal.target) : 0;
  const done = s.goals.doneToday();
  const held = s.merged().map(m => m.ticker);
  // Resolved here rather than with a dynamic color: iOS drew the border in the light mode green while dark.
  const dark = useColorScheme() === 'dark';
  const boxOn = dark ? '#F2F5F3' : cardInk;
  const boxOff = dark ? '#FFFFFF' : C.tertiary;
  const amount = Number(target.replace(/\D/g, ''));

  const edit = () => {
    setName(goal?.name ?? '');
    setTarget(goal ? String(goal.target) : '');
    setEditing(true);
  };
  const save = () => {
    s.goals.setGoal({ name: name.trim() || '내 목표', target: amount });
    setEditing(false);
  };

  return (
    <ScrollView contentContainerStyle={{ width: '100%', maxWidth: 720, alignSelf: 'center', padding: 20, paddingTop: 8, gap: 16 }}>
      {editing || !goal ? (
        <Card style={{ gap: 12 }}>
          <Title>{goal ? '목표 바꾸기' : '투자 목표를 정해보세요'}</Title>
          <Field label="목표 이름" value={name} onChange={setName} placeholder="예: 300만원 모으기" />
          <Field label="목표 금액 (원)" value={target} onChange={setTarget} placeholder="3000000" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {goal ? <Btn title="취소" onPress={() => setEditing(false)} style={{ flex: 1 }} /> : null}
            <Btn title="저장" kind="primary" disabled={!(amount > 0)} onPress={save} style={{ flex: 2 }} />
          </View>
        </Card>
      ) : (
        <Pressable onPress={edit} accessibilityRole="button" accessibilityHint="목표를 바꿔요"
          style={({ pressed }) => ({ backgroundColor: cardInk, borderRadius: 26, padding: 22, gap: 12, opacity: pressed ? 0.9 : 1 })}>
          <T style={{ color: '#BFE8D6', fontSize: 14 }}>이번 목표</T>
          <T style={{ ...strong, color: '#FFFFFF', fontSize: 30, lineHeight: 38 }}>{goal.name}</T>
          <View style={{ height: 16, borderRadius: 8, backgroundColor: '#2A5C4A', overflow: 'hidden' }}>
            <View style={{ width: `${percent}%`, height: 16, borderRadius: 8, backgroundColor: reward }} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T style={[{ color: '#FFFFFF', fontSize: 14 }, num]}>{Fmt.krw(total, hide)}</T>
            <T style={[{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }, num]}>{percent >= 100 ? '달성했어요' : `${percent.toFixed(0)}% 왔어요`}</T>
          </View>
        </Pressable>
      )}

      <T style={heading}>오늘의 퀘스트</T>
      <View style={{ gap: 10 }}>
        {quests.map(q => {
          const on = done.includes(q.id);
          return (
            <Pressable key={q.id} onPress={() => s.goals.toggleQuest(q.id)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 18, backgroundColor: C.control }}>
              <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: on ? boxOn : boxOff, backgroundColor: on ? boxOn : C.control, alignItems: 'center', justifyContent: 'center' }}>
                {on ? <T style={{ color: C.onGoalInk, fontWeight: '800', fontSize: 13, lineHeight: 16 }}>✓</T> : null}
              </View>
              <T style={{ flex: 1, color: C.goalInk, fontSize: 15 }}>{q.title}</T>
            </Pressable>
          );
        })}
      </View>

      <T style={heading}>모은 배지</T>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {badges(s.data.trades, held, Date.now()).map(b => (
          <View key={b.caption} style={{ flex: 1, alignItems: 'center', gap: 2, paddingVertical: 14, paddingHorizontal: 8, borderRadius: 18, backgroundColor: b.earned ? reward : C.control }}>
            <T style={{ ...strong, fontSize: 22, color: b.earned ? cardInk : C.goalMuted }}>{b.title}</T>
            <T style={{ fontSize: 12, color: b.earned ? cardInk : C.goalMuted }}>{b.caption}</T>
          </View>
        ))}
      </View>
      <T style={{ color: C.goalMuted, fontSize: 12, paddingHorizontal: 4 }}>
        {goal ? `목표 ${Fmt.krw(goal.target, hide)} · 카드를 누르면 바꿀 수 있어요. ` : ''}목표는 현금을 포함한 내 전체 자산으로 계산해요. 체크는 매일 새로 시작해요.
      </T>
    </ScrollView>
  );
}
