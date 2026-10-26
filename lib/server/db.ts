import { neon } from '@neondatabase/serverless';

/** Neon is optional: with no DATABASE_URL the app works and simply skips saving. */
export const dbEnabled = () => !!process.env.DATABASE_URL;

let sql: ReturnType<typeof neon> | null = null;
let ready: Promise<void> | null = null;

/** Rejects after `ms`. Used so a stalled database connection can never hold a request open. */
export const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => { const t = setTimeout(() => reject(new Error('db_timeout')), ms); p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); }); });

export function db() {
  return (sql ??= neon(process.env.DATABASE_URL as string));
}

/** Creates the table on first use so there is no separate migration step. */
export function ensureSchema(): Promise<void> {
  // A stalled or failed setup is dropped (ready = null), so the next request tries again instead of waiting on it forever.
  return (ready ??= withTimeout((async () => {
    const q = db();
    await q`CREATE TABLE IF NOT EXISTS uploads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      filename text NOT NULL,
      size_bytes integer NOT NULL,
      sha256 text NOT NULL UNIQUE,
      file bytea NOT NULL,
      booking_count integer NOT NULL,
      red_count integer NOT NULL,
      amber_count integer NOT NULL,
      clear_count integer NOT NULL,
      results jsonb NOT NULL
    )`;
    await q`CREATE INDEX IF NOT EXISTS uploads_created_at_idx ON uploads (created_at DESC)`;
    await q`CREATE TABLE IF NOT EXISTS bookings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL DEFAULT now(),
      reference text NOT NULL UNIQUE,
      booking_id text NOT NULL,
      seller text,
      source text NOT NULL,
      file_name text,
      carrier text NOT NULL,
      pallets integer NOT NULL,
      total_gbp numeric NOT NULL,
      amber_count integer NOT NULL,
      status text NOT NULL DEFAULT 'booked',
      booking jsonb NOT NULL,
      changes jsonb NOT NULL
    )`;
    await q`CREATE INDEX IF NOT EXISTS bookings_created_at_idx ON bookings (created_at DESC)`;
    await q`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS idempotency_key text`;
    await q`CREATE UNIQUE INDEX IF NOT EXISTS bookings_idempotency_key_idx ON bookings (idempotency_key)`;
    // The confirmation as it was when booked, and the secret that opens it from a link.
    await q`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirmation jsonb`;
    await q`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS access_key text`;
  })(), 8000).catch(e => { ready = null; throw e; }));
}
