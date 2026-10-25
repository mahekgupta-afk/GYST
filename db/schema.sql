-- Created automatically on first save (lib/server/db.ts). Kept here for reference.
CREATE TABLE IF NOT EXISTS uploads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  filename       text NOT NULL,
  size_bytes     integer NOT NULL,
  sha256         text NOT NULL UNIQUE,   -- identical files are stored once
  file           bytea NOT NULL,         -- the original spreadsheet
  booking_count  integer NOT NULL,
  red_count      integer NOT NULL,       -- bookings on hold
  amber_count    integer NOT NULL,       -- bookings with warnings
  clear_count    integer NOT NULL,
  results        jsonb NOT NULL          -- per-booking verdict and issues from the rules engine
);
CREATE INDEX IF NOT EXISTS uploads_created_at_idx ON uploads (created_at DESC);
