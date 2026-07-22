import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, Client, ClientFile, ClientPayload, visitStatusLabel } from '../api';
import { Button } from '../components/ui';

function initials(client: Client) {
  return client.initials || client.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function fileName(file: ClientFile) {
  return file.file_name || 'Файл';
}

export function ClientDetailsPage() {
  const { id = '' } = useParams();
  const [client, setClient] = useState<Client | null>(null);
  const [files, setFiles] = useState<ClientFile[]>([]);
  const [form, setForm] = useState<ClientPayload>({ full_name: '' });
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [clientData, fileData] = await Promise.all([
        api.get<Client>(`/api/admin/clients/${id}`),
        api.get<ClientFile[]>(`/api/admin/clients/${id}/files`),
      ]);
      setClient(clientData);
      setFiles(fileData);
      setForm({
        full_name: clientData.full_name,
        phone: clientData.phone,
        email: clientData.email,
        date_of_birth: clientData.date_of_birth,
        general_notes: clientData.general_notes,
        tags: clientData.tags,
      });
      setTags(clientData.tags?.join(', ') ?? '');
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалося завантажити картку');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.patch<Client>(`/api/admin/clients/${id}`, {
        ...form,
        full_name: form.full_name.trim() || form.phone?.trim() || client?.full_name || '',
        phone: form.phone?.trim() || null,
        email: form.email?.trim() || null,
        date_of_birth: form.date_of_birth?.trim() || null,
        general_notes: form.general_notes?.trim() || null,
        tags: tags.split(',').map((item) => item.trim()).filter(Boolean),
      });
      await load();
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалося зберегти картку');
    } finally {
      setSaving(false);
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (selected.size > 25 * 1024 * 1024) {
      setError('Максимальний розмір файлу — 25 МБ');
      event.target.value = '';
      return;
    }
    setUploading(true);
    setError('');
    const body = new FormData();
    body.append('file', selected);
    try {
      await api.post<ClientFile>(`/api/admin/clients/${id}/files`, body);
      await load();
    } catch (err) {
      setError((err as { error?: string }).error ?? 'Не вдалося завантажити файл');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }

  async function removeFile(file: ClientFile) {
    if (!window.confirm(`Видалити «${fileName(file)}»?`)) return;
    await api.delete(`/api/admin/clients/${id}/files/${file.id}`);
    await load();
  }

  if (!client && !error) return <div className="notice">Завантаження…</div>;
  if (!client) return <div className="notice-error">{error}</div>;

  return (
    <div className="page-stack">
      <Link className="back-link" to="/clients">← Усі клієнти</Link>
      <header className="client-profile-header">
        <span className="profile-initials">{initials(client)}</span>
        <div><span className="eyebrow">Картка клієнта</span><h1>{client.full_name}</h1><p>{client.phone || 'Телефон не вказано'}{client.email ? ` · ${client.email}` : ''}</p></div>
        <div className="profile-metric"><strong>{client.visits_count ?? client.bookings?.length ?? 0}</strong><span>візитів</span></div>
      </header>
      {error && <div className="notice-error">{error}</div>}

      <div className="client-details-grid">
        <section className="content-card">
          <div className="section-heading"><div><h2>Основна інформація</h2><p>Контакти та внутрішні нотатки</p></div></div>
          <form className="form-grid" onSubmit={submit}>
            <label className="full">Ім’я<input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="Якщо відомо" /></label>
            <label>Телефон<input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Необов’язково" /></label>
            <label>Email<input value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Необов’язково" /></label>
            <label>Дата народження<input type="date" value={form.date_of_birth ?? ''} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} /></label>
            <label>Теги<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="через кому" /></label>
            <label className="full">Загальні нотатки<textarea rows={5} value={form.general_notes ?? ''} onChange={(e) => setForm({ ...form, general_notes: e.target.value })} /></label>
            <Button disabled={saving}>{saving ? 'Збереження…' : 'Зберегти'}</Button>
          </form>
        </section>

        <section className="content-card">
          <div className="section-heading"><div><h2>Файли</h2><p>Документи та фото до 25 МБ</p></div>
            <label className="file-upload">{uploading ? 'Завантаження…' : '+ Додати файл'}<input type="file" disabled={uploading} onChange={upload} /></label>
          </div>
          <div className="file-list">
            {files.map((file) => {
              const href = file.signed_url || file.url;
              return <div className="file-row" key={file.id}><span className="file-icon">↗</span><div><b>{fileName(file)}</b><small>{file.size_bytes ? `${(file.size_bytes / 1024 / 1024).toFixed(1)} МБ` : 'Файл'}</small></div>
                {href && <a href={href} target="_blank" rel="noreferrer">Відкрити</a>}<button onClick={() => removeFile(file)}>Видалити</button></div>;
            })}
            {!files.length && <div className="empty-state compact">Файлів ще немає</div>}
          </div>
        </section>
      </div>

      <section className="content-card">
        <div className="section-heading"><div><h2>Історія візитів</h2><p>Усі записи клієнта</p></div></div>
        <div className="visit-history">
          {client.bookings?.map((booking) => (
            <div className="visit-row" key={booking.id}>
              <time>{new Date(booking.datetime).toLocaleDateString('uk-UA', { day: '2-digit', month: 'short', year: 'numeric' })}<small>{new Date(booking.datetime).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</small></time>
              <div><b>{booking.service_name}</b><span>{booking.master_name}</span></div>
              <span className={`visit-badge visit-${booking.visit_status}`}>{visitStatusLabel(booking.visit_status)}</span>
              <strong>{booking.service_price ? `${booking.service_price} ₴` : '—'}</strong>
            </div>
          ))}
          {!client.bookings?.length && <div className="empty-state compact">Історія візитів порожня</div>}
        </div>
      </section>
    </div>
  );
}
