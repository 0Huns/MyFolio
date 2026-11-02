import { useSyncExternalStore } from 'react';
import {
  AppState as RNAppState,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';
import { MergedHolding, Trade, identity } from '../domain/models';
import * as portfolio from '../domain/portfolio';
import { Native } from '../platform/native';
import { Accounts } from './Accounts';
import { AppState } from './AppState';
import { BrokerClients } from './BrokerClients';
import { Chat } from './Chat';
import { ExchangeRates } from './ExchangeRates';
import { Goals } from './Goals';
import { History } from './History';
import { Quotes } from './Quotes';
import { Sync } from './Sync';
import { UsMarketData } from './UsMarketData';

export { barKey, barMinutes } from '../domain/chart';
export type { ChartRange } from '../domain/chart';
export { sum } from '../domain/portfolio';
export type { Summary } from '../domain/portfolio';

/**
 * The app store: state plus one service per concern. Dependencies run one way:
 * Sync → Quotes → ExchangeRates → BrokerClients → AppState.
 */
export class Store extends AppState {
  readonly clients = new BrokerClients(this);
  readonly history = new History(this);
  readonly rates = new ExchangeRates(this, this.clients);
  readonly quotes = new Quotes(this, this.clients, this.rates, this.history);
  readonly sync = new Sync(
    this,
    this.clients,
    this.quotes,
    this.rates,
    this.history,
  );
  readonly accounts = new Accounts(this, this.quotes);
  readonly us = new UsMarketData(this);
  readonly chat = new Chat(this);
  readonly goals = new Goals(this);

  private priceTimer?: ReturnType<typeof setInterval>;
  private fxTimer?: ReturnType<typeof setInterval>;
  private bgTimer?: ReturnType<typeof setInterval>;

  constructor() {
    super();
    this.onSave = () => void this.quotes.reconcile();
    this.onSettingsChanged = patch => {
      if ('backgroundSyncMinutes' in patch) this.configureBackgroundSync();
      if ('hideAmounts' in patch || 'displayCurrency' in patch)
        this.history.writeWidget(true);
    };
  }

  // MARK: derived values

  account = (id: string) => portfolio.account(this, id);
  toKRW = (v: number, c: 'krw' | 'usd') => portfolio.toKRW(this, v, c);
  merged = (accountId?: string) => portfolio.merged(this, accountId);
  summary = (accountId?: string) => portfolio.summary(this, accountId);
  daySummary = (accountId?: string) => portfolio.daySummary(this, accountId);
  dayChange = (m: MergedHolding) => portfolio.dayChange(this, m);
  holdingCost = (m: MergedHolding) => portfolio.holdingCost(this, m);
  holdingPnl = (m: MergedHolding) => portfolio.holdingPnl(this, m);
  holdingReturn = (m: MergedHolding) => portfolio.holdingReturn(this, m);
  avgPriceText = (m: MergedHolding) => portfolio.avgPriceText(this, m);
  displayRate = (t: Trade) => portfolio.displayRate(this, t);
  tradeRate = (t: Trade) => portfolio.tradeRate(this, t);
  tradeAmount = (t: Trade, amount: number) =>
    portfolio.tradeAmount(this, t, amount);
  tradeSales = () => portfolio.tradeSales(this);
  saleProfits = (trades?: Trade[]) => portfolio.saleProfits(this, trades);
  realizedByAsset = () => portfolio.realizedByAsset(this);
  usTickers = () => portfolio.usTickers(this);

  // MARK: schedule

  start() {
    this.quotes.running = true;
    void this.quotes.reconcile();
    if (this.priceTimer) clearInterval(this.priceTimer);
    const n = new Set(
      this.data.holdings.map(h => identity(h.assetType, h.ticker)),
    ).size;
    const interval = n <= 50 ? 30_000 : n <= 100 ? 60_000 : 120_000;
    this.priceTimer = setInterval(() => {
      if (!this.isSyncing) this.quotes.refresh();
    }, interval);
    this.quotes.refresh();
    void this.rates.fillTradeDays();
    this.configureBackgroundSync();
    if (this.fxTimer) clearInterval(this.fxTimer);
    this.fxTimer = setInterval(() => {
      if (RNAppState.currentState === 'active') void this.rates.refresh();
    }, 60_000);

    // Timers don't run while the app is suspended (iOS) — catch up when it comes back.
    RNAppState.addEventListener('change', st => {
      if (st === 'active') {
        this.quotes.stop();
        this.quotes.running = true;
        void this.quotes.reconcile();
        void this.rates.refresh();
        this.catchUp();
      } else if (Platform.OS === 'ios') {
        this.quotes.running = false;
        this.quotes.stop();
      }
    });
    if (Platform.OS === 'ios') {
      new NativeEventEmitter(NativeModules.MFNative).addListener(
        'backgroundRefresh',
        () => this.backgroundRefresh(),
      );
      Native.backgroundReady();
    }
  }

  /** Some synced account is older than the background sync interval. */
  private syncDue() {
    const m = this.data.settings.backgroundSyncMinutes;
    return (
      m > 0 &&
      this.data.accounts.some(
        a =>
          a.broker !== 'manual' &&
          (!a.lastSyncDate || Date.now() - a.lastSyncDate >= m * 60_000),
      )
    );
  }

  private catchUp() {
    if (this.isSyncing) return;
    if (this.syncDue()) this.sync.all();
    else if (
      !this.lastPriceRefresh ||
      Date.now() - this.lastPriceRefresh > 30_000
    )
      this.quotes.refresh();
  }

  /** One iOS background refresh run (~30 s budget, timing chosen by iOS): a due sync. */
  private async backgroundRefresh() {
    let ok = true;
    try {
      if (this.syncDue()) await this.sync.all();
    } catch (e) {
      ok = false;
      console.warn('background refresh failed', e);
    }
    await this.flush();
    Native.backgroundDone(ok);
  }

  configureBackgroundSync() {
    if (this.bgTimer) clearInterval(this.bgTimer);
    const m = this.data.settings.backgroundSyncMinutes;
    if (m > 0)
      this.bgTimer = setInterval(() => {
        if (!this.isSyncing) this.sync.all();
      }, m * 60_000);
  }
}

export const store = new Store();

/** Re-renders the calling component on every change, live price ticks included. */
export function useStore() {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}

/** Like `useStore`, without re-rendering on live price ticks: for screens that show no live prices. */
export function useStoreData() {
  useSyncExternalStore(store.subscribeData, store.getDataVersion);
  return store;
}
