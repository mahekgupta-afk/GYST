import { dbEnabled, db, ensureSchema, withTimeout } from '@/lib/server/db';
import { allow, clientIp } from '@/lib/server/rateLimit';
import { analyse, MAX_BYTES } from '@/lib/server/uploads';

export async function GET() {
  return Response.json({ enabled: dbEnabled() });
}

/**
 * Saves an uploaded spreadsheet and its rule results to Neon. The page has already shown
 * the user their results, so a failure here is never user-visible: the client ignores it.
 * There is deliberately no endpoint that lists or returns stored files.
 */
export async function POST(req: Request) {
  if (!dbEnabled()) return Response.json({ saved: false, reason: 'disabled' }, { status: 503 });
  if (!allow(clientIp(req), 10)) return Response.json({ saved: false, reason: 'rate_limited' }, { status: 429 });

  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BYTES + 64 * 1024) return Response.json({ saved: false, reason: 'too_large' }, { status: 413 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return Response.json({ saved: false, reason: 'bad_request' }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const a = analyse(file.name, bytes);
  if ('error' in a) return Response.json({ saved: false, reason: a.error }, { status: 422 });

  try {
    await withTimeout(ensureSchema(), 8000);
    const name = file.name.slice(0, 200);
    const rows = (await db()`
      INSERT INTO uploads (filename, size_bytes, sha256, file, booking_count, red_count, amber_count, clear_count, results)
      VALUES (${name}, ${bytes.length}, ${a.sha256}, ${bytes}, ${a.bookingCount}, ${a.red}, ${a.amber}, ${a.clear}, ${JSON.stringify(a.results)}::jsonb)
      ON CONFLICT (sha256) DO NOTHING
      RETURNING id`) as unknown[];
    return Response.json({ saved: true, duplicate: rows.length === 0 });
  } catch (e) {
    console.error('neon error:', e instanceof Error ? e.message.slice(0, 300) : e);
    return Response.json({ saved: false, reason: 'db_error' }, { status: 502 });
  }
}
