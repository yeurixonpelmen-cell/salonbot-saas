-- Clinic rooms / cabinets (optional per booking)
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rooms_salon_id_idx ON rooms (salon_id);

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS room_id UUID REFERENCES rooms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bookings_salon_room_datetime_idx
  ON bookings (salon_id, room_id, booking_datetime)
  WHERE room_id IS NOT NULL;
