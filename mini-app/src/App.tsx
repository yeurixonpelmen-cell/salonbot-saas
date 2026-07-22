import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, SalonInfo, Service, Master } from './api';
import {
  Lang,
  detectLang,
  persistLang,
  translate,
  TranslationKey,
} from './i18n/translations';

type Step = 'services' | 'masters' | 'slots' | 'confirm' | 'success';

interface Selection {
  service: Service | null;
  master: Master | null;
  anyMaster: boolean;
  date: string;
  time: string;
}

const STEPS: Step[] = ['services', 'masters', 'slots', 'confirm'];

function getSalonId(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('salon') ?? '';
}

function formatDate(date: string, locale: string, options?: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale, options);
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function serviceName(service: Service, lang: Lang): string {
  return lang === 'uk' ? service.name_uk : (service.name_en ?? service.name_uk);
}

export default function App() {
  const salonId = getSalonId();
  const [lang, setLang] = useState<Lang>(() => detectLang());
  const [step, setStep] = useState<Step>('services');
  const [salon, setSalon] = useState<SalonInfo | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [masters, setMasters] = useState<Master[]>([]);
  const [slots, setSlots] = useState<Record<string, string[]>>({});
  const [selectedDate, setSelectedDate] = useState('');
  const [selection, setSelection] = useState<Selection>({
    service: null,
    master: null,
    anyMaster: false,
    date: '',
    time: '',
  });
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const t = useCallback((key: TranslationKey) => translate(lang, key), [lang]);
  const locale = lang === 'uk' ? 'uk-UA' : 'en-US';
  const initData = window.Telegram?.WebApp?.initData ?? '';
  const salonName = lang === 'uk' ? salon?.name_uk : (salon?.name_en ?? salon?.name_uk);
  const dates = useMemo(() => Object.keys(slots), [slots]);
  const canBook = Boolean(name.trim() && phone.trim() && selection.service && selection.date && selection.time);
  const stepIndex = STEPS.indexOf(step === 'success' ? 'confirm' : step);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      tg.setHeaderColor?.('#f3efe9');
      tg.setBackgroundColor?.('#f3efe9');
      const user = tg.initDataUnsafe.user;
      if (user?.first_name) setName(user.first_name);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    persistLang(lang);
  }, [lang]);

  useEffect(() => {
    if (!salonId) return;
    apiGet<SalonInfo>(`/api/salons/${salonId}`).then(setSalon).catch(console.error);
    apiGet<Service[]>(`/api/salons/${salonId}/services`).then(setServices).catch(console.error);
  }, [salonId]);

  const goBack = useCallback(() => {
    if (step === 'masters') setStep('services');
    else if (step === 'slots') setStep('masters');
    else if (step === 'confirm') setStep('slots');
  }, [step]);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    if (step === 'services' || step === 'success') {
      tg.BackButton.hide();
    } else {
      tg.BackButton.show();
      const handler = () => goBack();
      tg.BackButton.onClick(handler);
      return () => tg.BackButton.offClick(handler);
    }
  }, [step, goBack]);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    if (step === 'confirm') {
      if (tg.MainButton.setText) tg.MainButton.setText(t('book'));
      else tg.MainButton.text = t('book');
      if (canBook && !loading) tg.MainButton.enable?.();
      else tg.MainButton.disable?.();
      tg.MainButton.show();
      const handler = () => {
        void handleBook();
      };
      tg.MainButton.onClick(handler);
      return () => tg.MainButton.offClick(handler);
    }
    tg.MainButton.hide();
  }, [canBook, loading, step, name, phone, selection, t]);

  async function selectService(service: Service) {
    setLoading(true);
    setError('');
    setSelection((s) => ({ ...s, service }));
    try {
      const m = await apiGet<Master[]>(`/api/salons/${salonId}/masters?serviceId=${service.id}`);
      setMasters(m);
      setStep('masters');
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Error');
    } finally {
      setLoading(false);
    }
  }

  async function selectMaster(master: Master | null, anyMaster = false) {
    if (!selection.service) return;
    if (!initData) {
      setError(t('openInTelegram'));
      return;
    }

    setLoading(true);
    setError('');
    setSelection((s) => ({ ...s, master, anyMaster }));
    const masterParam = anyMaster ? '' : `&masterId=${master!.id}`;
    try {
      const data = await apiGet<Record<string, string[]>>(
        `/api/salons/${salonId}/slots?serviceId=${selection.service.id}${masterParam}`
      );
      setSlots(data);
      const nextDates = Object.keys(data);
      setSelectedDate(nextDates[0] ?? '');
      setStep('slots');
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Error');
    } finally {
      setLoading(false);
    }
  }

  function selectSlot(date: string, time: string) {
    setSelection((s) => ({ ...s, date, time }));
    setStep('confirm');
  }

  async function handleBook() {
    if (!canBook) {
      setError(t('requiredFields'));
      return;
    }
    if (!initData) {
      setError(t('openInTelegram'));
      return;
    }

    setLoading(true);
    setError('');

    const datetime = `${selection.date}T${selection.time}:00`;
    const tg = window.Telegram?.WebApp;

    try {
      tg?.MainButton.showProgress();
      tg?.MainButton.disable?.();
      await apiPost('/api/bookings', {
        salonId,
        masterId: selection.anyMaster ? null : selection.master?.id,
        serviceId: selection.service!.id,
        clientName: name.trim(),
        clientPhone: phone.trim(),
        datetime,
      });
      setStep('success');
    } catch (err: unknown) {
      const e = err as { error?: string };
      if (e.error?.includes('зайнятий') || e.error?.includes('taken')) {
        setError(t('slotTaken'));
        const masterParam = selection.anyMaster ? '' : `&masterId=${selection.master!.id}`;
        try {
          const data = await apiGet<Record<string, string[]>>(
            `/api/salons/${salonId}/slots?serviceId=${selection.service!.id}${masterParam}`
          );
          setSlots(data);
        } catch {
          setSlots({});
        }
        setStep('slots');
      } else {
        setError(e.error ?? 'Error');
      }
    } finally {
      tg?.MainButton.hideProgress();
      tg?.MainButton.enable?.();
      setLoading(false);
    }
  }

  if (!salonId) {
    return (
      <div className="app-shell">
        <div className="empty">{t('missingSalon')}</div>
      </div>
    );
  }

  const progressLabels = [t('stepService'), t('stepMaster'), t('stepTime'), t('stepConfirm')];

  return (
    <div className="app-shell">
      {step !== 'success' && (
        <>
          <header className="topbar">
            <div className="brand-block">
              <div className="eyebrow">{t('bookOnline')}</div>
              <h1 className="brand-title">{salonName || 'Salon'}</h1>
              {salon?.address && (
                <div className="address-row">
                  <span className="address-pin">📍</span>
                  <span>{salon.address}</span>
                </div>
              )}
            </div>
            <div className="lang-switch" role="group" aria-label="Language">
              <button
                type="button"
                className={lang === 'uk' ? 'active' : ''}
                onClick={() => setLang('uk')}
              >
                UA
              </button>
              <button
                type="button"
                className={lang === 'en' ? 'active' : ''}
                onClick={() => setLang('en')}
              >
                EN
              </button>
            </div>
          </header>

          <nav className="progress" aria-label="Progress">
            {progressLabels.map((label, index) => {
              const state = index < stepIndex ? 'done' : index === stepIndex ? 'current' : '';
              return (
                <div className={`progress-item ${state}`} key={label}>
                  <div className="progress-bar"><span /></div>
                  <div className="progress-label">{label}</div>
                </div>
              );
            })}
          </nav>
        </>
      )}

      {error && <div className="alert">{error}</div>}
      {loading && step !== 'confirm' && <div className="loading-banner">{t('loading')}</div>}

      {step === 'services' && (
        <section className="step-pane">
          <h2 className="section-title">{t('chooseService')}</h2>
          {!services.length && !loading && <div className="empty">{t('noServices')}</div>}
          <div className="stack">
            {services.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => void selectService(s)}
                disabled={loading}
                className="choice-card"
              >
                <div className="choice-top">
                  <div className="choice-name">{serviceName(s, lang)}</div>
                </div>
                <div className="choice-meta">
                  <span className="chip">{s.duration_minutes} {t('min')}</span>
                  {s.price != null && <span className="chip price">{s.price} {t('uah')}</span>}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 'masters' && (
        <section className="step-pane">
          <h2 className="section-title">{t('chooseMaster')}</h2>
          {!masters.length && !loading && <div className="empty">{t('noMasters')}</div>}
          <div className="stack">
            {masters.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => void selectMaster(m)}
                disabled={loading}
                className="choice-card master-card"
              >
                <div className="avatar">
                  {m.photo_url ? <img src={m.photo_url} alt="" /> : initials(m.name)}
                </div>
                <div>
                  <div className="master-name">{m.name}</div>
                  {m.position && <div className="master-role">{m.position}</div>}
                </div>
              </button>
            ))}
            <button
              type="button"
              onClick={() => void selectMaster(null, true)}
              disabled={loading}
              className="choice-card any-card"
            >
              <div className="choice-name">{t('anyMaster')}</div>
              <p className="hint" style={{ marginTop: 6 }}>{t('anyMasterHint')}</p>
            </button>
          </div>
        </section>
      )}

      {step === 'slots' && (
        <section className="step-pane">
          <h2 className="section-title">{t('chooseTime')}</h2>
          {!dates.length && !loading && <div className="empty">{t('noSlots')}</div>}
          <div className="date-row">
            {dates.map((date) => (
              <button
                key={date}
                type="button"
                onClick={() => setSelectedDate(date)}
                className={`date-chip ${selectedDate === date ? 'active' : ''}`}
              >
                <span className="dow">
                  {formatDate(date, locale, { weekday: 'short' })}
                </span>
                <span className="dom">
                  {formatDate(date, locale, { day: 'numeric', month: 'short' })}
                </span>
              </button>
            ))}
          </div>
          <div className="time-grid">
            {(slots[selectedDate] ?? []).map((time) => (
              <button
                key={time}
                type="button"
                onClick={() => selectSlot(selectedDate, time)}
                className="time-chip"
              >
                {time}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 'confirm' && selection.service && (
        <section className="step-pane">
          <h2 className="section-title">{t('yourBooking')}</h2>
          <div className="summary-card">
            <div className="summary-row">
              <span className="summary-label">{t('service')}</span>
              <span className="summary-value">{serviceName(selection.service, lang)}</span>
            </div>
            <div className="summary-row">
              <span className="summary-label">{t('specialist')}</span>
              <span className="summary-value">
                {selection.anyMaster ? t('anyMaster') : selection.master?.name}
              </span>
            </div>
            <div className="summary-row">
              <span className="summary-label">{t('when')}</span>
              <span className="summary-value">
                {formatDate(selection.date, locale, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'long',
                })}
                <br />
                {selection.time}–{addMinutes(selection.time, selection.service.duration_minutes)}
              </span>
            </div>
            <div className="summary-row">
              <span className="summary-label">{t('duration')}</span>
              <span className="summary-value">{selection.service.duration_minutes} {t('min')}</span>
            </div>
            {selection.service.price != null && (
              <div className="summary-row">
                <span className="summary-label">{t('price')}</span>
                <span className="summary-value">{selection.service.price} {t('uah')}</span>
              </div>
            )}
            {salon?.address && (
              <div className="summary-row">
                <span className="summary-label">{t('address')}</span>
                <span className="summary-value">{salon.address}</span>
              </div>
            )}
          </div>

          <label className="field">
            <span>{t('name')} *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className="field">
            <span>{t('phone')} *</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+380…"
              autoComplete="tel"
            />
          </label>

          <div className="actions">
            <button
              type="button"
              className="primary-btn"
              disabled={!canBook || loading}
              onClick={() => void handleBook()}
            >
              {loading ? t('loading') : t('book')}
            </button>
          </div>
        </section>
      )}

      {step === 'success' && (
        <section className="success-wrap step-pane">
          <div className="success-badge">✓</div>
          <h2>{t('success')}</h2>
          <p>{t('successHint')}</p>
          <div className="success-meta">
            {formatDate(selection.date, locale, { day: 'numeric', month: 'long' })} · {selection.time}
          </div>
          <p>{t('reminder')}</p>
          {salon?.address && (
            <div className="address-row" style={{ justifyContent: 'center', marginTop: 16 }}>
              <span className="address-pin">📍</span>
              <span>{salon.address}</span>
            </div>
          )}
          <div className="actions" style={{ marginTop: 24 }}>
            <button
              type="button"
              className="primary-btn"
              onClick={() => {
                setStep('services');
                setSelection({ service: null, master: null, anyMaster: false, date: '', time: '' });
              }}
            >
              {t('home')}
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => window.Telegram?.WebApp?.close()}
            >
              {t('myBookings')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
