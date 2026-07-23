-- Optional master bio + photo/video portfolio (JSON array)
ALTER TABLE masters
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS portfolio JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN masters.bio IS 'Optional short about-text shown in booking UI';
COMMENT ON COLUMN masters.portfolio IS 'Optional array of {type: photo|video, url, caption?}';
