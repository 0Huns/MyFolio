import { filingURL, formLabel } from './filings';
import { Filing, ShortInterest, ShortVolume } from './models';

type Input = {
  ticker: string; name: string | null; volumes: ShortVolume[]; volumesLoading: boolean;
  /** null while loading. */
  shortInterest: ShortInterest[] | null;
  /** null while loading. */
  filings: Filing[] | null;
  filingError: boolean;
};

/** Markdown of the loaded public data for one ticker, for pasting into an AI assistant. */
export function tickerReport({ ticker, name, volumes, volumesLoading, shortInterest, filings, filingError }: Input): string {
  const lines = [
    `# ${ticker}${name ? ` — ${name}` : ''}`,
    `복사 시각: ${new Date().toISOString()} (UTC)`,
    'MyFolio에 현재 로드된 공개 데이터입니다. 아래 날짜는 각 데이터의 기준일이며 실시간 데이터가 아닙니다.',
    '', '## FINRA 일별 공매도 거래량',
    '공매도 거래량 비율과 공매도 잔고 비율은 서로 다른 지표입니다. 아래 비율은 해당 FINRA 보고 데이터의 공매도량 / 총 거래량입니다.',
  ];
  if (volumesLoading) lines.push('불러오는 중 — 아래 데이터가 있더라도 최신 조회가 완료되지 않았습니다.');
  if (!volumes.length && !volumesLoading) lines.push('데이터 없음 또는 조회 불가');
  if (volumes.length) {
    lines.push(`조회된 ${volumes.length}개 일자의 단순 평균 비율: ${(volumes.reduce((sum, v) => sum + v.ratio, 0) / volumes.length).toFixed(2)}%`);
    for (const v of volumes) lines.push(`${v.date}: 공매도량 ${v.short.toLocaleString('en-US')}주 / 총 거래량 ${v.total.toLocaleString('en-US')}주 / 비율 ${v.ratio.toFixed(2)}%`);
  }
  lines.push('', '## 공매도 잔고 (월 2회 발표)');
  if (shortInterest === null) lines.push('불러오는 중');
  else if (!shortInterest.length) lines.push('데이터 없음 또는 조회 불가');
  else for (const r of shortInterest) lines.push(`${r.date}: 잔고 ${r.shares.toLocaleString('en-US')}주 / 직전 대비 ${r.changePct.toFixed(2)}% / Days to cover ${r.daysToCover.toFixed(2)} / 평균 거래량 ${r.avgVolume.toLocaleString('en-US')}주`);
  lines.push('', '## SEC 공시', '화면의 공시 필터와 무관하게 로드된 전체 목록입니다. 공시 본문은 포함하지 않았으며 제목·유형·일자·원문 링크만 제공합니다.');
  if (filingError) lines.push('공시 조회 실패');
  else if (filings === null) lines.push('불러오는 중');
  else if (!filings.length) lines.push('조회된 공시 없음');
  else for (const f of filings) lines.push(`- ${new Date(f.date).toISOString()} | ${f.form} | ${formLabel(f.form, f.description)}\n  ${filingURL(f)}`);
  lines.push('', '## 분석 요청', '위 자료로 주요 공시 내용과 공매도 추이를 분석해 주세요. 공시 내용은 원문 링크를 확인하고, 확인하지 못한 본문은 추측하지 마세요. 공매도 거래량 비율만으로 주가 방향이나 숏스퀴즈 가능성을 단정하지 말고, 데이터 기준일·누락과 추가 확인할 정보를 구분해 주세요.');
  return lines.join('\n');
}
