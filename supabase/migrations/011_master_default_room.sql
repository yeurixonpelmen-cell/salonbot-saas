-- Default cabinet for a specialist (prefilled on new bookings)

ALTER TABLE masters
  ADD COLUMN IF NOT EXISTS default_room_id UUID REFERENCES rooms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS masters_default_room_id_idx
  ON masters (salon_id, default_room_id)
  WHERE default_room_id IS NOT NULL;

COMMENT ON COLUMN masters.default_room_id IS
  'Preferred room for this master; used as default when creating bookings';
