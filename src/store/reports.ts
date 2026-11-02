import {
  Brokers,
  marketCurrency,
  marketLabel,
  mh,
  sideLabel,
} from '../domain/models';
import { Fmt } from '../utils';
import type { Store } from './store';

export function tradesCSV(store: Store, trades = store.data.trades): string {
  const rows = [...trades]
    .sort((a, b) => b.date - a.date)
    .map(t =>
      [
        Fmt.dateTime(t.date),
        store.account(t.accountId)?.name ?? '',
        t.name,
        t.ticker,
        sideLabel[t.side],
        t.quantity,
        t.price,
        t.quantity * t.price,
        t.fee,
        t.tax,
        marketCurrency(t.market).toUpperCase(),
      ]
        .map(v => (String(v).includes(',') ? `"${v}"` : String(v)))
        .join(','),
    );
  return [
    '일자,계좌,종목명,티커,구분,수량,단가,체결금액,수수료,세금,통화',
    ...rows,
  ].join('\n');
}

export function holdingsCSV(store: Store): string {
  const rows = store
    .merged()
    .sort(
      (a, b) =>
        store.toKRW(mh.value(b), mh.currency(b)) -
        store.toKRW(mh.value(a), mh.currency(a)),
    )
    .map(m =>
      [
        m.name.replace(/,/g, ' '),
        m.ticker,
        m.assetType === 'crypto' ? '암호화폐' : '증권',
        m.quantity,
        mh.avg(m),
        m.price,
        Math.trunc(store.toKRW(mh.value(m), mh.currency(m))),
        Math.trunc(store.holdingPnl(m)),
        store.holdingReturn(m).toFixed(2),
      ].join(','),
    );
  return [
    '종목명,티커,구분,수량,평균단가,현재가,평가금액(원),평가손익(원),수익률(%)',
    ...rows,
  ].join('\n');
}

/**
 * Snapshot to paste into Claude Code / claude.ai. Numbers only — no account numbers, keys or tokens.
 * Market prices and anything computed from them (valuations, P&L, returns) stay out: Toss's Open API terms (art. 5 ③)
 * forbid passing quotes to third parties. What remains comes from the user's own orders and balances.
 */
export function portfolioMarkdown(store: Store): string {
  const s = store.summary();
  const realizedBy = store.realizedByAsset();
  const realized = Object.values(realizedBy).reduce((a, b) => a + b, 0);
  const pct = (v: number) => `${((v / (s.cost || 1)) * 100).toFixed(1)}%`;
  const costs = store.merged().map(m => ({ m, cost: store.holdingCost(m) }));
  const costOf = (crypto: boolean) =>
    costs
      .filter(x => (x.m.assetType === 'crypto') === crypto)
      .reduce((a, x) => a + x.cost, 0);
  const L: string[] = [
    '# MyFolio 포트폴리오',
    '',
    '시세와 평가금액, 수익률은 포함하지 않았어요. 비중은 투자원금 기준이에요.',
    '',
    `- 기준: ${Fmt.dateTime(Date.now())} (KST)`,
    `- USD/KRW: ${Math.round(store.usdKrw)}`,
    `- 투자원금: ${Fmt.krw(s.cost)} · 현금: ${Fmt.krw(s.cash)}`,
    `- 실현손익 합계(동기화된 거래 기준): ${Fmt.signedKRW(realized)}`,
    `- 원금 배분: 증권 ${pct(costOf(false))} · 코인 ${pct(costOf(true))}`,
    '',
    '## 계좌',
    '',
    '| 계좌 | 증권사/거래소 | 투자원금 | 현금 | 마지막 동기화 |',
    '|---|---|---:|---:|---|',
  ];
  for (const a of store.data.accounts) {
    const as = store.summary(a.id);
    L.push(
      `| ${a.name} | ${Brokers[a.broker].name} | ${Fmt.krw(
        as.cost,
      )} | ${Fmt.krw(as.cash)} | ${
        a.lastSyncDate ? Fmt.dateTime(a.lastSyncDate) : '-'
      } |`,
    );
  }
  L.push(
    '',
    '## 보유 종목 (투자원금순)',
    '',
    '| 종목 | 티커 | 시장 | 수량 | 평균단가 | 투자원금(원) | 원금 비중 | 실현손익(원) |',
    '|---|---|---|---:|---:|---:|---:|---:|',
  );
  for (const { m, cost } of [...costs].sort((a, b) => b.cost - a.cost))
    L.push(
      `| ${m.name} | ${m.ticker} | ${marketLabel[m.market]} | ${Fmt.qty(
        m.quantity,
      )} | ${store.avgPriceText(m)} | ${Fmt.krw(cost)} | ${pct(
        cost,
      )} | ${Fmt.signedKRW(realizedBy[m.identityKey] ?? 0)} |`,
    );
  const trades = [...store.data.trades].sort((a, b) => b.date - a.date);
  if (trades.length) {
    L.push(
      '',
      `## 최근 거래 (전체 ${trades.length}건 중 최대 100건)`,
      '',
      '| 일시 | 구분 | 종목 | 티커 | 수량 | 체결가 | 금액 | 계좌 |',
      '|---|---|---|---|---:|---:|---:|---|',
    );
    for (const t of trades.slice(0, 100)) {
      const c = marketCurrency(t.market);
      L.push(
        `| ${Fmt.dateTime(t.date)} | ${sideLabel[t.side]} | ${t.name} | ${
          t.ticker
        } | ${Fmt.qty(t.quantity)} | ${Fmt.price(t.price, c)} | ${Fmt.price(
          t.quantity * t.price,
          c,
        )} | ${store.account(t.accountId)?.name ?? ''} |`,
      );
    }
  }
  return L.join('\n');
}

/** What the AI chat is told. Like `portfolioMarkdown`, no market prices or anything computed from them. */
export function portfolioContext(store: Store): string {
  const s = store.summary();
  const lines = [
    `기준일: ${Fmt.date(Date.now())}  USD/KRW: ${Math.round(store.usdKrw)}`,
    `투자원금: ${Fmt.krw(s.cost)}, 현금: ${Fmt.krw(s.cash)}`,
    '',
    '보유종목 (종목명 | 티커 | 시장 | 수량 | 평균단가 | 투자원금(원) | 원금 비중):',
  ];
  const costs = store.merged().map(m => ({ m, cost: store.holdingCost(m) }));
  for (const { m, cost } of costs.sort((a, b) => b.cost - a.cost))
    lines.push(
      `${m.name} | ${m.ticker} | ${marketLabel[m.market]} | ${Fmt.qty(
        m.quantity,
      )} | ${store.avgPriceText(m)} | ${Fmt.krw(cost)} | ${(s.cost > 0
        ? (cost / s.cost) * 100
        : 0
      ).toFixed(1)}%`,
    );
  const realized = Object.values(store.realizedByAsset()).reduce(
    (a, b) => a + b,
    0,
  );
  lines.push(
    '',
    `동기화된 거래내역 기준 실현손익 합계: ${Fmt.signedKRW(realized)} (거래 ${
      store.data.trades.length
    }건)`,
  );
  const recent = [...store.data.trades]
    .sort((a, b) => b.date - a.date)
    .slice(0, 40);
  if (recent.length) {
    lines.push('최근 거래 (최대 40건):');
    for (const t of recent)
      lines.push(
        `${Fmt.date(t.date)} ${sideLabel[t.side]} ${t.name}(${
          t.ticker
        }) ${Fmt.qty(t.quantity)} @ ${Fmt.price(
          t.price,
          marketCurrency(t.market),
        )}`,
      );
  }
  return lines.join('\n');
}
