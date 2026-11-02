export const AIProviders = {
  anthropic: { label: 'Anthropic (Claude)', defaultModel: 'claude-opus-5-5', keyURL: 'https://console.anthropic.com/settings/keys' },
  openai: { label: 'OpenAI', defaultModel: 'gpt-5', keyURL: 'https://platform.openai.com/api-keys' },
} as const;
export type AIProvider = keyof typeof AIProviders;
