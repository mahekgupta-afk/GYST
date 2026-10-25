# Preflight

UK to EU shipment booking by chat or spreadsheet upload, with a deterministic pre-flight checker (rules R-01 to R-10) and carrier recommendation. See `PREFLIGHT_CONTEXT.md` for the full brief.

## Run

```bash
npm install
cp .env.example .env.local   # add GEMINI_API_KEY (optional; the app works without it)
npm run dev                  # http://localhost:3000
npm test                     # Vitest: rules, parser, real xlsx round-trip
```

## Layout

- `lib/engine/engine.ts` rules, carrier logic, spreadsheet reading. Ported unchanged from the prototype. Pure, no DOM.
- `lib/parse/chat.ts` built-in chat parser and AI-merge helpers. Ported unchanged.
- `lib/pf.ts` typed boundary (the two modules above are `@ts-nocheck`).
- `app/api/parse-message` Gemini call. Returns JSON; the client sanitises it, the engine does all checking.
- `app/api/second-opinion` advisory restricted-goods check (not one of the ten rules).
- `app/api/uploads` saves each uploaded spreadsheet (original file plus per-booking results) to Neon. Optional; skipped when `DATABASE_URL` is unset. No endpoint returns stored files.
- `lib/server/db.ts`, `lib/server/uploads.ts`, `db/schema.sql` Neon access, server-side analysis, table definition (created automatically on first save).
- `components/` React UI. `legacy/` the original prototype scripts, for reference.

## Gemini

Set `GEMINI_API_KEY` in `.env.local` locally and in Vercel project settings for deploys. Optional: `GEMINI_MODEL` (comma-separated fallback chain; default `gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.8-flash`), `GEMINI_DAILY_CAP` (default 400). On any error, 429 or timeout the client falls back to the built-in parser.

## Neon

Set `DATABASE_URL` (the Neon connection string, starting `postgresql://`) in `.env.local` and in Vercel. Stored files can be read in the Neon console SQL editor, for example `select filename, booking_count, red_count, created_at from uploads order by created_at desc;`.
