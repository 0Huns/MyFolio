import { AIProvider } from '../domain/aiProviders';
import { ChatMessage } from '../domain/models';
import { AppError, dict, list, str } from '../utils';
import { http } from './http';

export const systemPrompt = (context: string) => `당신은 사용자의 개인 투자 포트폴리오를 분석하는 어시스턴트입니다. 아래 포트폴리오 데이터를 근거로 보유 종목, 투자원금 배분, 집중도, 실현손익, 거래 패턴을 한국어로 명확하게 분석하세요. 이 데이터에는 현재 시세, 평가금액, 평가손익, 수익률이 없습니다. 이런 값을 물으면 앱에서 확인하도록 안내하세요. 숫자는 데이터에서 인용하고, 데이터에 없는 내용은 추측하지 말고 없다고 말하세요. 투자 조언이 아닌 정보 제공임을 염두에 두세요.

<portfolio>
${context}
</portfolio>`;

/** Portfolio chat with the user's own key. Conversations stay on the device. */
export async function sendChat(provider: AIProvider, model: string, apiKey: string, system: string, history: ChatMessage[]): Promise<string> {
  const messages = history.map(m => ({ role: m.role, content: m.text }));
  if (provider === 'anthropic') {
    const body: Record<string, unknown> = { model, max_tokens: 16000, system, messages };
    const headers: Record<string, string> = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
    // Current models: adaptive thinking + server-side refusal fallback.
    if (['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5'].includes(model)) {
      body.thinking = { type: 'adaptive' };
      body.fallbacks = 'default';
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    }
    let json: any;
    try {
      ({ json } = await http('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body), timeout: 600_000 }));
    } catch (e: any) {
      if (String(e?.message).includes('prompt is too long')) throw new AppError('대화가 너무 깁니다. 대화를 초기화하고 새로 시작해 주세요.');
      throw e;
    }
    if (str(json.stop_reason) === 'refusal') throw new AppError('모델이 이 요청에 대한 응답을 거절했습니다. 질문을 바꿔 다시 시도해 주세요.');
    const text = list(json.content).filter(b => b.type === 'text').map(b => str(b.text)).join('');
    if (!text) throw new AppError('빈 응답을 받았습니다.');
    return text;
  }
  const { json } = await http('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...messages] }),
    timeout: 600_000,
  });
  const text = str(dict(list(json.choices)[0]?.message).content);
  if (!text) throw new AppError('빈 응답을 받았습니다.');
  return text;
}
