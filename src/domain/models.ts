export type Currency = 'krw' | 'usd';
export type AssetType = 'stock' | 'crypto';
export type Market = 'krx' | 'us' | 'crypto';
export type TradeSide = 'buy' | 'sell';
export type BrokerType = 'kis' | 'kiwoom' | 'toss' | 'upbit' | 'bithumb' | 'coinone' | 'manual';

export const marketCurrency = (m: Market): Currency => (m === 'us' ? 'usd' : 'krw');
export const marketLabel: Record<Market, string> = { krx: '국내', us: '미국', crypto: '코인' };
export const sideLabel: Record<TradeSide, string> = { buy: '매수', sell: '매도' };

type BrokerInfo = {
  name: string;
  exchange: boolean;
  keyLabels: [string, string];
  needsAccountNumber?: boolean;
  supportsPaper?: boolean;
  progressive?: boolean;
  /** Not verified against a real account yet: new accounts can't be added. */
  preparing?: boolean;
  guideURL?: string;
  guide: string[];
};

export const Brokers: Record<BrokerType, BrokerInfo> = {
  kis: {
    name: '한국투자증권', exchange: false, keyLabels: ['App Key', 'App Secret'],
    needsAccountNumber: true, supportsPaper: true, progressive: true, preparing: true,
    guideURL: 'https://apiportal.koreainvestment.com/apiservice',
    guide: ['KIS Developers에 회원가입 또는 로그인하세요', '계좌를 선택하고 App Key / App Secret을 생성하세요', 'App Key와 App Secret을 위 입력란에 붙여넣으세요'],
  },
  kiwoom: {
    name: '키움증권', exchange: false, keyLabels: ['App Key', 'Secret Key'], supportsPaper: true, progressive: true, preparing: true,
    guideURL: 'https://openapi.kiwoom.com',
    guide: ['키움 REST API 포탈에 가입하고 IP를 등록하세요', '계좌를 선택하고 App Key / Secret Key를 발급하세요', 'App Key와 Secret Key를 위 입력란에 붙여넣으세요'],
  },
  toss: {
    name: '토스증권', exchange: false, keyLabels: ['Client ID', 'Client Secret'], progressive: true,
    guideURL: 'https://developers.tossinvest.com/docs',
    guide: ['토스증권 WTS 앱을 열고 [설정] → [Open API] 메뉴로 이동하세요', '약관에 동의하면 Client ID와 Client Secret이 즉시 발급됩니다', 'Client ID와 Client Secret을 위 입력란에 붙여넣으세요'],
  },
  upbit: {
    name: '업비트', exchange: true, preparing: true, keyLabels: ['Access Key', 'Secret Key'],
    guideURL: 'https://upbit.com/mypage/open_api_management',
    guide: ['업비트에 로그인 후 마이페이지 → [Open API 관리]를 선택하세요', "'자산조회', '주문조회' 권한을 체크하고 IP를 등록해 키를 발급하세요", 'Access Key와 Secret Key를 위 입력란에 붙여넣으세요'],
  },
  bithumb: {
    name: '빗썸', exchange: true, preparing: true, keyLabels: ['Access Key', 'Secret Key'],
    guideURL: 'https://www.bithumb.com/react/api-support/management-api',
    guide: ['빗썸에 로그인 후 마이페이지 → [API Key 발급]으로 이동하세요', "'자산조회' 권한을 체크하고 키를 발급하세요", 'Access Key와 Secret Key를 위 입력란에 붙여넣으세요'],
  },
  coinone: {
    name: '코인원', exchange: true, preparing: true, keyLabels: ['Access Token', 'Secret Key'],
    guideURL: 'https://coinone.co.kr/developer/app',
    guide: ['코인원에 로그인 후 개발자 센터로 이동하세요', "[나의 앱] → [앱 생성]에서 '계좌 조회'와 '주문 조회' 권한을 체크하세요", 'Access Token과 Secret Key를 위 입력란에 붙여넣으세요'],
  },
  manual: { name: '수동', exchange: false, keyLabels: ['', ''], guide: [] },
};

export type BrokerValuation = {
  /** Broker holdings totals in native currencies; excludes cash. */
  value: { krw: number; usd: number };
  purchase: { krw: number; usd: number };
  profit: { krw: number; usd: number };
  at: number;
};

export type BrokerAccount = {
  id: string;
  name: string;
  broker: BrokerType;
  accountNumber: string;
  isPaper: boolean;
  cashKRW: number;
  valuation?: BrokerValuation;
  /** Uninvested USD buying power, converted at the current display FX rate. */
  cashUSD?: number;
  lastSyncDate?: number;
  oldestSyncedTradeDate?: number;
  lastError?: string;
};

export type Holding = {
  id: string;
  accountId: string;
  ticker: string;
  name: string;
  assetType: AssetType;
  market: Market;
  quantity: number;
  avgPrice: number; // native currency
  lastPrice: number;
  /** Broker-reported net valuation in the native currency at lastPrice. */
  amountAfterCost?: number;
  purchaseAmount?: number;
  profitAfterCost?: number;
  valuationAt?: number;
  /** Account-specific commission schedule received with the valuation snapshot. */
  valuationCommission?: { rate: number; startDate?: string; endDate?: string };
  /** Broker cost totals; not a buy/sell breakdown. Never infer historic buy fees from these. */
  brokerCost?: { commission: number; tax: number };
};

