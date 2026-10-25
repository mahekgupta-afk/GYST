import { dbEnabled, db, ensureSchema } from '@/lib/server/db';
import { allow, clientIp } from '@/lib/server/rateLimit';
import { checkBooking, newReference } from '@/lib/server/booking';

/**
 * Records a confirmed booking. The server re-checks the booking against the rulebook and refuses
 * anything with a red issue (422). With no database configured the booking is still validated and
 * given a reference, but is reported as not saved.
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
  const changes = Array.isArray(clean._changes) ? clean._changes : [];
  delete clean._changes;

  if (!dbEnabled()) return Response.json({ ok: true, saved: false, reference: newReference(), carrier: sel.carrier, total });

  try {
    await ensureSchema();
    for (let attempt = 0; attempt < 3; attempt++) {
      const reference = newReference();
      const rows = (await db()`
        INSERT INTO bookings (reference, booking_id, seller, source, file_name, carrier, pallets, total_gbp, amber_count, booking, changes)
        VALUES (${reference}, ${String(clean.id ?? '')}, ${clean.seller ?? null}, ${source}, ${fileName}, ${sel.carrier}, ${ev.rec.pallets}, ${total}, ${ev.counts.amber},
                ${JSON.stringify(clean)}::jsonb, ${JSON.stringify(changes)}::jsonb)
        ON CONFLICT (reference) DO NOTHING
        RETURNING reference`) as unknown[];
      if (rows.length) return Response.json({ ok: true, saved: true, reference, carrier: sel.carrier, total });
    }
    return Response.json({ ok: false, error: 'db_error' }, { status: 502 });
  } catch (e) {
    console.error('neon error:', e instanceof Error ? e.message.slice(0, 300) : e);
    return Response.json({ ok: false, error: 'db_error' }, { status: 502 });
  }
}
