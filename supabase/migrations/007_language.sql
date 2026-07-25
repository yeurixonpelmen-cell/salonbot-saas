-- Salon default bot language + per-user Telegram language override

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'uk';

ALTER TABLE salons
  DROP CONSTRAINT IF EXISTS salons_language_check;

ALTER TABLE salons
  ADD CONSTRAINT salons_language_check
  CHECK (language IN ('uk', 'ru', 'en'));

CREATE TABLE IF NOT EXISTS bot_user_prefs (
  salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  telegram_id BIGINT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('uk', 'ru', 'en')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (salon_id, telegram_id)
);

CREATE INDEX IF NOT EXISTS bot_user_prefs_telegram_idx
  ON bot_user_prefs (telegram_id);

COMMENT ON COLUMN salons.language IS 'Default bot language for this salon: uk | ru | en';
COMMENT ON TABLE bot_user_prefs IS 'Per Telegram user language override inside a salon bot';