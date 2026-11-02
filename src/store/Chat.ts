import { sendChat, systemPrompt } from '../api/ai';
import { AIProviders } from '../domain/aiProviders';
import { uuid } from '../utils';
import { AppState } from './AppState';

/** The AI chat conversation. */
export class Chat {
  constructor(private state: AppState) {}

  /** Appends the question, asks the configured provider with the portfolio as context, appends the reply. */
  async send(text: string, apiKey: string, context: string) {
    const { aiProvider, aiModel } = this.state.data.settings;
    this.state.data.chat.push({
      id: uuid(),
      role: 'user',
      text,
      date: Date.now(),
    });
    this.state.save();
    const reply = await sendChat(
      aiProvider,
      aiModel || AIProviders[aiProvider].defaultModel,
      apiKey,
      systemPrompt(context),
      this.state.data.chat,
    );
    this.state.data.chat.push({
      id: uuid(),
      role: 'assistant',
      text: reply,
      date: Date.now(),
    });
    this.state.save();
  }
}
