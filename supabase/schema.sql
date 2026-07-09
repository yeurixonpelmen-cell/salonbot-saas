-- SalonBot SaaS — Supabase schema (run in SQL Editor)

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

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

-- Bookings
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID REFERENCES salons(id),
  master_id UUID REFERENCES masters(id),
  service_id UUID REFERENCES services(id),
  client_telegram_id BIGINT NOT NULL,
  client_name TEXT NOT NULL,
  client_phone TEXT,
  booking_datetime TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','completed')),
  notes TEXT,
  reminder_24h_sent BOOLEAN DEFAULT false,
  reminder_2h_sent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (client_telegram_id, master_id, booking_datetime)
);

CREATE OR REPLACE FUNCTION tstz_add_minutes(ts timestamptz, mins integer)
RETURNS timestamptz AS $$ SELECT ts + (mins * interval '1 minute'); $$
LANGUAGE sql IMMUTABLE;

ALTER TABLE bookings ADD CONSTRAINT no_overlap EXCLUDE USING gist (
  master_id WITH =,
  tstzrange(booking_datetime, tstz_add_minutes(booking_datetime, duration_minutes)) WITH &&
) WHERE (status <> 'cancelled');

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

-- Storage bucket for logos (run in Supabase dashboard or via API)
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('logos', 'logos', true)
-- ON CONFLICT (id) DO NOTHING;
