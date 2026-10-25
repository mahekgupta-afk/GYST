import { neon } from '@neondatabase/serverless';

/** Neon is optional: with no DATABASE_URL the app works and simply skips saving. */
export const dbEnabled = () => !!process.env.DATABASE_URL;

let sql: ReturnType<typeof neon> | null = null;
let ready: Promise<void> | null = null;

export function db() {
  return (sql ??= neon(process.env.DATABASE_URL as string));
}

/** Creates the table on first use so there is no separate migration step. */
export function ensureSchema(): Promise<void> {
  return (ready ??= (async () => {
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
  })().catch(e => { ready = null; throw e; }));
}
