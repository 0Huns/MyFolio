import {
  BrokerAccount,
  BrokerProvider,
  Brokers,
  NormalizedBalance,
  NormalizedTrade,
  identity,
} from '../domain/models';
import { account } from '../domain/portfolio';
import { DAY, uuid } from '../utils';
import { AppState } from './AppState';
import { BrokerClients } from './BrokerClients';
import { ExchangeRates } from './ExchangeRates';
import { History } from './History';
import { Quotes } from './Quotes';

/** Pulls balances and trades from the broker APIs into the state. */
export class Sync {
  constructor(
    private state: AppState,
    private clients: BrokerClients,
    private quotes: Quotes,
    private rates: ExchangeRates,
    private history: History,
  ) {}

  async all() {
    const targets = this.state.data.accounts.filter(a => a.broker !== 'manual');
    if (this.state.isSyncing || !targets.length) return;
    await this.syncAccounts(targets);
  }

  /** Sync one account now — after adding it or re-entering its keys. */
  async one(id: string) {
    const a = account(this.state, id);
    if (!a || a.broker === 'manual' || this.state.isSyncing) return;
    await this.syncAccounts([a]);
  }

  /** Per-account errors live on the account (`lastError`); the footer message only summarizes. */
  private async syncAccounts(targets: BrokerAccount[]) {
    this.state.isSyncing = true;
    let total = 0;
    const failed: string[] = [];
    try {
      for (const a of targets) {
        const first = !a.lastSyncDate;
        try {
          total += await this.syncOne(a, false);
          if (first) total += await this.syncOne(a, true, true); // first sync → full history
        } catch {
          failed.push(a.name);
        }
      }
    } finally {
      this.state.isSyncing = false;
      this.state.syncStatus = '';
    }
    await this.quotes.refresh();
    void this.rates.fillTradeDays();
    this.state.lastSyncFailed = failed.length > 0;
    this.state.lastSyncMessage = !failed.length
      ? `동기화 완료 · 신규 거래 ${total}건`
      : targets.length === 1
      ? `${failed[0]} 연결 실패`
      : `${failed.length}개 계좌 연결 실패 (${failed.join(', ')})${
          total ? ` · 신규 거래 ${total}건` : ''
        }`;
    this.state.emit();
  }

  async fullHistory(a: BrokerAccount) {
    if (this.state.isSyncing) return;
    this.state.isSyncing = true;
    try {
      const n = await this.syncOne(a, true);
      this.state.lastSyncFailed = false;
      this.state.lastSyncMessage = `전체 동기화 완료 · 신규 거래 ${n}건`;
    } catch {
      this.state.lastSyncFailed = true;
      this.state.lastSyncMessage = `${a.name} 연결 실패`;
    } finally {
      this.state.isSyncing = false;
      this.state.syncStatus = '';
    }
    this.history.record();
  }

  /** Balance + trades for one account. Returns number of new trades. */
  private async syncOne(
    a: BrokerAccount,
    fullHistory: boolean,
    skipBalance = false,
  ): Promise<number> {
    let p: BrokerProvider;
    try {
      p = await this.clients.provider(a);
    } catch (e) {
      // e.g. keys missing / unreadable from the keychain — record it on the account like any other failure.
      const acct = account(this.state, a.id);
      if (acct) acct.lastError = String((e as any)?.message ?? e);
      this.state.save();
      throw e;
    }
    const now = Date.now();
    const tierFrom = now - this.state.data.settings.syncDays * DAY;
    let from = tierFrom;
    // Progressive brokers only re-read the recent week once the full range has been fetched.
    if (
      !fullHistory &&
      Brokers[a.broker].progressive &&
      a.lastSyncDate &&
      a.oldestSyncedTradeDate &&
      a.oldestSyncedTradeDate <= tierFrom + DAY
    ) {
      from = a.lastSyncDate - 7 * DAY;
    }
    const progress = (msg: string) => this.state.setStatus(`${a.name}: ${msg}`);
    let failure: unknown;
    let n = 0;

    if (!skipBalance) {
      progress('잔고 조회 중…');
      try {
        this.applyBalance(await p.fetchBalance(), a.id);
      } catch (e) {
        failure = e;
      }
    }
    progress('거래내역 동기화 중…');
    try {
      n = this.applyTrades(await p.fetchTrades(from, now, progress), a.id);
      const acct = account(this.state, a.id);
      if (acct)
        acct.oldestSyncedTradeDate = Math.min(
          acct.oldestSyncedTradeDate ?? from,
          from,
        );
    } catch (e) {
      failure ??= e;
    }
    const acct = account(this.state, a.id);
    if (acct) {
      acct.lastError = failure
        ? String((failure as any)?.message ?? failure)
        : undefined;
      if (!failure || !skipBalance) acct.lastSyncDate = now;
    }
    this.state.save();
    if (failure) throw failure;
    return n;
  }

  applyBalance(bal: NormalizedBalance, accountId: string) {
    this.state.data.holdings = this.state.data.holdings
      .filter(h => h.accountId !== accountId)
      .concat(bal.holdings.map(h => ({ ...h, id: uuid(), accountId })));
    const a = account(this.state, accountId);
    if (a) {
      a.cashKRW = bal.cashKRW;
      a.cashUSD = bal.cashUSD ?? 0;
      a.valuation = bal.valuation;
    }
  }

  private applyTrades(trades: NormalizedTrade[], accountId: string): number {
    const existing = new Set(
      this.state.data.trades
        .filter(t => t.accountId === accountId)
        .map(t => t.brokerOrderId),
    );
    const names: Record<string, string> = {};
    for (const h of this.state.data.holdings)
      names[identity(h.assetType, h.ticker)] ??= h.name;
    let n = 0;
    for (const t of trades) {
      if (existing.has(t.orderId)) continue;
      existing.add(t.orderId);
      const { orderId, ...rest } = t;
      const name =
        !t.name || t.name === t.ticker
          ? names[identity(t.assetType, t.ticker)] ?? t.name
          : t.name;
      this.state.data.trades.push({
        ...rest,
        name,
        id: uuid(),
        accountId,
        brokerOrderId: orderId,
      });
      n++;
    }
    return n;
  }

  /** Synced (non-manual) accounts currently holding the asset — the ones `resetAndResync` can re-download from. */
  resyncTargets(identityKey: string) {
    const ids = new Set(
      this.state.data.holdings
        .filter(h => identity(h.assetType, h.ticker) === identityKey)
        .map(h => h.accountId),
    );
    return this.state.data.accounts.filter(
      a => ids.has(a.id) && a.broker !== 'manual',
    );
  }

  /** Drops the asset's trades in the accounts that hold it, then re-downloads those accounts' full history. */
  async resetAndResync(identityKey: string) {
    const targets = this.resyncTargets(identityKey);
    const accts = new Set(targets.map(a => a.id));
    const before = this.state.data.trades.length;
    this.state.data.trades = this.state.data.trades.filter(
      t =>
        !(
          accts.has(t.accountId) &&
          identity(t.assetType, t.ticker) === identityKey
        ),
    );
    this.state.lastSyncMessage = `${
      before - this.state.data.trades.length
    }건 삭제 완료. 다시 받는 중…`;
    this.state.save();
    this.state.isSyncing = true;
    try {
      for (const a of targets) {
        try {
          await this.syncOne(a, true, true);
        } catch {}
      }
    } finally {
      this.state.isSyncing = false;
      this.state.syncStatus = '';
    }
    this.state.lastSyncMessage = '거래내역 다시 받기 완료';
    this.state.emit();
  }
}
