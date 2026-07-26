-- One-time activation codes: client redeems via email onboarding → max 1 salon

CREATE TABLE IF NOT EXISTS activation_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unused'
    CHECK (status IN ('unused', 'reserved', 'redeemed', 'revoked')),
  reserved_email TEXT,
  password_hash TEXT,
  reserved_at TIMESTAMPTZ,
  redeemed_at TIMESTAMPTZ,
  salon_id UUID REFERENCES salons(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS activation_codes_code_upper_idx
  ON activation_codes (upper(code));

CREATE INDEX IF NOT EXISTS activation_codes_status_idx
  ON activation_codes (status);

CREATE INDEX IF NOT EXISTS activation_codes_reserved_email_idx
  ON activation_codes (lower(reserved_email));
