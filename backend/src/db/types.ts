export interface Salon {
  id: string;
  name_uk: string;
  name_en: string | null;
  address: string | null;
  logo_url: string | null;
  bot_username: string | null;
  admin_chat_id: string | null;
  owner_telegram_id: number;
  timezone: string;
  is_active: boolean;
  reminders_enabled?: boolean;
  review_request_enabled?: boolean;
  google_maps_url?: string | null;
  created_at: string;
}

export interface Master {
  id: string;
  salon_id: string;
  name: string;
  photo_url: string | null;
  position: string | null;
  is_active: boolean;
}

export interface Service {
  id: string;
  salon_id: string;
  name_uk: string;
  name_en: string | null;
  duration_minutes: number;
  price: number | null;
  is_active: boolean;
}

export interface Schedule {
  id: string;
  master_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface Booking {
  id: string;
  salon_id: string;
  master_id: string;
  service_id: string;
  client_telegram_id: number;
  client_name: string;
  client_phone: string | null;
  client_id: string | null;
  booking_datetime: string;
  duration_minutes: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  visit_status: VisitStatus;
  needs_attention: boolean;
  attention_reason: string | null;
  notes: string | null;
  reminder_24h_sent: boolean;
  reminder_2h_sent: boolean;
  created_at: string;
  updated_at: string;
}

export type VisitStatus =
  | 'scheduled'
  | 'first_visit'
  | 'waiting'
  | 'in_progress'
  | 'refused'
  | 'completed';

export interface Client {
  id: string;
  salon_id: string;
  telegram_id: number | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  date_of_birth: string | null;
  general_notes: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface BookingNote {
  id: string;
  salon_id: string;
  booking_id: string;
  author_id: number | null;
  body: string;
  created_at: string;
}

export interface ClientFile {
  id: string;
  salon_id: string;
  client_id: string | null;
  booking_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface JwtPayload {
  salon_id: string;
  owner_telegram_id: number;
}
