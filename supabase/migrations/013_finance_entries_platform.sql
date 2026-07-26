-- Platform-owner FOP ledger: salon_id optional (which client paid), not required

ALTER TABLE finance_entries
  ALTER COLUMN salon_id DROP NOT NULL;

COMMENT ON COLUMN finance_entries.salon_id IS
  'Optional related salon for platform income; null for general FOP income/expense';
