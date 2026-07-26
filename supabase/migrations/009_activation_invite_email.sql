-- Email the activation code is sent to (1 code = 1 invite email)

ALTER TABLE activation_codes
  ADD COLUMN IF NOT EXISTS invite_email TEXT;

CREATE INDEX IF NOT EXISTS activation_codes_invite_email_idx
  ON activation_codes (lower(invite_email));
