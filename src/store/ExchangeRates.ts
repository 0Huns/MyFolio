import { EximAuthError, fetchEximFixing } from '../api/exim';
import { Prices } from '../api/prices';
import { fxDay, usTradeDay } from '../domain/marketTime';
import { EXIM_KEY, Keychain } from '../platform/native';
import { AppError, DAY, Fmt, setDisplayCurrency } from '../utils';
import { AppState } from './AppState';
import { BrokerClients } from './BrokerClients';

/** Today's USD/KRW rate and the per-day fixings used for trades and history. */
export class ExchangeRates {
  checkedAt = 0;
  eximCheckedAt = 0;
  private eximVerifyKey = false;
  private eximAuthFailed = false;
  private refreshing?: Promise<void>;
  private fillRun?: Promise<void>;

  constructor(private state: AppState, private clients: BrokerClients) {}

  get label() {
    const source =
      this.state.fxSource === 'exim-daily'
        ? `수출입은행 제공 서울외국환중개 기준환율 · ${
            this.state.fxBaseDate
          } 기준${
            this.state.fxBaseDate < fxDay(Date.now()) ? ' · 이전 영업일 값' : ''
          }`
        : this.state.fxSource === 'smbs-daily'
        ? '서울외국환중개 일별 기준환율'
        : this.state.fxSource === 'toss-mid'
        ? '토스 Open API 참고환율 · 토스 화면 기준환율과 다를 수 있음'
        : this.state.fxSource === 'yahoo'
        ? 'Yahoo 환율'
        : this.state.fxSource === 'saved'
        ? '이전 저장 환율'
        : '임시 환율';
    const time = this.state.fxUpdatedAt
      ? ` · ${Fmt.dateTime(this.state.fxUpdatedAt)} 조회`
      : '';
    return `1 USD = ${this.state.usdKrw.toLocaleString('en-US', {
      maximumFractionDigits: 4,
    })}원 · ${source}${time}${
      this.state.fxNotice ? ` · ${this.state.fxNotice}` : ''
    }${
      this.state.fxError
        ? ` · 기준환율 갱신 실패: ${
            this.state.fxErrorMessage || '원인 미확인'
          } · 이전 값 사용`
        : ''
    }`;
  }

