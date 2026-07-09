import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  Booking,
  CreateBookingPayload,
  Master,
  Service,
  statusLabel,
  statusMark,
} from '../api';
import { ScheduleGrid, formatDisplayDate, shiftDate, todayStr } from '../components/ScheduleGrid';

type AddDraft = {
  masterId: string;
  time: string;
} | null;

export function SchedulePage() {
  const [date, setDate] = useState(todayStr());
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [masters, setMasters] = useState<Master[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [addDraft, setAddDraft] = useState<AddDraft>(null);
  const [mobileMasterIndex, setMobileMasterIndex] = useState(0);
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const mobileMaster = masters[mobileMasterIndex];

  const refetchBookings = useCallback(async () => {
    const data = await api.get<Booking[]>(`/api/admin/bookings?date=${date}`);
    setBookings((prev) => {
      if (prev.length && data.length > prev.length) {
        const newest = data[data.length - 1];
        setToast(`Новий запис: ${newest.client_name}, ${newest.service_name}`);
      }
      return data;
    });
  }, [date]);

  useEffect(() => {
    async function loadBase() {
      setLoading(true);
      setError('');
      try {
        const [mastersData, servicesData] = await Promise.all([
          api.get<Master[]>('/api/admin/masters'),
          api.get<Service[]>('/api/admin/services'),
        ]);
        setMasters(mastersData);
        setServices(servicesData);
      } catch (err) {
        setError((err as { error?: string }).error ?? 'Не вдалось завантажити дані');
      } finally {
        setLoading(false);
      }
    }

    loadBase();
  }, []);

  useEffect(() => {
    refetchBookings().catch((err) =>
      setError((err as { error?: string }).error ?? 'Не вдалось завантажити записи')
    );
  }, [refetchBookings]);

  useEffect(() => {
    const id = window.setInterval(() => {
      refetchBookings().catch(console.error);
    }, 15000);
    return () => window.clearInterval(id);
  }, [refetchBookings]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(''), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  function openAdd(masterId: string, time: string) {
    setAddDraft({ masterId, time });
  }

  async function updateBooking(id: string, body: Partial<Pick<Booking, 'status' | 'notes'>>) {
    await api.patch<Booking>(`/api/admin/bookings/${id}`, body);
    await refetchBookings();
    const updated = await api.get<Booking[]>(`/api/admin/bookings?date=${date}`);
    setSelectedBooking(updated.find((b) => b.id === id) ?? null);
  }

  const currentMasterName = useMemo(() => mobileMaster?.name ?? 'Майстер', [mobileMaster]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Розклад</h1>
          <p className="text-sm text-gray-500">Сітка по майстрах і часу, як у iClinic</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="px-3 py-2 rounded-lg bg-white border" onClick={() => setDate(shiftDate(date, -1))}>
            ←
          </button>
          <button className="px-3 py-2 rounded-lg bg-white border font-medium min-w-36">
            {formatDisplayDate(date)}
          </button>
          <button className="px-3 py-2 rounded-lg bg-white border" onClick={() => setDate(shiftDate(date, 1))}>
            →
          </button>
          <button className="px-3 py-2 rounded-lg bg-blue-600 text-white" onClick={() => setDate(todayStr())}>
            Сьогодні
          </button>
          <button
            className="px-3 py-2 rounded-lg bg-green-600 text-white"
            onClick={() => openAdd(masters[0]?.id ?? '', '09:00')}
            disabled={!masters.length}
          >
            + Додати запис
          </button>
        </div>
      </div>

      {toast && <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-blue-800">{toast}</div>}
      {error && <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-red-800">{error}</div>}
      {loading && <div className="rounded-xl bg-white border p-3 text-gray-500">Завантаження...</div>}

      <div className="md:hidden flex items-center justify-between bg-white border rounded-xl p-3">
        <button
          onClick={() => setMobileMasterIndex((i) => Math.max(0, i - 1))}
          disabled={mobileMasterIndex === 0}
          className="px-3 py-2 rounded-lg border disabled:opacity-40"
        >
          ←
        </button>
        <div className="font-medium">{currentMasterName}</div>
        <button
          onClick={() => setMobileMasterIndex((i) => Math.min(masters.length - 1, i + 1))}
          disabled={mobileMasterIndex >= masters.length - 1}
          className="px-3 py-2 rounded-lg border disabled:opacity-40"
        >
          →
        </button>
      </div>

      <ScheduleGrid
        bookings={bookings}
        masters={masters}
        date={date}
        mobileMasterIndex={mobileMasterIndex}
        onBookingClick={setSelectedBooking}
        onAddClick={openAdd}
      />

      {selectedBooking && (
        <BookingModal
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
          onUpdate={(body) => updateBooking(selectedBooking.id, body)}
        />
      )}

      {addDraft && (
        <AddBookingModal
          draft={addDraft}
          date={date}
          masters={masters}
          services={services}
          onClose={() => setAddDraft(null)}
          onCreated={async () => {
            setAddDraft(null);
            await refetchBookings();
          }}
        />
      )}
    </div>
  );
}

function BookingModal({
  booking,
  onClose,
  onUpdate,
}: {
  booking: Booking;
  onClose: () => void;
  onUpdate: (body: Partial<Pick<Booking, 'status' | 'notes'>>) => Promise<void>;
}) {
  const [notes, setNotes] = useState(booking.notes ?? '');
  const [saving, setSaving] = useState(false);

  async function save(body: Partial<Pick<Booking, 'status' | 'notes'>>) {
    setSaving(true);
    try {
      await onUpdate(body);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Запис #${booking.id.slice(0, 8)}`} onClose={onClose}>
      <div className="space-y-3">
        <p>👤 {booking.client_name}</p>
        {booking.client_phone && <p>📞 {booking.client_phone}</p>}
        <p>
          ✂️ {booking.service_name} • {booking.duration_minutes} хв
        </p>
        <p>👨 Майстер: {booking.master_name}</p>
        <p>🕐 {new Date(booking.datetime).toLocaleString('uk-UA')}</p>
        {booking.service_price && <p>💰 {booking.service_price} ₴</p>}
        <p>
          Статус: {statusMark(booking.status)} {statusLabel(booking.status)}
        </p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Нотатка"
          className="w-full border rounded-lg p-3"
          rows={3}
        />
        <div className="flex flex-wrap gap-2">
          <button disabled={saving} onClick={() => save({ status: 'confirmed' })} className="px-3 py-2 rounded-lg bg-green-600 text-white">
            Підтвердити
          </button>
          <button disabled={saving} onClick={() => save({ status: 'cancelled' })} className="px-3 py-2 rounded-lg bg-red-600 text-white">
            Скасувати
          </button>
          <button disabled={saving} onClick={() => save({ status: 'completed' })} className="px-3 py-2 rounded-lg bg-gray-700 text-white">
            Завершити
          </button>
          <button disabled={saving} onClick={() => save({ notes })} className="px-3 py-2 rounded-lg bg-blue-600 text-white">
            Зберегти нотатку
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AddBookingModal({
  draft,
  date,
  masters,
  services,
  onClose,
  onCreated,
}: {
  draft: { masterId: string; time: string };
  date: string;
  masters: Master[];
  services: Service[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [masterId, setMasterId] = useState(draft.masterId);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [time, setTime] = useState(draft.time);
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');

    const body: CreateBookingPayload = {
      masterId,
      serviceId,
      clientName,
      clientPhone,
      datetime: `${date}T${time}:00`,
      notes,
    };

    try {
      await api.post<{ id: string }>('/api/admin/bookings', body);
      await onCreated();
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалось створити запис');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Новий запис" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-red-800 text-sm">{error}</div>}
        <label className="block">
          <span className="text-sm text-gray-600">Послуга *</span>
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="w-full border rounded-lg p-3 mt-1" required>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name_uk} • {s.duration_minutes} хв{s.price ? ` • ${s.price} ₴` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-gray-600">Майстер *</span>
          <select value={masterId} onChange={(e) => setMasterId(e.target.value)} className="w-full border rounded-lg p-3 mt-1" required>
            {masters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-gray-600">Ім'я клієнта *</span>
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} className="w-full border rounded-lg p-3 mt-1" required />
        </label>
        <label className="block">
          <span className="text-sm text-gray-600">Телефон</span>
          <input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} className="w-full border rounded-lg p-3 mt-1" />
        </label>
        <label className="block">
          <span className="text-sm text-gray-600">Дата і час *</span>
          <div className="flex gap-2 mt-1">
            <input value={date} disabled className="w-full border rounded-lg p-3 bg-gray-50" />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-36 border rounded-lg p-3" required />
          </div>
        </label>
        <label className="block">
          <span className="text-sm text-gray-600">Нотатка</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full border rounded-lg p-3 mt-1" rows={3} />
        </label>
        <button disabled={saving || !serviceId || !masterId} className="w-full py-3 rounded-lg bg-blue-600 text-white font-medium disabled:opacity-50">
          {saving ? 'Збереження...' : 'Зберегти'}
        </button>
      </form>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="bg-white w-full md:max-w-lg rounded-t-2xl md:rounded-2xl p-5 max-h-[90vh] overflow-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900">
            Закрити
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
