import React, { useState } from 'react';
import { Native } from '../platform/native';
import { store } from '../store/store';
import { portfolioMarkdown } from '../store/reports';
import { Btn, Chip } from './controls';

/** Copies the portfolio as Markdown, to paste into Claude Code / claude.ai (uses the user's own subscription there). */
export function CopyPortfolio({ small = true }: { small?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    Native.copyText(portfolioMarkdown(store)).then(ok => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  const title = copied ? '복사됨 ✓' : 'AI용으로 복사';
  return small ? <Chip title={title} onPress={copy} /> : <Btn title={title} onPress={copy} />;
}
