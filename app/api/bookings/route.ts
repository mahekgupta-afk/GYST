import { dbEnabled, db, ensureSchema, withTimeout } from '@/lib/server/db';
import { allow, clientIp } from '@/lib/server/rateLimit';
import { checkBooking, newReference, referenceFor } from '@/lib/server/booking';

export const maxDuration = 20;   // seconds: the browser gives up after 15, so a stuck request is cut off here too

/**
 * Records a confirmed booking. The server re-checks the booking against the rulebook and refuses
 * anything with a red issue (422). With no database configured the booking is still validated and
 * given a reference, but is reported as not saved.
 *
 * Idempotent: the browser sends the same `key` when it retries the same booking, so a request that
 * timed out on the browser side but succeeded here cannot create a second booking. The same key
 * always returns the first booking's reference.
 */
export async function POST(req: Request) {
  if (!allow(clientIp(req), 30)) return Response.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });

  const chk = checkBooking(body.booking, typeof body.today === 'string' ? body.today : undefined);
  if (!chk.ok) return Response.json({ ok: false, error: chk.error, red: chk.red, problems: chk.problems }, { status: chk.status });

  const { ev, clean } = chk;
  const sel = ev.rec.selected;
  const total = sel.price * ev.rec.pallets;
  const source = body.source === 'upload' ? 'upload' : 'chat';
  const fileName = typeof body.fileName === 'string' ? body.fileName.slice(0, 200) : null;
  const key = typeof body.key === 'string' && /^[\w-]{8,80}$/.test(body.key) ? body.key : null;
  const changes = Array.isArray(clean._changes) ? clean._changes : [];
  delete clean._changes;
  const reference = key ? referenceFor(key) : newReference();

  if (!dbEnabled()) return Response.json({ ok: true, saved: false, reference, carrier: sel.carrier, total });

  try {
    const result = await withTimeout((async () => {
      await ensureSchema();
      const rows = (await db()`
        INSERT INTO bookings (reference, booking_id, seller, source, file_name, carrier, pallets, total_gbp, amber_count, booking, changes, idempotency_key)
        VALUES (${reference}, ${String(clean.id ?? '')}, ${clean.seller ?? null}, ${source}, ${fileName}, ${sel.carrier}, ${ev.rec.pallets}, ${total}, ${ev.counts.amber},
                ${JSON.stringify(clean)}::jsonb, ${JSON.stringify(changes)}::jsonb, ${key})
        ON CONFLICT DO NOTHING
        RETURNING reference`) as { reference: string }[];
      if (rows.length) return { reference: rows[0].reference, duplicate: false };
      // Nothing inserted: this key (or reference) was already booked. Return that booking.
      const prior = (key ? await db()`SELECT reference FROM bookings WHERE idempotency_key = ${key} LIMIT 1` : await db()`SELECT reference FROM bookings WHERE reference = ${reference} LIMIT 1`) as { reference: string }[];
      if (prior.length) return { reference: prior[0].reference, duplicate: true };
      throw new Error('not_inserted');
    })(), 12000);
    return Response.json({ ok: true, saved: true, duplicate: result.duplicate, reference: result.reference, carrier: sel.carrier, total });
  } catch (e) {
    const timedOut = e instanceof Error && e.message === 'db_timeout';
    console.error('neon error:', e instanceof Error ? e.message.slice(0, 300) : e);
    return Response.json({ ok: false, error: timedOut ? 'timeout' : 'db_error' }, { status: timedOut ? 504 : 502 });
  }
}
