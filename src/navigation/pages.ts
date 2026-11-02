export type Page = 'portfolio' | 'goals' | 'trades' | 'us' | 'chat' | 'settings' | `account:${string}`;

export const pages: [Page, string, string][] = [
  ['portfolio', '포트폴리오', '◔'], ['goals', '투자 목표', '◎'], ['trades', '거래내역', '☰'], ['us', '미국주식 공시·공매도', '$'], ['chat', 'AI 채팅', '✦'],
];
export const titles: Record<string, string> = Object.fromEntries([...pages.map(([p, label]) => [p, label]), ['settings', '설정']]);
