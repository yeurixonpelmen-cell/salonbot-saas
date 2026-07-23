-- SalonBot SaaS — Supabase schema (run in SQL Editor)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Salons
CREATE TABLE salons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_uk TEXT NOT NULL,
  name_en TEXT,
  address TEXT,
  logo_url TEXT,
  bot_token TEXT NOT NULL,
  bot_username TEXT,
  admin_chat_id TEXT,
  owner_telegram_id BIGINT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Kyiv',
  is_active BOOLEAN DEFAULT true,
  reminders_enabled BOOLEAN NOT NULL DEFAULT true,
  review_request_enabled BOOLEAN NOT NULL DEFAULT false,
  google_maps_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Masters
CREATE TABLE masters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES salons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  photo_url TEXT,
  position TEXT,
  is_active BOOLEAN DEFAULT true
);

-- Services
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES salons(id) ON DELETE CASCADE,
  name_uk TEXT NOT NULL,
  name_en TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  price DECIMAL(10,2),
  is_active BOOLEAN DEFAULT true
);

-- Master schedules
CREATE TABLE schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_id UUID REFERENCES masters(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  UNIQUE (master_id, day_of_week)
);

-- CRM clients
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  telegram_id BIGINT,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  date_of_birth DATE,
  general_notes TEXT,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX clients_salon_telegram_uidx
  ON clients (salon_id, telegram_id) WHERE telegram_id IS NOT NULL;
CREATE UNIQUE INDEX clients_salon_phone_uidx
  ON clients (salon_id, phone) WHERE phone IS NOT NULL AND btrim(phone) <> '';
CREATE INDEX clients_salon_name_idx ON clients (salon_id, full_name);

-- Bookings
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES salons(id),
  master_id UUID REFERENCES masters(id),
  service_id UUID REFERENCES services(id),
  client_telegram_id BIGINT NOT NULL,
  client_name TEXT NOT NULL,
  client_phone TEXT,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  booking_datetime TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','completed')),
  visit_status TEXT NOT NULL DEFAULT 'scheduled' CHECK (
    visit_status IN ('scheduled','first_visit','waiting','in_progress','refused','completed')
  ),
  needs_attention BOOLEAN NOT NULL DEFAULT false,
  attention_reason TEXT,
  notes TEXT,
  reminder_24h_sent BOOLEAN DEFAULT false,
  reminder_2h_sent BOOLEAN DEFAULT false,
  review_request_sent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_telegram_id, master_id, booking_datetime)
);
CREATE INDEX bookings_salon_client_idx
  ON bookings (salon_id, client_id, booking_datetime DESC);

CREATE TABLE booking_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  author_id BIGINT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX booking_notes_booking_idx
  ON booking_notes (salon_id, booking_id, created_at);

CREATE TABLE client_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_files_owner_check CHECK (client_id IS NOT NULL OR booking_id IS NOT NULL)
);
CREATE INDEX client_files_client_idx ON client_files (salon_id, client_id, created_at);
CREATE INDEX client_files_booking_idx ON client_files (salon_id, booking_id, created_at);

-- Master-service links
CREATE TABLE master_services (
  master_id UUID REFERENCES masters(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (master_id, service_id)
);

-- Token encryption
CREATE OR REPLACE FUNCTION encrypt_token(token text, key text)
RETURNS text AS $$ SELECT pgp_sym_encrypt(token, key)::text; $$
LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION decrypt_token(token text, key text)
RETURNS text AS $$ SELECT pgp_sym_decrypt(token::bytea, key); $$
LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION get_active_salons_decrypted(p_key text)
RETURNS TABLE(id uuid, bot_token text) AS $$
  SELECT id, decrypt_token(bot_token, p_key) FROM salons WHERE is_active = true;
$$ LANGUAGE sql SECURITY DEFINER;

-- RLS enabled, no auth.uid() policies — backend uses service role
ALTER TABLE salons ENABLE ROW LEVEL SECURITY;
ALTER TABLE masters ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_services ENABLE ROW LEVEL SECURITY;

-- Lightweight updated_at trigger for admin polling/SSE support
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_set_updated_at
BEFORE UPDATE ON bookings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER clients_set_updated_at
BEFORE UPDATE ON clients
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Storage bucket for logos (run in Supabase dashboard or via API)
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('logos', 'logos', true)
-- ON CONFLICT (id) DO NOTHING;

-- Private CRM attachment bucket (25 MB)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('client-files', 'client-files', false, 26214400)
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = EXCLUDED.file_size_limit;
