import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, getApiUrl, getToken, Booking, BookingStatus, Client, CreateBookingPayload, Master, Room, SalonSettings, Service,
  UpdateBookingPayload, VisitStatus, GRID_END_HOUR, GRID_START_HOUR, GRID_SLOT_OPTIONS, SCHEDULE_SLOT_STORAGE_KEY,
  normalizeGridSlotMinutes, statusLabel, visitStatusLabel, type GridSlotMinutes,
} from '../api';
import {
  ScheduleGrid,
  ScheduleViewMode,
  formatDisplayDate,
  shiftDate,
  type ScheduleAddDraft,
} from '../components/ScheduleGrid';
import { Button, Drawer, Input, Modal } from '../components/ui';
import { useLocale } from '../context/LocaleContext';
import {
  DEFAULT_SALON_TIMEZONE,
  toDateTimeLocalValue,
  todayInTimeZone,
} from '../utils/datetime';

type AddDraft = ScheduleAddDraft | null;
const VISIT_STATUSES: VisitStatus[] = ['scheduled', 'first_visit', 'waiting', 'in_progress', 'refused', 'completed'];
const BOOKING_STATUSES: BookingStatus[] = ['pending', 'confirmed', 'cancelled', 'completed'];

export function SchedulePage() {
  const { t } = useLocale();
  const [timeZone, setTimeZone] = useState(DEFAULT_SALON_TIMEZONE);
  const [date, setDate] = useState(() => todayInTimeZone(DEFAULT_SALON_TIMEZONE));
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [masters, setMasters] = useState<Master[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [viewMode, setViewMode] = useState<ScheduleViewMode>('master');
  const [slotMinutes, setSlotMinutes] = useState<GridSlotMinutes>(() => {
    try {
      return normalizeGridSlotMinutes(localStorage.getItem(SCHEDULE_SLOT_STORAGE_KEY));
    } catch {
      return 30;
    }
  });
  const [selected, setSelected] = useState<Booking | null>(null);
  const [addDraft, setAddDraft] = useState<AddDraft>(null);
  const [mobileColumnIndex, setMobileColumnIndex] = useState(0);
  const [visitFilter, setVisitFilter] = useState<VisitStatus | 'all'>('all');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [savingRoom, setSavingRoom] = useState(false);

  const activeRooms = useMemo(() => rooms.filter((room) => room.is_active), [rooms]);
  const mobileColumns = viewMode === 'room' ? activeRooms : masters;
  const mobileLabel =
    viewMode === 'room'
      ? activeRooms[mobileColumnIndex]?.name ?? 'Кабінет'
      : masters[mobileColumnIndex]?.name ?? 'Спеціаліст';

  const refetch = useCallback(async () => {
    const data = await api.get<Booking[]>(`/api/admin/bookings?date=${encodeURIComponent(date)}`);
    setBookings(data);
    setSelected((current) => current ? data.find((item) => item.id === current.id) ?? current : null);
  }, [date]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<Master[]>('/api/admin/masters'),
      api.get<Service[]>('/api/admin/services'),
      api.get<SalonSettings>('/api/admin/salon'),
      api.get<Room[]>('/api/admin/rooms').catch(() => [] as Room[]),
    ]).then(([masterData, serviceData, salon, roomData]) => {
      setMasters(masterData);
      setServices(serviceData);
      setRooms(roomData);
      const tz = salon.timezone?.trim() || DEFAULT_SALON_TIMEZONE;
      setTimeZone(tz);
      setDate((current) => current || todayInTimeZone(tz));
    }).catch((err: { error?: string }) => setError(err.error ?? 'Не вдалося завантажити дані'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refetch().catch((err: { error?: string }) => setError(err.error ?? 'Не вдалося завантажити записи'));
  }, [refetch]);

  useEffect(() => {
    setMobileColumnIndex(0);
  }, [viewMode]);

  async function reloadRooms() {
    try {
      setRooms(await api.get<Room[]>('/api/admin/rooms'));
    } catch {
      /* ignore */
    }
  }

  async function createRoom(event: FormEvent) {
    event.preventDefault();
    const name = newRoomName.trim();
    if (!name) return;
    setSavingRoom(true);
    setError('');
    try {
      await api.post<Room>('/api/admin/rooms', { name, sort_order: activeRooms.length, is_active: true });
      setNewRoomName('');
      setRoomModalOpen(false);
      await reloadRooms();
      setViewMode('room');
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалося створити кабінет');
    } finally {
      setSavingRoom(false);
    }
  }

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    let es: EventSource | null = null;
    let debounceTimer = 0;
    let reconnectTimer = 0;
    let closed = false;

    const scheduleRefetch = () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        refetch().catch(console.error);
      }, 120);
    };

    const connect = () => {
      if (closed) return;
      const url = `${getApiUrl()}/api/admin/bookings/stream?token=${encodeURIComponent(token)}`;
      es = new EventSource(url);
      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { type?: string };
          if (payload.type === 'bookings_changed') scheduleRefetch();
        } catch {
          /* ignore malformed ping/payload */
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (closed) return;
        window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(connect, 2000);
      };
    };

    connect();

    const fallback = window.setInterval(() => refetch().catch(console.error), 60000);

    return () => {
      closed = true;
      window.clearTimeout(debounceTimer);
      window.clearTimeout(reconnectTimer);
      window.clearInterval(fallback);
      es?.close();
    };
  }, [refetch]);

  const filteredBookings = useMemo(() => bookings.filter((booking) => {
    if (visitFilter !== 'all' && booking.visit_status !== visitFilter) return false;
    if (attentionOnly && !booking.needs_attention && !booking.has_conflict) return false;
    return true;
  }), [bookings, visitFilter, attentionOnly]);

  function applyBooking(updated: Booking) {
    setBookings((current) => {
      const index = current.findIndex((item) => item.id === updated.id);
      if (index === -1) return current;
      const prev = current[index];
      const next = [...current];
      next[index] = {
        ...prev,
        ...updated,
        has_conflict: prev.has_conflict,
        files_count: updated.files_count || prev.files_count,
        master_name: updated.master_name ?? prev.master_name,
        service_name: updated.service_name ?? prev.service_name,
        service_price: updated.service_price ?? prev.service_price,
        duration_minutes: updated.duration_minutes ?? prev.duration_minutes,
        room_id: updated.room_id !== undefined ? updated.room_id : prev.room_id,
        room_name: updated.room_name ?? prev.room_name,
      };
      return next;
    });
  }

  async function updateBooking(id: string, payload: UpdateBookingPayload) {
    const updated = await api.patch<Booking>(`/api/admin/bookings/${id}`, payload);
    applyBooking(updated);
    void refetch().catch(console.error);
  }

  return (
    <div className="page-stack">
      <header className="schedule-page-header">
        <div>
          <span className="eyebrow">{t('schedule_eyebrow')}</span>
          <h1>{t('schedule_title')}</h1>
          <p>{formatDisplayDate(date)} · {bookings.length} записів</p>
        </div>
        <Button
          onClick={() => {
            const firstMaster = masters[0];
            setAddDraft({
              masterId: firstMaster?.id ?? '',
              roomId:
                viewMode === 'room'
                  ? activeRooms[0]?.id ?? null
                  : firstMaster?.default_room_id ?? null,
              time: '09:00',
            });
          }}
          disabled={!masters.length}
        >
          + Новий запис
        </Button>
      </header>

      <section className="schedule-toolbar">
        <div className="date-controls">
          <Button variant="secondary" onClick={() => setDate(shiftDate(date, -1))}>←</Button>
          <Input aria-label="Дата" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <Button variant="secondary" onClick={() => setDate(shiftDate(date, 1))}>→</Button>
          <Button variant="ghost" onClick={() => setDate(todayInTimeZone(timeZone))}>Сьогодні</Button>
        </div>
        <div className="schedule-filters">
          <div className="view-toggle" role="group" aria-label="Вид розкладу">
            <button
              type="button"
              className={viewMode === 'master' ? 'active' : ''}
              onClick={() => setViewMode('master')}
            >
              Лікарі
            </button>
            <button
              type="button"
              className={viewMode === 'room' ? 'active' : ''}
              onClick={() => setViewMode('room')}
            >
              Кабінети
            </button>
          </div>
          <label className="slot-step-control">
            <span>Сітка</span>
            <select
              className="ui-input"
              value={slotMinutes}
              onChange={(event) => {
                const next = normalizeGridSlotMinutes(event.target.value);
                setSlotMinutes(next);
                try {
                  localStorage.setItem(SCHEDULE_SLOT_STORAGE_KEY, String(next));
                } catch {
                  // ignore
                }
              }}
              aria-label="Крок сітки"
            >
              {GRID_SLOT_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} хв
                </option>
              ))}
            </select>
          </label>
          {viewMode === 'room' && (
            <Button type="button" variant="secondary" onClick={() => setRoomModalOpen(true)}>
              + Кабінет
            </Button>
          )}
          <select className="ui-input" value={visitFilter} onChange={(event) => setVisitFilter(event.target.value as VisitStatus | 'all')}>
            <option value="all">Усі стани візиту</option>
            {VISIT_STATUSES.map((status) => <option value={status} key={status}>{visitStatusLabel(status)}</option>)}
          </select>
          <label className="check-filter">
            <input type="checkbox" checked={attentionOnly} onChange={(event) => setAttentionOnly(event.target.checked)} />
            Потребують уваги
          </label>
        </div>
      </section>

      {viewMode === 'room' && !activeRooms.length && !loading && (
        <div className="notice">
          Кабінетів ще немає.{' '}
          <button type="button" className="linkish" onClick={() => setRoomModalOpen(true)}>
            Додати перший кабінет
          </button>
        </div>
      )}

      <div className="status-legend">
        <span><i className="legend-dot refused" /> Відмова</span>
        <span><i className="legend-dot waiting" /> Очікує</span>
        <span><i className="legend-dot first" /> Перший візит</span>
        <span><i className="legend-dot completed" /> Завершено</span>
        <span><i className="legend-dot default" /> Заплановано</span>
        <span><i className="legend-outline" /> Увага / конфлікт</span>
      </div>

      {error && <div className="notice-error">{error}</div>}
      {loading && <div className="notice">Завантаження…</div>}

      <div className="mobile-master-switch">
        <Button variant="secondary" disabled={mobileColumnIndex === 0} onClick={() => setMobileColumnIndex((index) => index - 1)}>←</Button>
        <strong>{mobileLabel}</strong>
        <Button
          variant="secondary"
          disabled={mobileColumnIndex >= mobileColumns.length - 1}
          onClick={() => setMobileColumnIndex((index) => index + 1)}
        >
          →
        </Button>
      </div>

      <ScheduleGrid
        bookings={filteredBookings}
        masters={masters}
        rooms={rooms}
        viewMode={viewMode}
        date={date}
        timeZone={timeZone}
        slotMinutes={slotMinutes}
        mobileColumnIndex={mobileColumnIndex}
        onBookingClick={setSelected}
        onAddClick={setAddDraft}
        onNoteSave={(booking, notes) => updateBooking(booking.id, { notes })}
        onReschedule={async (booking, target) => {
          setError('');
          try {
            await updateBooking(booking.id, {
              datetime: `${date}T${target.time}:00`,
              masterId: target.masterId ?? booking.master_id,
              roomId: target.roomId !== undefined ? target.roomId : booking.room_id ?? null,
            });
          } catch (err) {
            setError((err as { error?: string }).error ?? 'Не вдалось перенести запис');
            throw err;
          }
        }}
      />

      {selected && (
        <BookingDrawer
          key={selected.id}
          booking={selected}
          masters={masters}
          services={services}
          rooms={activeRooms}
          timeZone={timeZone}
          slotMinutes={slotMinutes}
          onClose={() => setSelected(null)}
          onSave={async (payload) => {
            await updateBooking(selected.id, payload);
            setSelected(null);
          }}
          onRemove={async () => {
            setError('');
            try {
              await api.delete(`/api/admin/bookings/${selected.id}`);
              setBookings((current) => current.filter((item) => item.id !== selected.id));
              setSelected(null);
              void refetch().catch(console.error);
            } catch (err) {
              setError((err as { error?: string }).error ?? 'Не вдалось прибрати запис');
              throw err;
            }
          }}
        />
      )}
      {addDraft && (
        <BookingForm
          draft={addDraft}
          date={date}
          masters={masters}
          services={services}
          rooms={activeRooms}
          onClose={() => setAddDraft(null)}
          onCreated={() => {
            setAddDraft(null);
            void refetch().catch((err: { error?: string }) => setError(err.error ?? 'Не вдалося оновити записи'));
          }}
        />
      )}
      {roomModalOpen && (
        <Modal title="Новий кабінет" onClose={() => setRoomModalOpen(false)}>
          <form className="form-grid" onSubmit={createRoom}>
            <label className="full">
              Назва
              <input
                required
                autoFocus
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                placeholder="Кабінет 1"
              />
            </label>
            <Button className="full" type="submit" disabled={savingRoom}>
              {savingRoom ? 'Створення…' : 'Створити кабінет'}
            </Button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function BookingDrawer({
  booking, masters, services, rooms, timeZone, slotMinutes = 30, onClose, onSave, onRemove,
}: {
  booking: Booking;
  masters: Master[];
  services: Service[];
  rooms: Room[];
  timeZone: string;
  slotMinutes?: GridSlotMinutes;
  onClose: () => void;
  onSave: (payload: UpdateBookingPayload) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const initialDatetime = toDateTimeLocalValue(booking.datetime, timeZone);
  const [form, setForm] = useState({
    visit_status: booking.visit_status,
    status: booking.status,
    needs_attention: booking.needs_attention,
    attention_reason: booking.attention_reason ?? '',
    notes: booking.notes ?? '',
    masterId: booking.master_id,
    serviceId: booking.service_id,
    roomId:
      booking.room_id ??
      masters.find((master) => master.id === booking.master_id)?.default_room_id ??
      '',
    datetime: initialDatetime,
  });
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [formError, setFormError] = useState('');

  async function removeBooking() {
    if (!confirm(`Прибрати запис клієнта «${booking.client_name}»? Слот знову стане вільним.`)) return;
    setRemoving(true);
    setFormError('');
    try {
      await onRemove();
    } catch (err) {
      setFormError((err as { error?: string }).error ?? 'Не вдалось прибрати запис');
    } finally {
      setRemoving(false);
    }
  }

  function isWorkingHours(datetimeLocal: string): boolean {
    const time = datetimeLocal.split('T')[1]?.slice(0, 5);
    if (!time) return false;
    const [h, m] = time.split(':').map(Number);
    const minutes = h * 60 + m;
    return minutes >= GRID_START_HOUR * 60 && minutes < GRID_END_HOUR * 60;
  }

  async function save() {
    setSaving(true);
    setFormError('');
    try {
      if (form.datetime !== initialDatetime && !isWorkingHours(form.datetime)) {
        setFormError(`Час має бути в робочих годинах сітки: ${String(GRID_START_HOUR).padStart(2, '0')}:00–${String(GRID_END_HOUR).padStart(2, '0')}:00`);
        return;
      }
      const payload: UpdateBookingPayload = {
        visit_status: form.visit_status,
        status: form.status,
        needs_attention: form.needs_attention,
        attention_reason: form.attention_reason || null,
        notes: form.notes,
        masterId: form.masterId,
        serviceId: form.serviceId,
        roomId: form.roomId || null,
      };
      if (form.datetime !== initialDatetime) {
        payload.datetime = form.datetime;
      }
      await onSave(payload);
    } catch (err) {
      setFormError((err as { error?: string }).error ?? 'Не вдалося зберегти');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer title="Деталі запису" onClose={onClose}>
      <form
        className="drawer-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="client-summary">
          <span className="large-initials">{booking.client_initials || booking.client_name[0]}</span>
          <div>
            <h3>{booking.client_name}</h3>
            <p>{booking.client_phone || 'Телефон не вказано'}</p>
            {booking.client_id && <Link to={`/clients/${booking.client_id}`}>Відкрити картку клієнта →</Link>}
          </div>
        </div>
        <div className="form-grid">
          {formError && <div className="notice-error full">{formError}</div>}
          <label>Стан візиту<select value={form.visit_status} onChange={(e) => setForm({ ...form, visit_status: e.target.value as VisitStatus })}>
            {VISIT_STATUSES.map((status) => <option key={status} value={status}>{visitStatusLabel(status)}</option>)}
          </select></label>
          <label>Статус запису<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as BookingStatus })}>
            {BOOKING_STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
          </select></label>
          <label>Спеціаліст<select value={form.masterId} onChange={(e) => setForm({ ...form, masterId: e.target.value })}>
            {masters.map((master) => <option key={master.id} value={master.id}>{master.name}</option>)}
          </select></label>
          <label>Послуга<select value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}>
            {services.map((service) => <option key={service.id} value={service.id}>{service.name_uk}</option>)}
          </select></label>
          {!!rooms.length && (
            <label className="full">Кабінет<select value={form.roomId} onChange={(e) => setForm({ ...form, roomId: e.target.value })}>
              <option value="">Без кабінету</option>
              {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
            </select></label>
          )}
          <label className="full">
            Дата й час
            <input
              type="datetime-local"
              step={slotMinutes * 60}
              value={form.datetime}
              onChange={(e) => setForm({ ...form, datetime: e.target.value })}
            />
            <span className="field-hint">
              Робочі години сітки: {String(GRID_START_HOUR).padStart(2, '0')}:00–{String(GRID_END_HOUR).padStart(2, '0')}:00 · крок {slotMinutes} хв
            </span>
          </label>
          <label className="attention-check full"><input type="checkbox" checked={form.needs_attention} onChange={(e) => setForm({ ...form, needs_attention: e.target.checked })} /> Потребує уваги</label>
          {form.needs_attention && <label className="full">Причина<input value={form.attention_reason} onChange={(e) => setForm({ ...form, attention_reason: e.target.value })} /></label>}
          <label className="full">Нотатки<textarea rows={5} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Ctrl+Enter — зберегти" /></label>
        </div>
        <div className="drawer-actions drawer-actions-split">
          <Button type="button" variant="danger" disabled={saving || removing} onClick={() => void removeBooking()}>
            {removing ? 'Видалення…' : 'Прибрати запис'}
          </Button>
          <Button type="submit" disabled={saving || removing}>{saving ? 'Збереження…' : 'Зберегти зміни'}</Button>
        </div>
      </form>
    </Drawer>
  );
}

function BookingForm({
  draft, date, masters, services, rooms, onClose, onCreated,
}: {
  draft: ScheduleAddDraft;
  date: string;
  masters: Master[];
  services: Service[];
  rooms: Room[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const initialMasterId = draft.masterId || masters[0]?.id || '';
  const [masterId, setMasterId] = useState(initialMasterId);
  const [roomId, setRoomId] = useState(() => {
    if (draft.roomId) return draft.roomId;
    const master = masters.find((item) => item.id === initialMasterId);
    return master?.default_room_id ?? '';
  });
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [time, setTime] = useState(draft.time);
  const [query, setQuery] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const id = window.setTimeout(() => {
      if (!query.trim()) return setClients([]);
      api
        .get<{ clients: Client[] } | Client[]>(`/api/admin/clients?search=${encodeURIComponent(query)}`)
        .then((data) => setClients(Array.isArray(data) ? data : data.clients ?? []))
        .catch(() => setClients([]));
    }, 250);
    return () => window.clearTimeout(id);
  }, [query]);

  function selectClient(client: Client) {
    setClientId(client.id);
    setClientName(client.full_name);
    setClientPhone(client.phone ?? '');
    setQuery(client.full_name);
    setClients([]);
  }

  async function quickCreate() {
    if (!clientName.trim()) return;
    const client = await api.post<Client>('/api/admin/clients', { full_name: clientName, phone: clientPhone || null });
    selectClient(client);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const body: CreateBookingPayload = {
      masterId, serviceId, datetime: `${date}T${time}:00`, notes,
      roomId: roomId || null,
      ...(clientId ? { clientId } : { clientName, clientPhone }),
    };
    try {
      await api.post('/api/admin/bookings', body);
      onCreated();
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалося створити запис');
      setSaving(false);
    }
  }

  return (
    <Modal title="Новий запис" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        {error && <div className="notice-error full">{error}</div>}
        <label className="full">Пошук клієнта<input value={query} onChange={(e) => { setQuery(e.target.value); setClientId(''); }} placeholder="Ім’я або телефон" />
          {!!clients.length && <div className="client-results">{clients.map((client) => <button type="button" key={client.id} onClick={() => selectClient(client)}><b>{client.full_name}</b><span>{client.phone}</span></button>)}</div>}
        </label>
        <label>Ім’я клієнта<input required value={clientName} onChange={(e) => { setClientName(e.target.value); setClientId(''); }} /></label>
        <label>Телефон<input value={clientPhone} onChange={(e) => { setClientPhone(e.target.value); setClientId(''); }} /></label>
        {!clientId && clientName && <Button className="full" type="button" variant="secondary" onClick={quickCreate}>+ Створити картку клієнта</Button>}
        <label>
          Спеціаліст
          <select
            required
            value={masterId}
            onChange={(e) => {
              const nextMasterId = e.target.value;
              setMasterId(nextMasterId);
              const master = masters.find((item) => item.id === nextMasterId);
              setRoomId(master?.default_room_id ?? '');
            }}
          >
            {masters.map((master) => (
              <option key={master.id} value={master.id}>
                {master.name}
              </option>
            ))}
          </select>
        </label>
        <label>Послуга<select required value={serviceId} onChange={(e) => setServiceId(e.target.value)}>{services.map((service) => <option key={service.id} value={service.id}>{service.name_uk}</option>)}</select></label>
        {!!rooms.length && (
          <label>Кабінет<select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">Без кабінету</option>
            {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
          </select></label>
        )}
        <label>Час<input type="time" required value={time} onChange={(e) => setTime(e.target.value)} /></label>
        <label className="full">Нотатки<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <Button className="full" type="submit" disabled={saving}>{saving ? 'Збереження…' : 'Створити запис'}</Button>
      </form>
    </Modal>
  );
}
