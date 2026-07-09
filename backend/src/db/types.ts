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
  booking_datetime: string;
  duration_minutes: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  notes: string | null;
  reminder_24h_sent: boolean;
  reminder_2h_sent: boolean;
  created_at: string;
  updated_at: string;
}

export interface JwtPayload {
  salon_id: string;
  owner_telegram_id: number;
}