/** Live estimate anchored to the broker's net amount. Historic costs never scale with price. */
export function liveHoldingValue(h: Pick<Holding, 'quantity' | 'lastPrice' | 'amountAfterCost' | 'market' | 'valuationCommission' | 'valuationAt'>, price: number, now = Date.now()): number {
  const gross = h.quantity * price;
  if (h.amountAfterCost == null || !Number.isFinite(h.amountAfterCost)) return gross;
  if (price === h.lastPrice) return h.amountAfterCost;
  const delta = h.quantity * (price - h.lastPrice);
  const schedule = h.valuationCommission;
  const day = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
  const valid = schedule && Number.isFinite(schedule.rate) && schedule.rate >= 0 && schedule.rate < 1
    && (!schedule.startDate || schedule.startDate <= day) && (!schedule.endDate || schedule.endDate >= day);
  // Small US orders may be commission-exempt. Do not extrapolate across that boundary.
  const standardOrder = h.market !== 'us' || (gross > 10 && h.quantity * h.lastPrice > 10);
  const commissionDelta = valid && standardOrder ? delta * schedule.rate : 0;
  // Taxes, historic fees and broker-specific rounding stay in the official snapshot.
  return h.amountAfterCost + delta - commissionDelta;
}

export type Trade = {
  id: string;
  accountId: string;
  brokerOrderId: string;
  ticker: string;
  name: string;
  assetType: AssetType;
  market: Market;
  side: TradeSide;
  date: number;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
};

/** Stocks and coins can share a ticker (e.g. META) → identity is ticker + domain. */
export const identity = (t: AssetType, ticker: string) => `${t === 'crypto' ? 'crypto' : 'sec'}:${ticker.toUpperCase()}`;

export type Snapshot = { date: number; totalValue: number; stockValue: number; cryptoValue: number; cost: number; cash: number };
export type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; date: number };

export type Filing = { cik: string; ticker: string; form: string; date: number; accession: string; doc: string; description: string };

/** An amount to reach, compared with total assets including cash. */
export type Goal = { name: string; target: number };

export type Settings = {
  appearance: 'system' | 'light' | 'dark';
  backgroundSyncMinutes: number;
  syncDays: number;
  aiProvider: 'anthropic' | 'openai';
  aiModel: string;
  secContact: string;
  usWatchlist: string[];
  hideAmounts: boolean;
  /** Show portfolio amounts in won or dollars (converted at the current rate). */
  displayCurrency: 'krw' | 'usd';
};

export type AppData = {
  accounts: BrokerAccount[];
  holdings: Holding[];
  trades: Trade[];
  snapshots: Snapshot[];
  chat: ChatMessage[];
  settings: Settings;
  /** Daily USD/KRW fixings, including verified holiday carry-forward dates. */
  dailyFx?: Record<string, number>;
  goal?: Goal;
  /** Today's checked quests; a different `date` means nothing is checked yet. */
  quests?: { date: string; done: string[] };
  /** Toss trades re-read in full after partially filled canceled/replaced orders started being kept. */
  tossPartialFillsResynced?: boolean;
};

export const defaultSettings: Settings = {
  appearance: 'system',
  backgroundSyncMinutes: 0,
  syncDays: 365,
  aiProvider: 'anthropic',
  aiModel: '',
  secContact: '',
  usWatchlist: [],
  hideAmounts: false,
  displayCurrency: 'krw',
};

// Provider-normalized payloads
export type NormalizedHolding = Omit<Holding, 'id' | 'accountId'>;
export type NormalizedBalance = { holdings: NormalizedHolding[]; cashKRW: number; cashUSD?: number; valuation?: BrokerValuation };
export type NormalizedTrade = Omit<Trade, 'id' | 'accountId' | 'brokerOrderId'> & { orderId: string };
export type Progress = (msg: string) => void;

export interface BrokerProvider {
  fetchBalance(): Promise<NormalizedBalance>;
  fetchTrades(from: number, to: number, progress: Progress): Promise<NormalizedTrade[]>;
}

export type MergedHolding = {
  identityKey: string;
  ticker: string;
  name: string;
  assetType: AssetType;
  market: Market;
  quantity: number;
  cost: number;
  price: number;
  accountIds: string[];
  /** Legacy broker valuation adjustment for previously constructed merged holdings. */
  valuationAdjustment?: number;
  /** Sum of native-currency valuations without gross-minus-cost cancellation. */
  valuationAmount?: number;
  valuationAt?: number;
};

const holdingValue = (m: MergedHolding) => m.valuationAmount ?? m.quantity * m.price + (m.valuationAdjustment ?? 0);

export const mh = {
  currency: (m: MergedHolding) => marketCurrency(m.market),
  avg: (m: MergedHolding) => (m.quantity > 0 ? m.cost / m.quantity : 0),
  value: holdingValue,
  pnl: (m: MergedHolding) => holdingValue(m) - m.cost,
  ret: (m: MergedHolding) => (m.cost > 0 ? ((holdingValue(m) - m.cost) / m.cost) * 100 : 0),
};

// FINRA data
export type ShortVolume = { date: string; short: number; total: number; ratio: number };
export type ShortInterest = { date: string; shares: number; change: number; changePct: number; daysToCover: number; avgVolume: number };

/** One OHLC bar; `t` is the bar's start time (ms). */
export type Candle = { t: number; o: number; h: number; l: number; c: number; liveAt?: number };
