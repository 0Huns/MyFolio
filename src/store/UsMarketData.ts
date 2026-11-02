import {
  companyName,
  filings,
  sharesOutstanding,
  shortInterest,
  shortVolume,
} from '../api/sec';
import { Filing, ShortInterest, ShortVolume } from '../domain/models';
import { AppState } from './AppState';

/** SEC/FINRA data for the US screens. */
export class UsMarketData {
  constructor(private state: AppState) {}

  cache = new Map<string, { at: number; value: Promise<unknown> }>();

  /** SEC/FINRA data changes slowly: reuse a result for 5 minutes, share in-flight requests, never keep failures. */
  cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value as Promise<T>;
    const value = load();
    this.cache.set(key, { at: Date.now(), value });
    value.catch(() => {
      if (this.cache.get(key)?.value === value) this.cache.delete(key);
    });
    return value;
  }

  companyName = (ticker: string) => {
    const contact = this.state.data.settings.secContact;
    return this.cached<string | null>(`name:${contact}:${ticker}`, () =>
      companyName(ticker, contact),
    );
  };

  filings = (ticker: string, limit = 60) => {
    const contact = this.state.data.settings.secContact;
    return this.cached<Filing[]>(`filings:${contact}:${ticker}:${limit}`, () =>
      filings(ticker, contact, limit),
    );
  };

  sharesOutstanding = (ticker: string) => {
    const contact = this.state.data.settings.secContact;
    return this.cached<number | null>(`shares:${contact}:${ticker}`, () =>
      sharesOutstanding(ticker, contact),
    );
  };

  shortInterest = (ticker: string) =>
    this.cached<ShortInterest[]>(`si:${ticker}`, () => shortInterest(ticker));

  shortVolumes = (tickers: string[], days = 10) =>
    this.cached<Record<string, ShortVolume[]>>(
      `volume:${days}:${tickers.join(',')}`,
      () => shortVolume(tickers, days),
    );
}
