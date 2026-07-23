-- Allow web bookings without Telegram user id
ALTER TABLE bookings
  ALTER COLUMN client_telegram_id DROP NOT NULL;
