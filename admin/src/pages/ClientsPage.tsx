import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Client, ClientPayload, ClientsListResponse } from '../api';
import { Button, Input, Modal } from '../components/ui';
import { useLocale } from '../context/LocaleContext';

type PeriodPreset = '7d' | '30d' | 'month' | 'custom';
type Segment = 'all' | 'new' | 'old';
type VisitsFilter = 'all' | 'none' | 'some' | 'many';
type TriState = 'any' | 'yes' | 'no';

function clientInitials(client: Client) {
  return client.initials || client.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function age(date?: string | null) {
  if (!date) return null;
  const born = new Date(date);
  const now = new Date();
  let years = now.getFullYear() - born.getFullYear();
  if (now < new Date(now.getFullYear(), born.getMonth(), born.getDate())) years--;
  return years;
}

function toDateInput(value: Date) {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function periodRange(preset: PeriodPreset, customFrom: string, customTo: string) {
  const now = new Date();
  if (preset === 'custom') {
    return {
      from: customFrom || toDateInput(new Date(now.getTime() - 30 * 86400000)),
      to: customTo || toDateInput(now),
    };
  }
  if (preset === '7d') {
    return { from: toDateInput(new Date(now.getTime() - 7 * 86400000)), to: toDateInput(now) };
  }
  if (preset === 'month') {
    return { from: toDateInput(new Date(now.getFullYear(), now.getMonth(), 1)), to: toDateInput(now) };
  }
  return { from: toDateInput(new Date(now.getTime() - 30 * 86400000)), to: toDateInput(now) };
}

function triToQuery(value: TriState): string | null {
  if (value === 'yes') return '1';
  if (value === 'no') return '0';
  return null;
}

export function ClientsPage() {
  const { t } = useLocale();
  const [clients, setClients] = useState<Client[]>([]);
  const [summary, setSummary] = useState<ClientsListResponse['summary'] | null>(null);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [segment, setSegment] = useState<Segment>('all');
  const [tag, setTag] = useState('');
  const [visits, setVisits] = useState<VisitsFilter>('all');
  const [hasPhone, setHasPhone] = useState<TriState>('any');
  const [hasEmail, setHasEmail] = useState<TriState>('any');
  const [hasTelegram, setHasTelegram] = useState<TriState>('any');
  const [hasNotes, setHasNotes] = useState<TriState>('any');
  const [hasDob, setHasDob] = useState<TriState>('any');
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const range = useMemo(
    () => periodRange(periodPreset, customFrom, customTo),
    [periodPreset, customFrom, customTo]
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (segment !== 'all') count += 1;
    if (tag) count += 1;
    if (visits !== 'all') count += 1;
    if (hasPhone !== 'any') count += 1;
    if (hasEmail !== 'any') count += 1;
    if (hasTelegram !== 'any') count += 1;
    if (hasNotes !== 'any') count += 1;
    if (hasDob !== 'any') count += 1;
    return count;
  }, [segment, tag, visits, hasPhone, hasEmail, hasTelegram, hasNotes, hasDob]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      params.set('created_from', range.from);
      params.set('created_to', range.to);
      params.set('segment', segment);
      if (tag) params.set('tag', tag);
      if (visits !== 'all') params.set('visits', visits);
      const phone = triToQuery(hasPhone);
      const email = triToQuery(hasEmail);
      const telegram = triToQuery(hasTelegram);
      const notes = triToQuery(hasNotes);
      const dob = triToQuery(hasDob);
      if (phone) params.set('has_phone', phone);
      if (email) params.set('has_email', email);
      if (telegram) params.set('has_telegram', telegram);
      if (notes) params.set('has_notes', notes);
      if (dob) params.set('has_dob', dob);

      const data = await api.get<ClientsListResponse | Client[]>(`/api/admin/clients?${params}`);
      if (Array.isArray(data)) {
        setClients(data);
        setSummary(null);
        setAvailableTags([]);
      } else {
        setClients(data.clients ?? []);
        setSummary(data.summary ?? null);
        setAvailableTags(data.available_tags ?? []);
      }
      setError('');
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалося завантажити клієнтів');
    } finally {
      setLoading(false);
    }
  }, [search, range.from, range.to, segment, tag, visits, hasPhone, hasEmail, hasTelegram, hasNotes, hasDob]);

  useEffect(() => {
    const id = window.setTimeout(() => load(), 250);
    return () => window.clearTimeout(id);
  }, [load]);

  function resetFilters() {
    setSegment('all');
    setTag('');
    setVisits('all');
    setHasPhone('any');
    setHasEmail('any');
    setHasTelegram('any');
    setHasNotes('any');
    setHasDob('any');
    setPeriodPreset('30d');
    setCustomFrom('');
    setCustomTo('');
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">CRM</span>
          <h1>{t('clients_title')}</h1>
        </div>
        <Button onClick={() => setShowCreate(true)}>{t('clients_add')}</Button>
      </header>

      <section className="content-card client-toolbar">
        <div className="client-search">
          <label className="client-search-field">
            <span className="client-search-icon" aria-hidden>⌕</span>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('clients_search')}
              aria-label={t('clients_search')}
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setShowFilters((prev) => !prev)}
          >
            {t('clients_filters')}{activeFilterCount ? ` (${activeFilterCount})` : ''}
          </Button>
          <span>{summary?.total ?? clients.length}</span>
        </div>

        {showFilters && (
          <div className="client-filters-wrap">
            <div className="client-period-bar">
              <div className="client-period-presets">
                {(
                  [
                    ['7d', '7 днів'],
                    ['30d', '30 днів'],
                    ['month', 'Цей місяць'],
                    ['custom', 'Свій'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`chip-btn${periodPreset === value ? ' active' : ''}`}
                    onClick={() => setPeriodPreset(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {periodPreset === 'custom' && (
                <div className="client-period-custom">
                  <label>
                    Від
                    <Input type="date" value={customFrom || range.from} onChange={(e) => setCustomFrom(e.target.value)} />
                  </label>
                  <label>
                    До
                    <Input type="date" value={customTo || range.to} onChange={(e) => setCustomTo(e.target.value)} />
                  </label>
                </div>
              )}
              <div className="client-period-stats">
                <strong>{summary?.new_in_period ?? 0}</strong>
                <span>нових за період</span>
                <button type="button" className="text-link" onClick={() => setSegment('new')}>
                  Показати нових
                </button>
                <button type="button" className="text-link" onClick={() => setSegment('old')}>
                  Показати старих
                </button>
                {segment !== 'all' && (
                  <button type="button" className="text-link" onClick={() => setSegment('all')}>
                    Усі
                  </button>
                )}
              </div>
            </div>

            <div className="client-filters-panel">
              <label>
                Нові / старі
                <select value={segment} onChange={(e) => setSegment(e.target.value as Segment)}>
                  <option value="all">Усі клієнти</option>
                  <option value="new">Нові (створені в періоді)</option>
                  <option value="old">Старі (до періоду)</option>
                </select>
              </label>
              <label>
                Візити
                <select value={visits} onChange={(e) => setVisits(e.target.value as VisitsFilter)}>
                  <option value="all">Будь-які</option>
                  <option value="none">Без візитів</option>
                  <option value="some">Є візити (1+)</option>
                  <option value="many">Багато (5+)</option>
                </select>
              </label>
              <label>
                Тег
                <select value={tag} onChange={(e) => setTag(e.target.value)}>
                  <option value="">Усі теги</option>
                  {availableTags.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                Телефон
                <select value={hasPhone} onChange={(e) => setHasPhone(e.target.value as TriState)}>
                  <option value="any">Не важливо</option>
                  <option value="yes">Є</option>
                  <option value="no">Немає</option>
                </select>
              </label>
              <label>
                Email
                <select value={hasEmail} onChange={(e) => setHasEmail(e.target.value as TriState)}>
                  <option value="any">Не важливо</option>
                  <option value="yes">Є</option>
                  <option value="no">Немає</option>
                </select>
              </label>
              <label>
                Telegram
                <select value={hasTelegram} onChange={(e) => setHasTelegram(e.target.value as TriState)}>
                  <option value="any">Не важливо</option>
                  <option value="yes">Є</option>
                  <option value="no">Немає</option>
                </select>
              </label>
              <label>
                Нотатки
                <select value={hasNotes} onChange={(e) => setHasNotes(e.target.value as TriState)}>
                  <option value="any">Не важливо</option>
                  <option value="yes">Є</option>
                  <option value="no">Немає</option>
                </select>
              </label>
              <label>
                Дата народження
                <select value={hasDob} onChange={(e) => setHasDob(e.target.value as TriState)}>
                  <option value="any">Не важливо</option>
                  <option value="yes">Є</option>
                  <option value="no">Немає</option>
                </select>
              </label>
              <div className="client-filters-actions">
                <Button type="button" variant="ghost" onClick={resetFilters}>Скинути</Button>
              </div>
            </div>
          </div>
        )}
      </section>

      {error && <div className="notice-error">{error}</div>}
      {loading ? <div className="notice">Завантаження…</div> : (
        <div className="clients-list">
          {clients.map((client) => (
            <Link to={`/clients/${client.id}`} className="client-row" key={client.id}>
              <span className="large-initials">{clientInitials(client)}</span>
              <div className="client-main">
                <strong>
                  {client.full_name}
                  {client.is_new_in_period && <span className="client-new-badge">новий</span>}
                </strong>
                <span>
                  {client.phone || 'Без телефону'}
                  {client.email ? ` · ${client.email}` : ''}
                </span>
              </div>
              <div className="client-tags">{client.tags?.map((item) => <span key={item}>{item}</span>)}</div>
              <div className="client-stat"><strong>{client.visits_count ?? 0}</strong><span>візитів</span></div>
              <div className="client-stat"><strong>{age(client.date_of_birth) ?? '—'}</strong><span>років</span></div>
              <span className="row-arrow">→</span>
            </Link>
          ))}
          {!clients.length && (
            <div className="empty-state">
              <b>Клієнтів не знайдено</b>
              <span>Змініть пошук, період або фільтри.</span>
            </div>
          )}
        </div>
      )}
      {showCreate && <ClientForm onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); void load(); }} />}
    </div>
  );
}

function ClientForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<ClientPayload>({ full_name: '', phone: '', email: '', date_of_birth: '', tags: [], general_notes: '' });
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const fullName = form.full_name.trim();
    const phone = form.phone?.trim() ?? '';
    if (!fullName && !phone) {
      setError('Вкажіть хоча б ім’я або телефон');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.post<Client>('/api/admin/clients', {
        ...form,
        full_name: fullName || phone,
        phone: phone || null,
        email: form.email?.trim() || null,
        date_of_birth: form.date_of_birth?.trim() || null,
        general_notes: form.general_notes?.trim() || null,
        tags: tags.split(',').map((item) => item.trim()).filter(Boolean),
      });
      await onSaved();
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалося створити клієнта');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Новий клієнт" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        {error && <div className="notice-error full">{error}</div>}
        <label className="full">Ім’я<input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Якщо відомо" /></label>
        <label>Телефон<input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Необов’язково" /></label>
        <label>Email<input value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Необов’язково" /></label>
        <label>Дата народження<input type="date" value={form.date_of_birth ?? ''} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} /></label>
        <label>Теги<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="VIP, постійний (необов’язково)" /></label>
        <label className="full">Загальні нотатки<textarea rows={4} value={form.general_notes ?? ''} onChange={(e) => setForm({ ...form, general_notes: e.target.value })} /></label>
        <Button type="submit" className="full" disabled={saving}>{saving ? 'Збереження…' : 'Створити клієнта'}</Button>
      </form>
    </Modal>
  );
}