  async saveKey(key: string) {
    if (this.refreshing) await this.refreshing;
    const ok = key.trim()
      ? await Keychain.set(EXIM_KEY, key.trim())
      : await Keychain.delete(EXIM_KEY);
    if (!ok) throw new Error('인증키 저장에 실패했습니다');
    this.checkedAt = 0;
    this.eximCheckedAt = 0;
    this.eximVerifyKey = !!key.trim();
    this.eximAuthFailed = false;
    this.state.fxNotice = '';
    await this.refresh();
    void this.fillTradeDays();
  }

  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    if (this.checkedAt && Date.now() - this.checkedAt < 60_000)
      return Promise.resolve();
    this.checkedAt = Date.now();
    const task = (async () => {
      try {
        const key = await Keychain.get(EXIM_KEY);
        let rate: number | null = null;
        let source = this.state.fxSource;
        let baseDate = this.state.fxBaseDate;
        if (key) {
          // Retry the daily provider every 30 minutes; fallback quotes still refresh every minute.
          // Toss switches to the new fixing at 08:40 KST, but EXIM publishes it only around 11:00,
          // so poll every 5 minutes while the stored fixing is from a previous day.
          const kstNow = new Date(Date.now() + 9 * 3600000);
          const stale =
            this.state.fxSource === 'exim-daily' &&
            this.state.fxBaseDate < fxDay(Date.now()) &&
            kstNow.getUTCHours() * 60 + kstNow.getUTCMinutes() >= 8 * 60 + 40;
          const due =
            !this.eximCheckedAt ||
            Date.now() - this.eximCheckedAt >= (stale ? 5 : 30) * 60_000;
          if (!due && !this.eximAuthFailed) return;
          if (due) {
            this.eximCheckedAt = Date.now();
            const cached =
              !this.eximVerifyKey &&
              this.state.fxSource === 'exim-daily' &&
              this.state.fxBaseDate
                ? { date: this.state.fxBaseDate, rate: this.state.usdKrw }
                : undefined;
            try {
              const fixing = await fetchEximFixing(key, cached);
              this.eximVerifyKey = false;
              this.eximAuthFailed = false;
              this.state.fxNotice = '';
              rate = fixing.rate;
              source = 'exim-daily';
              baseDate = fixing.date;
            } catch (error) {
              if (!(error instanceof EximAuthError)) throw error;
              this.eximAuthFailed = true;
              this.state.fxNotice = '수출입은행 인증 오류 · 대체 환율 사용';
            }
          }
        } else {
          this.eximAuthFailed = false;
          this.state.fxNotice = '';
        }
        if (!key || this.eximAuthFailed) {
          const configured = this.state.data.accounts.some(
            a => a.broker === 'toss',
          );
          const toss = configured ? await this.clients.toss() : null;
          rate = toss ? await toss.usdKrw() : await Prices.usdKrw();
          source = toss ? 'toss-mid' : 'yahoo';
          baseDate = '';
        }
        if (!(typeof rate === 'number' && rate > 0 && Number.isFinite(rate)))
          throw new AppError('환율 조회 실패');
        this.state.usdKrw = rate;
        this.state.fxSource = source;
        this.state.fxBaseDate = baseDate;
        this.state.fxUpdatedAt = Date.now();
        this.state.fxError = false;
        this.state.fxErrorMessage = '';
        setDisplayCurrency(this.state.data.settings.displayCurrency, rate);
        await this.state.write();
      } catch (error) {
        // Preserve the source/date of the last successful value; expose the public FX error.
        this.state.fxError = true;
        this.state.fxErrorMessage =
          error instanceof Error
            ? error.message
            : '네트워크 연결을 확인해주세요';
      }
      this.state.emit();
    })();
    this.refreshing = task;
    void task.finally(() => {
      this.refreshing = undefined;
    });
    return task;
  }

  /**
   * Fill `dailyFx` with the Seoul Money Brokerage fixing (via EXIM) for each US trading day that lacks one, then for
   * every weekday since the first trade (history chart). Holidays resolve to the previous business day, as Toss does.
   * Bounded per run for EXIM's daily quota; today is filled only once its own fixing is known.
   */
  fillTradeDays(): Promise<void> {
    this.fillRun ??= (async () => {
      try {
        const key = await Keychain.get(EXIM_KEY);
        if (!key) return;
        const fx = (this.state.data.dailyFx ??= {});
        const today = fxDay(Date.now());
        const us = this.state.data.trades.filter(t => t.market === 'us');
        const wanted = new Set(us.map(t => usTradeDay(t.date)));
        // Every weekday since the first trade, for the history chart (holidays resolve to the previous fixing).
        if (this.state.data.trades.length) {
          for (
            let at = Math.min(...this.state.data.trades.map(t => t.date));
            fxDay(at) < today;
            at += DAY
          ) {
            const wd = new Date(`${fxDay(at)}T00:00:00Z`).getUTCDay();
            if (wd !== 0 && wd !== 6) wanted.add(fxDay(at));
          }
        }
        // Trade days first: they determine principal and P&L; chart-only days follow.
        const tradeDays = new Set(us.map(t => usTradeDay(t.date)));
        const days = [...wanted]
          .filter(d => !(fx[d] > 0))
          .sort(
            (a, b) =>
              Number(tradeDays.has(b)) - Number(tradeDays.has(a)) ||
              b.localeCompare(a),
          );
        let added = 0;
        for (const day of days.slice(0, 100)) {
          if (day >= today) {
            if (
              day === today &&
              this.state.fxSource === 'exim-daily' &&
              this.state.fxBaseDate === today
            ) {
              fx[day] = this.state.usdKrw;
              added++;
            }
            continue;
          }
          // Quota, auth or network failures stop this run; missing days are retried next time.
          const fixing = await fetchEximFixing(
            key,
            undefined,
            Date.parse(`${day}T12:00:00+09:00`),
          );
          fx[day] = fixing.rate;
          added++;
        }
        if (added) this.state.save();
      } catch (e) {
        console.log('trade fx fill stopped', e);
      }
    })().finally(() => {
      this.fillRun = undefined;
    });
    return this.fillRun;
  }
}
