const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export function getApiUrl(): string {
  return API_URL;
}

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
    // Onboarding uses claim/complete tokens, not admin JWT — don't force /login redirect.
    if (!path.startsWith('/api/onboarding/')) {
      window.location.href = '/login';
    }
    const err = await res.json().catch(() => ({ error: 'Unauthorized' }));
    throw err;
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
  client_id: string | null;
  client_name: string;
  client_phone: string | null;
  client_initials?: string | null;
  client_profile?: string | null;
  master_id: string;
  master_name: string;
  service_id: string;
  service_name: string;
  service_price: number | null;
  room_id?: string | null;
  room_name?: string | null;
  duration_minutes: number;
  datetime: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  notes: string | null;
  visit_status: VisitStatus;
  needs_attention: boolean;
  attention_reason: string | null;
  has_conflict: boolean;
  files_count: number;
}

export interface Room {
  id: string;
  salon_id?: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
}

export interface RoomPayload {
  name: string;
  sort_order?: number;
  is_active?: boolean;
}

export type BookingStatus = Booking['status'];
export type VisitStatus =
  | 'scheduled'
  | 'first_visit'
  | 'waiting'
  | 'in_progress'
  | 'refused'
  | 'completed';

export interface Client {
  id: string;
  full_name: string;
  phone: string | null;
  email?: string | null;
  date_of_birth?: string | null;
  telegram_id?: number | null;
  initials?: string | null;
  tags?: string[];
  general_notes?: string | null;
  visits_count?: number;
  last_visit_at?: string | null;
  created_at?: string;
  is_new_in_period?: boolean;
  bookings?: Booking[];
}

export interface ClientsListSummary {
  total: number;
  new_in_period: number;
  old_in_period: number;
  period_from: string | null;
  period_to: string | null;
}

export interface ClientsListResponse {
  clients: Client[];
  summary: ClientsListSummary;
  available_tags: string[];
}

export interface ClientFile {
  id: string;
  client_id?: string;
  file_name?: string;
  size_bytes?: number;
  mime_type?: string | null;
  created_at?: string;
  signed_url?: string | null;
  url?: string | null;
}

export interface ClientPayload {
  full_name: string;
  phone?: string | null;
  email?: string | null;
  date_of_birth?: string | null;
  telegram_id?: number | null;
  tags?: string[];
  general_notes?: string | null;
}

export interface MasterPortfolioItem {
  type: 'photo' | 'video';
  url: string;
  caption?: string;
}

export interface Master {
  id: string;
  name: string;
  photo_url: string | null;
  position: string | null;
  bio: string | null;
  portfolio: MasterPortfolioItem[];
  is_active: boolean;
  default_room_id?: string | null;
  default_room_name?: string | null;
}

export interface MasterPayload {
  name: string;
  photo_url?: string | null;
  position?: string | null;
  bio?: string | null;
  portfolio?: MasterPortfolioItem[];
  is_active?: boolean;
  default_room_id?: string | null;
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
  clientId?: string;
  clientName?: string;
  clientPhone?: string;
  datetime: string;
  notes?: string;
  roomId?: string | null;
}

export interface UpdateBookingPayload {
  notes?: string | null;
  status?: BookingStatus;
  visit_status?: VisitStatus;
  needs_attention?: boolean;
  attention_reason?: string | null;
  masterId?: string;
  serviceId?: string;
  datetime?: string;
  clientId?: string;
  roomId?: string | null;
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
  timezone?: string;
  language?: 'uk' | 'ru' | 'en';
  reminders_enabled?: boolean;
  review_request_enabled?: boolean;
  require_booking_confirmation?: boolean;
  google_maps_url?: string | null;
}

export const GRID_SLOT_MINUTES = 30;
export const GRID_SLOT_OPTIONS = [15, 30, 45, 60] as const;
export type GridSlotMinutes = (typeof GRID_SLOT_OPTIONS)[number];
export const GRID_START_HOUR = 8;
export const GRID_END_HOUR = 20;
export const SCHEDULE_SLOT_STORAGE_KEY = 'salonbot_schedule_slot_minutes';

export function normalizeGridSlotMinutes(value: unknown): GridSlotMinutes {
  const n = Number(value);
  return (GRID_SLOT_OPTIONS as readonly number[]).includes(n) ? (n as GridSlotMinutes) : GRID_SLOT_MINUTES;
}

export function getGridTimeSlots(slotMinutes: number = GRID_SLOT_MINUTES): string[] {
  const step = normalizeGridSlotMinutes(slotMinutes);
  const slots: string[] = [];
  for (let m = GRID_START_HOUR * 60; m < GRID_END_HOUR * 60; m += step) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  return slots;
}

export function durationToRowSpan(durationMinutes: number, slotMinutes: number = GRID_SLOT_MINUTES): number {
  return Math.max(1, Math.ceil(durationMinutes / normalizeGridSlotMinutes(slotMinutes)));
}

export function bookingToRowStart(datetime: string, slotMinutes: number = GRID_SLOT_MINUTES): number {
  const step = normalizeGridSlotMinutes(slotMinutes);
  const d = new Date(datetime);
  const minutes = d.getHours() * 60 + d.getMinutes() - GRID_START_HOUR * 60;
  return Math.floor(minutes / step) + 2; // +2 for header row
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

export function visitStatusLabel(status: VisitStatus): string {
  const labels: Record<VisitStatus, string> = {
    scheduled: 'Заплановано',
    first_visit: 'Перший візит',
    waiting: 'Очікує',
    in_progress: 'На прийомі',
    refused: 'Відмовився',
    completed: 'Завершено',
  };
  return labels[status];
}
