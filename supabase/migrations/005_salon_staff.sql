-- Staff access by email (per salon)
CREATE TABLE IF NOT EXISTS salon_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT salon_staff_email_salon_unique UNIQUE (salon_id, email)
);

CREATE UNIQUE INDEX IF NOT EXISTS salon_staff_email_lower_idx
  ON salon_staff (lower(email));

CREATE INDEX IF NOT EXISTS salon_staff_salon_id_idx ON salon_staff (salon_id);
