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

-- Confirmed bookings. The server re-runs the rules engine and refuses any booking with red issues.
CREATE TABLE IF NOT EXISTS bookings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  reference   text NOT NULL UNIQUE,
  booking_id  text NOT NULL,
  seller      text,
  source      text NOT NULL,          -- 'chat' or 'upload'
  file_name   text,
  carrier     text NOT NULL,
  pallets     integer NOT NULL,
  total_gbp   numeric NOT NULL,
  amber_count integer NOT NULL,       -- warnings the user accepted
  status      text NOT NULL DEFAULT 'booked',
  booking     jsonb NOT NULL,         -- the final, corrected booking
  changes     jsonb NOT NULL          -- every correction: rule, field, was, now
);
CREATE INDEX IF NOT EXISTS bookings_created_at_idx ON bookings (created_at DESC);
