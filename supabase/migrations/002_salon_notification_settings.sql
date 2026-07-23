-- Per-salon notification toggles + post-visit Google review request

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS reminders_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS review_request_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_maps_url TEXT;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS review_request_sent BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN salons.reminders_enabled IS 'Send Telegram reminders 24h and 2h before booking';
COMMENT ON COLUMN salons.review_request_enabled IS 'Ask client for Google Maps review after visit';
COMMENT ON COLUMN salons.google_maps_url IS 'Google Maps / Google Business review URL';
COMMENT ON COLUMN bookings.review_request_sent IS 'Post-visit review request already sent';
