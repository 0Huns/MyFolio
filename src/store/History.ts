import { Platform } from 'react-native';
import { packBubbles } from '../domain/bubbles';
import { Snapshot, mh } from '../domain/models';
import {
  dayChange,
  daySummary,
  holdingPnl,
  holdingReturn,
  merged,
  sum,
  summary,
  toKRW,
} from '../domain/portfolio';
import { Native } from '../platform/native';
import { startOfDayKST } from '../utils';
import { AppState } from './AppState';

/** Daily snapshots (for the widget and AI reports) and the macOS widget file. */
export class History {
  private widgetAt = 0;

  constructor(private state: AppState) {}

  /** macOS desktop widget: total, P&L, today's change, top holdings and recent totals (at most once a minute). */
  writeWidget(force = false) {
    if (
      Platform.OS !== 'macos' ||
      (!force && Date.now() - this.widgetAt < 60_000)
    )
      return;
    this.widgetAt = Date.now();
    const s = summary(this.state);
    const day = daySummary(this.state);
    const holdings = merged(this.state)
      .map(m => ({ m, value: toKRW(this.state, mh.value(m), mh.currency(m)) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
      .map(({ m, value }) => ({
        name: m.name,
        ticker: m.ticker,
        value,
        price: m.price,
        currency: mh.currency(m),
        dayRate: dayChange(this.state, m)?.rate ?? null,
        ret: holdingReturn(this.state, m),
        quantity: m.quantity,
        crypto: m.assetType === 'crypto',
        pnl: holdingPnl(this.state, m),
      }));
    // Laid out here so the widget only draws: size of the large widget's bubble area, in points.
    const cash = s.cash > 0 ? [{ key: 'cash', value: s.cash }] : [];
    const bubbles = packBubbles(
      [...holdings.map(h => ({ key: h.ticker, value: h.value })), ...cash],
      328,
      190,
    ).map(b => {
      const h = holdings.find(x => x.ticker === b.key);
      return { ...b, label: h?.name ?? '현금', rate: h?.dayRate ?? null };
    });
    Native.writeWidget(
      JSON.stringify({
        updatedAt: Date.now(),
        hidden: this.state.data.settings.hideAmounts,
        usdKrw:
          this.state.data.settings.displayCurrency === 'usd'
            ? this.state.usdKrw
            : null, // widget shows dollars when set
        total: sum.total(s),
        invested: s.value,
        pnl: sum.pnl(s),
        pnlRate: sum.ret(s),
        day: day?.amount ?? null,
        dayRate: day?.rate ?? null,
        cash: s.cash,
        holdings,
        bubbles,
        history: this.state.data.snapshots
          .slice(-30)
          .map(x => x.totalValue + x.cash),
      }),
    ).catch(() => {});
  }

  record() {
    this.writeWidget();
    if (
      !this.state.data.holdings.length &&
      !this.state.data.accounts.some(a => a.cashKRW > 0 || (a.cashUSD ?? 0) > 0)
    ) {
      this.state.emit();
      return;
    }
    const s = summary(this.state);
    if (!Number.isFinite(s.cost)) {
      this.state.emit();
      return;
    }
    const snap: Snapshot = {
      date: startOfDayKST(Date.now()),
      totalValue: s.value,
      stockValue: s.stock,
      cryptoValue: s.crypto,
      cost: s.cost,
      cash: s.cash,
    };
    this.state.data.snapshots = this.state.data.snapshots
      .filter(x => x.date !== snap.date)
      .concat(snap)
      .sort((a, b) => a.date - b.date);
    this.state.save();
  }
}
