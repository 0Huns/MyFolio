import { BrokerAccount, Holding } from '../domain/models';
import { Keychain } from '../platform/native';
import { AppState } from './AppState';
import { Quotes } from './Quotes';

/** Adding, removing and resetting accounts and manual holdings. */
export class Accounts {
  constructor(private state: AppState, private quotes: Quotes) {}

  upsert(a: BrokerAccount) {
    const i = this.state.data.accounts.findIndex(x => x.id === a.id);
    if (i >= 0) this.state.data.accounts[i] = a;
    else this.state.data.accounts.push(a);
    this.state.save();
  }

  async remove(a: BrokerAccount) {
    this.state.data.accounts = this.state.data.accounts.filter(
      x => x.id !== a.id,
    );
    this.state.data.holdings = this.state.data.holdings.filter(
      h => h.accountId !== a.id,
    );
    this.state.data.trades = this.state.data.trades.filter(
      t => t.accountId !== a.id,
    );
    await Keychain.deleteAccount(a.id);
    this.state.save();
  }

  resetSyncedData() {
    const manual = new Set(
      this.state.data.accounts
        .filter(a => a.broker === 'manual')
        .map(a => a.id),
    );
    this.state.data.holdings = this.state.data.holdings.filter(h =>
      manual.has(h.accountId),
    );
    this.state.data.trades = [];
    this.state.data.snapshots = [];
    this.state.data.accounts = this.state.data.accounts.map(a =>
      a.broker === 'manual'
        ? a
        : {
            ...a,
            cashKRW: 0,
            cashUSD: 0,
            valuation: undefined,
            lastSyncDate: undefined,
            oldestSyncedTradeDate: undefined,
            lastError: undefined,
          },
    );
    this.state.prices = {};
    this.state.save();
  }

  saveManualHolding(h: Holding) {
    const i = this.state.data.holdings.findIndex(x => x.id === h.id);
    if (i >= 0) this.state.data.holdings[i] = h;
    else this.state.data.holdings.push(h);
    this.state.save();
    this.quotes.refresh();
  }

  deleteHolding(id: string) {
    this.state.data.holdings = this.state.data.holdings.filter(
      h => h.id !== id,
    );
    this.state.save();
  }
}
