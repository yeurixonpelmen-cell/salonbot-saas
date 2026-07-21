import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Booking, BookingStatus, Client, CreateBookingPayload, Master, Service,
  UpdateBookingPayload, VisitStatus, statusLabel, visitStatusLabel,
} from '../api';
import { ScheduleGrid, formatDisplayDate, shiftDate, todayStr } from '../components/ScheduleGrid';
import { Button, Drawer, Input, Modal } from '../components/ui';

type AddDraft = { masterId: string; time: string } | null;
const VISIT_STATUSES: VisitStatus[] = ['scheduled', 'first_visit', 'waiting', 'in_progress', 'refused', 'completed'];
const BOOKING_STATUSES: BookingStatus[] = ['pending', 'confirmed', 'cancelled', 'completed'];

function toLocalDateTimeInput(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function SchedulePage() {
  const [date, setDate] = useState(todayStr());
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [masters, setMasters] = useState<Master[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [addDraft, setAddDraft] = useState<AddDraft>(null);
  const [mobileMasterIndex, setMobileMasterIndex] = useState(0);
  const [visitFilter, setVisitFilter] = useState<VisitStatus | 'all'>('all');
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
    ]).then(([masterData, serviceData]) => {
      setMasters(masterData);
      setServices(serviceData);
    }).catch((err: { error?: string }) => setError(err.error ?? 'Не вдалося завантажити дані'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refetch().catch((err: { error?: string }) => setError(err.error ?? 'Не вдалося завантажити записи'));
  }, [refetch]);

  useEffect(() => {
    const id = window.setInterval(() => refetch().catch(console.error), 15000);
    return () => window.clearInterval(id);
  }, [refetch]);

  const filteredBookings = useMemo(() => bookings.filter((booking) => {
    if (visitFilter !== 'all' && booking.visit_status !== visitFilter) return false;
    if (attentionOnly && !booking.needs_attention && !booking.has_conflict) return false;
    return true;
  }), [bookings, visitFilter, attentionOnly]);

  async function updateBooking(id: string, payload: UpdateBookingPayload) {
    await api.patch<Booking>(`/api/admin/bookings/${id}`, payload);
    await refetch();
  }

  return (
    <div className="page-stack">
      <header className="schedule-page-header">
        <div>
          <span className="eyebrow">Календар команди</span>
          <h1>Розклад</h1>
          <p>{formatDisplayDate(date)} · {bookings.length} записів</p>
        </div>
        <Button onClick={() => setAddDraft({ masterId: masters[0]?.id ?? '', time: '09:00' })} disabled={!masters.length}>
          + Новий запис
        </Button>
      </header>

      <section className="schedule-toolbar">
        <div className="date-controls">
          <Button variant="secondary" onClick={() => setDate(shiftDate(date, -1))}>←</Button>
          <Input aria-label="Дата" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          <Button variant="secondary" onClick={() => setDate(shiftDate(date, 1))}>→</Button>
          <Button variant="ghost" onClick={() => setDate(todayStr())}>Сьогодні</Button>
        </div>
        <div className="schedule-filters">
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
        <Button variant="secondary" disabled={mobileMasterIndex === 0} onClick={() => setMobileMasterIndex((index) => index - 1)}>←</Button>
        <strong>{masters[mobileMasterIndex]?.name ?? 'Спеціаліст'}</strong>
        <Button variant="secondary" disabled={mobileMasterIndex >= masters.length - 1} onClick={() => setMobileMasterIndex((index) => index + 1)}>→</Button>
      </div>

      <ScheduleGrid
        bookings={filteredBookings}
        masters={masters}
        date={date}
        mobileMasterIndex={mobileMasterIndex}
        onBookingClick={setSelected}
        onAddClick={(masterId, time) => setAddDraft({ masterId, time })}
        onNoteSave={(booking, notes) => updateBooking(booking.id, { notes })}
      />

      {selected && (
        <BookingDrawer
          booking={selected}
          masters={masters}
          services={services}
          onClose={() => setSelected(null)}
          onSave={(payload) => updateBooking(selected.id, payload)}
        />
      )}
      {addDraft && (
        <BookingForm
          draft={addDraft}
          date={date}
          masters={masters}
          services={services}
          onClose={() => setAddDraft(null)}
          onCreated={async () => { setAddDraft(null); await refetch(); }}
        />
      )}
    </div>
  );
}

function BookingDrawer({
  booking, masters, services, onClose, onSave,
}: {
  booking: Booking;
  masters: Master[];
  services: Service[];
  onClose: () => void;
  onSave: (payload: UpdateBookingPayload) => Promise<void>;
}) {
  const localDateTime = toLocalDateTimeInput(booking.datetime);
  const [form, setForm] = useState({
    visit_status: booking.visit_status,
    status: booking.status,
    needs_attention: booking.needs_attention,
    attention_reason: booking.attention_reason ?? '',
    notes: booking.notes ?? '',
    masterId: booking.master_id,
    serviceId: booking.service_id,
    datetime: localDateTime,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave({ ...form, attention_reason: form.attention_reason || null });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer title="Деталі запису" onClose={onClose}>
      <div className="client-summary">
        <span className="large-initials">{booking.client_initials || booking.client_name[0]}</span>
        <div>
          <h3>{booking.client_name}</h3>
          <p>{booking.client_phone || 'Телефон не вказано'}</p>
          {booking.client_id && <Link to={`/clients/${booking.client_id}`}>Відкрити картку клієнта →</Link>}
        </div>
      </div>
      <div className="form-grid">
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
        <label className="full">Дата й час<input type="datetime-local" value={form.datetime} onChange={(e) => setForm({ ...form, datetime: e.target.value })} /></label>
        <label className="attention-check full"><input type="checkbox" checked={form.needs_attention} onChange={(e) => setForm({ ...form, needs_attention: e.target.checked })} /> Потребує уваги</label>
        {form.needs_attention && <label className="full">Причина<input value={form.attention_reason} onChange={(e) => setForm({ ...form, attention_reason: e.target.value })} /></label>}
        <label className="full">Нотатки<textarea rows={5} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
      </div>
      <div className="drawer-actions"><Button onClick={save} disabled={saving}>{saving ? 'Збереження…' : 'Зберегти зміни'}</Button></div>
    </Drawer>
  );
}

function BookingForm({
  draft, date, masters, services, onClose, onCreated,
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
      api.get<Client[]>(`/api/admin/clients?search=${encodeURIComponent(query)}`).then(setClients).catch(() => setClients([]));
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
      ...(clientId ? { clientId } : { clientName, clientPhone }),
    };
    try {
      await api.post('/api/admin/bookings', body);
      await onCreated();
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалося створити запис');
    } finally {
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
        {clientId && <div className="selected-client full">✓ Обрано клієнта з бази</div>}
        <label>Спеціаліст<select required value={masterId} onChange={(e) => setMasterId(e.target.value)}>{masters.map((master) => <option key={master.id} value={master.id}>{master.name}</option>)}</select></label>
        <label>Послуга<select required value={serviceId} onChange={(e) => setServiceId(e.target.value)}>{services.map((service) => <option key={service.id} value={service.id}>{service.name_uk} · {service.duration_minutes} хв</option>)}</select></label>
        <label>Дата<input value={date} disabled /></label>
        <label>Час<input type="time" required value={time} onChange={(e) => setTime(e.target.value)} /></label>
        <label className="full">Нотатка<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <Button className="full" disabled={saving || !masterId || !serviceId}>{saving ? 'Збереження…' : 'Створити запис'}</Button>
      </form>
    </Modal>
  );
}
