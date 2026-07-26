-- Manual admin confirmation for client (Telegram/web) bookings.
-- Default OFF = auto-confirm when client picks a free slot.

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS require_booking_confirmation BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN salons.require_booking_confirmation IS
  'If true, client bookings stay pending until admin confirms in Telegram. If false, bookings are confirmed immediately.';
