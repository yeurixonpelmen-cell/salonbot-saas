const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export function getToken(): string | null {
  return localStorage.getItem('admin_token');
}

export function setToken(token: string): void {
  localStorage.setItem('admin_token', token);
}

export function clearToken(): void {
  localStorage.removeItem('admin_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error' }));
    throw err;
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export interface Booking {
  id: string;
  client_name: string;
  client_phone: string | null;
  master_id: string;
  master_name: string;
  service_name: string;
  service_price: number | null;
  duration_minutes: number;
  datetime: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  notes: string | null;
}

export type BookingStatus = Booking['status'];

export interface Master {
  id: string;
  name: string;
  photo_url: string | null;
  position: string | null;
  is_active: boolean;
}

export interface MasterPayload {
  name: string;
  photo_url?: string | null;
  position?: string | null;
  is_active?: boolean;
}

export interface Service {
  id: string;
  name_uk: string;
  name_en: string | null;
  duration_minutes: number;
  price: number | null;
  is_active: boolean;
  masters: { id: string; name: string }[];
}

export interface CreateBookingPayload {
  masterId: string;
  serviceId: string;
  clientName: string;
  clientPhone?: string;
  datetime: string;
  notes?: string;
}

export interface ServicePayload {
  name_uk: string;
  name_en?: string | null;
  duration_minutes: number;
  price?: number | null;
  is_active?: boolean;
  masterIds?: string[];
}

export interface ScheduleRow {
  id?: string;
  master_id?: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface SalonSettings {
  id: string;
  name_uk: string;
  name_en: string | null;
  address: string | null;
  logo_url: string | null;
  bot_username: string | null;
  admin_chat_id: string | null;
}

export const GRID_SLOT_MINUTES = 30;
export const GRID_START_HOUR = 8;
export const GRID_END_HOUR = 20;

export function getGridTimeSlots(): string[] {
  const slots: string[] = [];
  for (let m = GRID_START_HOUR * 60; m < GRID_END_HOUR * 60; m += GRID_SLOT_MINUTES) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return slots;
}

export function durationToRowSpan(durationMinutes: number): number {
  return Math.max(1, Math.ceil(durationMinutes / GRID_SLOT_MINUTES));
}

export function bookingToRowStart(datetime: string): number {
  const d = new Date(datetime);
  const minutes = d.getHours() * 60 + d.getMinutes() - GRID_START_HOUR * 60;
  return Math.floor(minutes / GRID_SLOT_MINUTES) + 2; // +2 for header row
}

export function bookingToCol(masterIndex: number): number {
  return masterIndex + 2; // +2 for time column
}

export function localDateStr(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function statusLabel(status: BookingStatus): string {
  const labels: Record<BookingStatus, string> = {
    pending: 'Очікує',
    confirmed: 'Підтверджено',
    cancelled: 'Скасовано',
    completed: 'Завершено',
  };
  return labels[status];
}

export function statusMark(status: BookingStatus): string {
  const marks: Record<BookingStatus, string> = {
    pending: '🟡',
    confirmed: '🟢',
    cancelled: '🔴',
    completed: '⚫',
  };
  return marks[status];
}
