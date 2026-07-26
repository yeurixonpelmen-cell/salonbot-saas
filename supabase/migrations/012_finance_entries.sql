-- FOP income/expense journal for salon white accounting

CREATE TABLE IF NOT EXISTS finance_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'UAH',
  payment_method TEXT NOT NULL DEFAULT 'iban'
    CHECK (payment_method IN ('iban', 'cash', 'card', 'other')),
  client_name TEXT,
  description TEXT NOT NULL DEFAULT '',
  master_id UUID REFERENCES masters(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  act_number TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finance_entries_salon_date_idx
  ON finance_entries (salon_id, entry_date DESC);

CREATE INDEX IF NOT EXISTS finance_entries_salon_kind_idx
  ON finance_entries (salon_id, kind);

CREATE UNIQUE INDEX IF NOT EXISTS finance_entries_booking_unique_idx
  ON finance_entries (salon_id, booking_id)
  WHERE booking_id IS NOT NULL;

COMMENT ON TABLE finance_entries IS 'FOP ledger: income/expense rows with payment method for IBAN/cash tracking';
