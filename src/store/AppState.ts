import { AppData, defaultSettings } from '../domain/models';
import { PortfolioView } from '../domain/portfolio';
import { Native } from '../platform/native';
import { setDisplayCurrency } from '../utils';

export type FxSource =
  | 'exim-daily'
  | 'smbs-daily'
  | 'toss-mid'
  | 'yahoo'
  | 'saved'
  | 'default';

const emptyData = (): AppData => ({
  accounts: [],
  holdings: [],
  trades: [],
  snapshots: [],
  chat: [],
  settings: { ...defaultSettings },
});

/** App-wide state, change notification and persistence. Mutate fields, then call `emit()` or `save()`. */
export class AppState implements PortfolioView {
  data: AppData = emptyData();
  prices: Record<string, number> = {};
  /** Base price per identityKey (native currency), for today's change. */
  prevClose: Record<string, number> = {};
  usdKrw = 1400;
  fxSource: FxSource = 'default';
  fxUpdatedAt = 0;
  fxBaseDate = '';
  fxNotice = '';
  fxError = false;
  fxErrorMessage = '';
  isSyncing = false;
  syncStatus = '';
  lastSyncMessage = '';
  /** The last sync message reports a failure (shown in red). */
  lastSyncFailed = false;
  lastPriceRefresh?: number;
  loaded = false;

  /** Runs on every save: quote subscriptions follow the holdings. */
  onSave?: () => void;
  /** Runs after `updateSettings`, with the changed fields. */
  onSettingsChanged?: (patch: Partial<AppData['settings']>) => void;

  private version = 0;
  private priceVersion = 0;
  private listeners = new Set<() => void>();
  private priceListeners = new Set<() => void>();
  private saveTimer?: ReturnType<typeof setTimeout>;

  /** Any change, live price ticks included. */
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    this.priceListeners.add(l);
    return () => {
      this.listeners.delete(l);
      this.priceListeners.delete(l);
    };
  };
  /** Changes other than live price ticks, for screens that show no live prices. */
  subscribeData = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getVersion = () => this.version + this.priceVersion;
  getDataVersion = () => this.version;

  emit() {
    this.version++;
    this.listeners.forEach(l => l());
  }

  /** A live price tick: re-renders only subscribers of `subscribe`. */
  emitPrices() {
    this.priceVersion++;
    this.priceListeners.forEach(l => l());
  }

  setStatus(s: string) {
    this.syncStatus = s;
    this.emit();
  }

  async load() {
    try {
      const s = await Native.readData();
      if (s) {
        const d = JSON.parse(s);
        // Left over from the removed filing alerts.
        delete d.seenFilings;
        delete d.settings?.filingAlerts;
        delete d.settings?.alertForms;
        this.data = {
          ...emptyData(),
          ...d,
          settings: { ...defaultSettings, ...(d.settings ?? {}) },
        };
        // Earlier versions dropped partially filled canceled/replaced Toss orders. Re-read the full range once on the
        // next sync; known orders are deduplicated by order id, so only the missing fills are added.
        if (!this.data.tossPartialFillsResynced) {
          for (const a of this.data.accounts)
            if (a.broker === 'toss') a.oldestSyncedTradeDate = undefined;
          this.data.tossPartialFillsResynced = true;
        }
        if (Number.isFinite(d.usdKrw) && d.usdKrw > 0) {
          this.usdKrw = d.usdKrw;
          this.fxSource = [
            'exim-daily',
            'smbs-daily',
            'toss-mid',
            'yahoo',
          ].includes(d.fxSource)
            ? d.fxSource
            : 'saved';
          this.fxUpdatedAt = Number.isFinite(d.fxUpdatedAt) ? d.fxUpdatedAt : 0;
          this.fxBaseDate = /^\d{4}-\d{2}-\d{2}$/.test(d.fxBaseDate)
            ? d.fxBaseDate
            : '';
        }
        setDisplayCurrency(this.data.settings.displayCurrency, this.usdKrw);
      }
    } catch (e) {
      console.warn('load failed', e);
    }
    this.loaded = true;
    this.emit();
  }

  save() {
    this.onSave?.();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.write();
    }, 300);
    this.emit();
  }

  /** Write now (background runs: the app may be suspended before the debounced save fires). */
  async flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    await this.write();
  }

  write() {
    return Native.writeData(
      JSON.stringify({
        ...this.data,
        usdKrw: this.usdKrw,
        fxSource: this.fxSource,
        fxUpdatedAt: this.fxUpdatedAt,
        fxBaseDate: this.fxBaseDate,
      }),
    ).catch(e => console.warn('save failed', e));
  }

  updateSettings(patch: Partial<AppData['settings']>) {
    this.data.settings = { ...this.data.settings, ...patch };
    if ('displayCurrency' in patch)
      setDisplayCurrency(this.data.settings.displayCurrency, this.usdKrw);
    this.save();
    this.onSettingsChanged?.(patch);
  }
}
