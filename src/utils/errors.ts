export class AppError extends Error {}

export class HttpError extends AppError {
  constructor(message: string, public status: number, public headers: Headers, public code: string) {
    super(message);
  }
}

/** Sorts a sync error into something actionable: short title, what to do, and the raw message. */
export function describeError(msg: string): { title: string; hint: string; detail: string } {
  const m = msg.toLowerCase();
  const r = (title: string, hint: string) => ({ title, hint, detail: msg });
  if (m.includes('token-revoked')) return r('다른 기기에서 인증이 갱신됨', '같은 API 클라이언트는 토큰 하나만 사용할 수 있어요. 맥·아이폰에서 따로 재발급하면 서로 연결이 끊깁니다.');
  if (msg.includes('API 키가 설정되지')) return r('키를 불러오지 못함', '계좌 편집에서 키를 다시 저장하세요. 키체인 접근 창이 뜨면 허용해 주세요.');
  if (/http 401|unauthori[sz]ed|invalid_client|invalid_token|토큰 발급 실패/.test(m)) return r('인증 실패', 'API 키(ID/Secret)가 맞는지, 만료되지 않았는지 확인하세요.');
  if (/http 403|forbidden|\bip\b|ip address|ip 주소|허용 ip/.test(m)) return r('접근 거부', '증권사·거래소에 지금 네트워크의 공인 IP가 허용돼 있는지 확인하세요.');
  if (msg.includes('한도')) return r('요청 한도 초과', '잠시 후 다시 시도하세요.');
  if (msg.includes('네트워크 오류') || msg.includes('시간이 초과')) return r('네트워크 오류', '인터넷 연결을 확인하고 다시 시도하세요.');
  if (/http 5\d\d/.test(m)) return r('서버 오류', '증권사·거래소 서버 문제일 수 있어요. 잠시 후 다시 시도하세요.');
  return r('동기화 실패', '');
}
