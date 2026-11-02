import { CoinoneProvider, UpbitStyleProvider } from '../api/brokers/exchanges';
import { KISProvider } from '../api/brokers/kis';
import { KiwoomProvider } from '../api/brokers/kiwoom';
import { TossProvider } from '../api/brokers/toss';
import { BrokerAccount, BrokerProvider } from '../domain/models';
import { Keychain } from '../platform/native';
import { AppError } from '../utils';
import { AppState } from './AppState';

/** Broker API clients for the configured accounts. */
export class BrokerClients {
  constructor(private state: AppState) {}

  async provider(a: BrokerAccount): Promise<BrokerProvider> {
    const c = await Keychain.credentials(a.id);
    if (!c?.key || !c?.secret)
      throw new AppError('API 키가 설정되지 않았습니다.');
    switch (a.broker) {
      case 'kis':
        return new KISProvider(a, c);
      case 'kiwoom':
        return new KiwoomProvider(a, c);
      case 'toss':
        return new TossProvider(a, c);
      case 'upbit':
        return new UpbitStyleProvider('upbit', c);
      case 'bithumb':
        return new UpbitStyleProvider('bithumb', c);
      case 'coinone':
        return new CoinoneProvider(c);
      default:
        throw new AppError('수동 계좌는 동기화할 수 없습니다.');
    }
  }

  private tossEntry?: {
    accountId: string;
    key: string;
    secret: string;
    client: TossProvider;
  };

  /** Market-data client from the first Toss account, when one is connected (prices, FX, candles). */
  async toss(): Promise<TossProvider | null> {
    const a = this.state.data.accounts.find(x => x.broker === 'toss');
    if (!a) return null;
    const c = await Keychain.credentials(a.id);
    if (!c?.key || !c?.secret) return null;
    if (
      this.tossEntry?.accountId !== a.id ||
      this.tossEntry.key !== c.key ||
      this.tossEntry.secret !== c.secret
    )
      this.tossEntry = {
        accountId: a.id,
        key: c.key,
        secret: c.secret,
        client: new TossProvider(a, c),
      };
    return this.tossEntry.client;
  }
}
