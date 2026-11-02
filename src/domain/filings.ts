import { Filing } from './models';

export const formLabels: Record<string, string> = {
  '8-K': '수시공시 (주요 사건)',
  '10-K': '연간 보고서',
  '10-Q': '분기 보고서',
  '4': '내부자 거래',
  '3': '내부자 최초 보고',
  '144': '제한주식 매도 예정',
  'SCHEDULE 13D': '5% 이상 지분 (경영 참여)',
  'SCHEDULE 13G': '5% 이상 지분 (단순 투자)',
  'S-1': '증권 신고서 (상장)',
  'S-3': '증권 신고서',
  '424B5': '증자·채권 발행 설명서',
  'DEF 14A': '주주총회 위임장',
  '6-K': '해외기업 수시공시',
  '20-F': '해외기업 연간 보고서',
};

/** What a form is, in everyday words: a generic description of the form type, not a summary of the filing itself. */
const formPlain: Record<string, string> = {
  '8-K': '회사에 중요한 일이 있었어요',
  '10-K': '1년 실적 보고서가 나왔어요',
  '10-Q': '분기 실적 보고서가 나왔어요',
  '4': '회사 내부자가 주식을 거래했어요',
  '3': '새 내부자가 보유 주식을 신고했어요',
  '144': '내부자가 주식을 팔 예정이에요',
  'SCHEDULE 13D': '누군가 5% 넘게 사서 경영 참여를 밝혔어요',
  'SCHEDULE 13G': '누군가 5% 넘게 투자했어요',
  'S-1': '상장 신고서를 냈어요',
  'S-3': '증권 발행 신고서를 냈어요',
  '424B5': '주식이나 채권을 발행해요',
  'DEF 14A': '주주총회 안내가 나왔어요',
  '6-K': '해외 기업이 수시 보고를 냈어요',
  '20-F': '해외 기업이 연간 보고서를 냈어요',
};

/** Base form without the amendment suffix; legacy "SC 13D" → "SCHEDULE 13D". */
export const baseForm = (form: string) => form.replace(/\/A$/, '').replace(/^SC (13[DG])$/, 'SCHEDULE $1');

export const formLabel = (form: string, fallback = '') => {
  const label = formLabels[baseForm(form)];
  return label ? label + (form.endsWith('/A') ? ' (정정)' : '') : fallback;
};

export const formSentence = (form: string, fallback = '') => formPlain[baseForm(form)] ?? fallback;

export const filingURL = (f: Filing) =>
  // Form 3/4/5 primary docs are "xslF345X06/form4.xml" — the xsl path is SEC's human-readable rendering.
  `https://www.sec.gov/Archives/edgar/data/${Number(f.cik)}/${f.accession.replace(/-/g, '')}/${f.doc}`;

export type FilingFilter = 'all' | 'major' | 'insider';

const INSIDER_FORMS = ['3', '4', '5', '144'];

export function filterFilings(list: Filing[], filter: FilingFilter): Filing[] {
  if (filter === 'all') return list;
  return list.filter(f => INSIDER_FORMS.includes(baseForm(f.form)) === (filter === 'insider'));
}
