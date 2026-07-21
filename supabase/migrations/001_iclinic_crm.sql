-- iClinic CRM model. Safe to re-run against an existing SalonBot database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS clients (
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

CREATE UNIQUE INDEX IF NOT EXISTS clients_salon_telegram_uidx
  ON clients (salon_id, telegram_id)
  WHERE telegram_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS clients_salon_phone_uidx
  ON clients (salon_id, phone)
  WHERE phone IS NOT NULL AND btrim(phone) <> '';
CREATE INDEX IF NOT EXISTS clients_salon_name_idx ON clients (salon_id, full_name);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS visit_status TEXT NOT NULL DEFAULT 'scheduled';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS needs_attention BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS attention_reason TEXT;
CREATE INDEX IF NOT EXISTS bookings_salon_client_idx
  ON bookings (salon_id, client_id, booking_datetime DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'bookings'::regclass
      AND conname = 'bookings_visit_status_check'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_visit_status_check
      CHECK (visit_status IN (
        'scheduled', 'first_visit', 'waiting', 'in_progress',
        'refused', 'completed'
      ));
  END IF;
END $$;

-- Admin-created overlaps are intentional; the mini-app keeps its availability precheck.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS no_overlap;

CREATE TABLE IF NOT EXISTS booking_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  author_id BIGINT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_notes_booking_idx
  ON booking_notes (salon_id, booking_id, created_at);

CREATE TABLE IF NOT EXISTS client_files (
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
CREATE INDEX IF NOT EXISTS client_files_client_idx
  ON client_files (salon_id, client_id, created_at);
CREATE INDEX IF NOT EXISTS client_files_booking_idx
  ON client_files (salon_id, booking_id, created_at);

-- Backfill Telegram clients first, treating synthetic/non-positive IDs as admin records.
INSERT INTO clients (salon_id, telegram_id, full_name, phone)
SELECT DISTINCT ON (b.salon_id, b.client_telegram_id)
  b.salon_id,
  b.client_telegram_id,
  b.client_name,
  NULLIF(btrim(b.client_phone), '')
FROM bookings b
WHERE b.client_id IS NULL
  AND b.salon_id IS NOT NULL
  AND b.client_telegram_id > 0
ORDER BY b.salon_id, b.client_telegram_id, b.created_at DESC
ON CONFLICT DO NOTHING;

UPDATE bookings b
SET client_id = c.id
FROM clients c
WHERE b.client_id IS NULL
  AND b.salon_id = c.salon_id
  AND b.client_telegram_id > 0
  AND c.telegram_id = b.client_telegram_id;

-- Then match or create clients by a usable phone.
INSERT INTO clients (salon_id, full_name, phone)
SELECT DISTINCT ON (b.salon_id, b.client_phone)
  b.salon_id,
  b.client_name,
  btrim(b.client_phone)
FROM bookings b
WHERE b.client_id IS NULL
  AND b.salon_id IS NOT NULL
  AND b.client_phone IS NOT NULL
  AND btrim(b.client_phone) <> ''
ORDER BY b.salon_id, b.client_phone, b.created_at DESC
ON CONFLICT DO NOTHING;

UPDATE bookings b
SET client_id = c.id
FROM clients c
WHERE b.client_id IS NULL
  AND b.salon_id = c.salon_id
  AND b.client_phone IS NOT NULL
  AND btrim(b.client_phone) <> ''
  AND c.phone = btrim(b.client_phone);

-- Preserve anonymous legacy bookings as separate CRM clients.
DO $$
DECLARE
  legacy_booking RECORD;
  new_client_id UUID;
BEGIN
  FOR legacy_booking IN
    SELECT id, salon_id, client_name
    FROM bookings
    WHERE client_id IS NULL AND salon_id IS NOT NULL
  LOOP
    INSERT INTO clients (salon_id, full_name)
    VALUES (legacy_booking.salon_id, legacy_booking.client_name)
    RETURNING id INTO new_client_id;

    UPDATE bookings
    SET client_id = new_client_id
    WHERE id = legacy_booking.id AND client_id IS NULL;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clients_set_updated_at ON clients;
CREATE TRIGGER clients_set_updated_at
BEFORE UPDATE ON clients
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS bookings_set_updated_at ON bookings;
CREATE TRIGGER bookings_set_updated_at
BEFORE UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Supabase exposes storage tables only when the storage extension is installed.
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit)
  VALUES ('client-files', 'client-files', false, 26214400)
  ON CONFLICT (id) DO UPDATE
    SET public = false, file_size_limit = EXCLUDED.file_size_limit;
EXCEPTION
  WHEN undefined_table OR invalid_schema_name OR insufficient_privilege THEN
    RAISE NOTICE 'Could not create client-files bucket; create it manually as private (25 MB).';
END $$;
