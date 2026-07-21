import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Client, ClientPayload } from '../api';
import { Button, Input, Modal } from '../components/ui';

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

export function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setClients(await api.get<Client[]>(`/api/admin/clients?search=${encodeURIComponent(search)}`));
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалося завантажити клієнтів');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const id = window.setTimeout(() => load(), 250);
    return () => window.clearTimeout(id);
  }, [load]);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div><span className="eyebrow">CRM</span><h1>Клієнти</h1><p>Контакти, історія візитів та файли</p></div>
        <Button onClick={() => setShowCreate(true)}>+ Додати клієнта</Button>
      </header>
      <section className="content-card client-search">
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Пошук за ім’ям, телефоном або email" />
        <span>{clients.length} клієнтів</span>
      </section>
      {error && <div className="notice-error">{error}</div>}
      {loading ? <div className="notice">Завантаження…</div> : (
        <div className="clients-list">
          {clients.map((client) => (
            <Link to={`/clients/${client.id}`} className="client-row" key={client.id}>
              <span className="large-initials">{clientInitials(client)}</span>
              <div className="client-main"><strong>{client.full_name}</strong><span>{client.phone || 'Без телефону'}{client.email ? ` · ${client.email}` : ''}</span></div>
              <div className="client-tags">{client.tags?.map((tag) => <span key={tag}>{tag}</span>)}</div>
              <div className="client-stat"><strong>{client.visits_count ?? 0}</strong><span>візитів</span></div>
              <div className="client-stat"><strong>{age(client.date_of_birth) ?? '—'}</strong><span>років</span></div>
              <span className="row-arrow">→</span>
            </Link>
          ))}
          {!clients.length && <div className="empty-state"><b>Клієнтів не знайдено</b><span>Змініть запит або створіть нову картку.</span></div>}
        </div>
      )}
      {showCreate && <ClientForm onClose={() => setShowCreate(false)} onSaved={async () => { setShowCreate(false); await load(); }} />}
    </div>
  );
}

function ClientForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<ClientPayload>({ full_name: '', phone: '', email: '', date_of_birth: '', tags: [], general_notes: '' });
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post<Client>('/api/admin/clients', { ...form, tags: tags.split(',').map((item) => item.trim()).filter(Boolean) });
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
        <label className="full">Ім’я<input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></label>
        <label>Телефон<input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        <label>Email<input type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Дата народження<input type="date" value={form.date_of_birth ?? ''} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} /></label>
        <label>Теги<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="VIP, постійний" /></label>
        <label className="full">Загальні нотатки<textarea rows={4} value={form.general_notes ?? ''} onChange={(e) => setForm({ ...form, general_notes: e.target.value })} /></label>
        <Button className="full" disabled={saving}>{saving ? 'Збереження…' : 'Створити клієнта'}</Button>
      </form>
    </Modal>
  );
}
