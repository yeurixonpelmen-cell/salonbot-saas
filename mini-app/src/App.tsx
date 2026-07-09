import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, SalonInfo, Service, Master } from './api';
import { t, getLang } from './i18n/translations';

type Step = 'services' | 'masters' | 'slots' | 'confirm' | 'success';

interface Selection {
  service: Service | null;
  master: Master | null;
  anyMaster: boolean;
  date: string;
  time: string;
}

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

export default function App() {
  const salonId = getSalonId();
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

  const lang = getLang();
  const locale = lang === 'uk' ? 'uk-UA' : 'en-US';
  const initData = window.Telegram?.WebApp?.initData ?? '';
  const salonName = lang === 'uk' ? salon?.name_uk : (salon?.name_en ?? salon?.name_uk);
  const dates = useMemo(() => Object.keys(slots), [slots]);
  const canBook = Boolean(name.trim() && phone.trim() && selection.service && selection.date && selection.time);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      const user = tg.initDataUnsafe.user;
      if (user?.first_name) setName(user.first_name);
    }
  }, []);

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
      tg.MainButton.setText?.(t('book'));
      if (!tg.MainButton.setText) tg.MainButton.text = t('book');
      if (canBook && !loading) tg.MainButton.enable?.();
      else tg.MainButton.disable?.();
      tg.MainButton.show();
      const handler = () => handleBook();
      tg.MainButton.onClick(handler);
      return () => tg.MainButton.offClick(handler);
    } else {
      tg.MainButton.hide();
    }
  }, [canBook, loading, step, name, phone, selection]);

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
    return <div className="p-4">Salon ID missing</div>;
  }

  return (
    <div className="p-4 max-w-md mx-auto slide-in">
      {step !== 'success' && salon && (
        <header className="mb-6">
          <h1 className="text-xl font-bold">{salonName}</h1>
          {salon.address && <p className="text-sm opacity-70">{salon.address}</p>}
        </header>
      )}

      {error && <div className="mb-4 p-3 rounded-lg bg-red-100 text-red-800 text-sm">{error}</div>}
      {loading && step !== 'confirm' && (
        <div className="mb-4 p-3 rounded-lg card text-sm opacity-80">{t('loading')}</div>
      )}

      {step === 'services' && (
        <div>
          <h2 className="text-lg font-semibold mb-4">{t('chooseService')}</h2>
          {!services.length && !loading && <p className="opacity-70">{t('noServices')}</p>}
          <div className="space-y-3">
            {services.map((s) => (
              <button
                key={s.id}
                onClick={() => selectService(s)}
                disabled={loading}
                className="card w-full p-4 text-left active:opacity-80"
              >
                <div className="font-medium">
                  {lang === 'uk' ? s.name_uk : (s.name_en ?? s.name_uk)}
                </div>
                <div className="text-sm opacity-70 mt-1">
                  {s.duration_minutes} {t('min')}
                  {s.price ? ` • ${s.price} ₴` : ''}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 'masters' && (
        <div>
          <h2 className="text-lg font-semibold mb-4">{t('chooseMaster')}</h2>
          {!masters.length && !loading && <p className="opacity-70">{t('noMasters')}</p>}
          <div className="space-y-3">
            {masters.map((m) => (
              <button
                key={m.id}
                onClick={() => selectMaster(m)}
                disabled={loading}
                className="card w-full p-4 text-left flex items-center gap-3 active:opacity-80"
              >
                {m.photo_url ? (
                  <img src={m.photo_url} alt="" className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gray-300 flex items-center justify-center text-lg">
                    👤
                  </div>
                )}
                <div>
                  <div className="font-medium">{m.name}</div>
                  {m.position && <div className="text-sm opacity-70">{m.position}</div>}
                </div>
              </button>
            ))}
            <button
              onClick={() => selectMaster(null, true)}
              disabled={loading}
              className="card w-full p-4 text-left active:opacity-80"
            >
              {t('anyMaster')}
            </button>
          </div>
        </div>
      )}

      {step === 'slots' && (
        <div>
          <h2 className="text-lg font-semibold mb-4">{t('chooseTime')}</h2>
          {!dates.length && !loading && <p className="opacity-70">{t('noSlots')}</p>}
          <div className="flex gap-2 overflow-x-auto pb-3 mb-4">
            {dates.map((date) => (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={`slot-btn whitespace-nowrap ${selectedDate === date ? 'selected' : ''}`}
              >
                {formatDate(date, locale, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                })}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {(slots[selectedDate] ?? []).map((time) => (
              <button key={time} onClick={() => selectSlot(selectedDate, time)} className="slot-btn">
                {time}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 'confirm' && selection.service && (
        <div>
          <h2 className="text-lg font-semibold mb-4">{t('yourBooking')}</h2>
          <div className="card p-4 space-y-3 mb-6">
            <div>
              ✂️ {lang === 'uk' ? selection.service.name_uk : (selection.service.name_en ?? selection.service.name_uk)}
              <div className="text-sm opacity-70">{selection.service.duration_minutes} {t('min')}</div>
            </div>
            {selection.master && <div>👤 {selection.master.name}</div>}
            {selection.anyMaster && <div>👤 {t('anyMaster')}</div>}
            <div>
              📅 {formatDate(selection.date, locale, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </div>
            <div>
              🕐 {selection.time} — {addMinutes(selection.time, selection.service.duration_minutes)}
            </div>
            {selection.service.price && <div>💰 {selection.service.price} ₴</div>}
          </div>
          <label className="block mb-3">
            <span className="text-sm">{t('name')} *</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full mt-1 p-3 rounded-lg border border-gray-200 bg-transparent"
            />
          </label>
          <label className="block mb-3">
            <span className="text-sm">{t('phone')} *</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+380..."
              className="w-full mt-1 p-3 rounded-lg border border-gray-200 bg-transparent"
            />
          </label>
          {loading && <p className="text-center opacity-70">{t('loading')}</p>}
        </div>
      )}

      {step === 'success' && (
        <div className="text-center py-12">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-xl font-bold mb-2">{t('success')}</h2>
          <p className="opacity-70 mb-2">
            {formatDate(selection.date, locale)} •{' '}
            {selection.time}
          </p>
          <p className="text-sm opacity-60 mb-8">{t('reminder')}</p>
          <button
            onClick={() => window.Telegram?.WebApp?.close()}
            className="card px-6 py-3 rounded-xl font-medium mr-2"
          >
            {t('myBookings')}
          </button>
          <button
            onClick={() => {
              setStep('services');
              setSelection({ service: null, master: null, anyMaster: false, date: '', time: '' });
            }}
            className="btn-primary px-6 py-3 rounded-xl font-medium"
          >
            {t('home')}
          </button>
        </div>
      )}
    </div>
  );
}
