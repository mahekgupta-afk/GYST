import { dbEnabled, db, ensureSchema, withTimeout } from '@/lib/server/db';
import { allow, clientIp } from '@/lib/server/rateLimit';
import { KEY_PATTERN, REF_PATTERN, keyMatches } from '@/lib/server/access';

export const maxDuration = 20;

const notFound = () => Response.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

/**
 * Opens a saved booking confirmation. It needs the reference AND the secret key that was in the link, so someone who only
 * knows or guesses a reference learns nothing. A wrong reference, a wrong key and a missing booking all look the same.
 */
export async function GET(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  if (!allow(clientIp(req), 20)) return Response.json({ error: 'rate_limited' }, { status: 429 });
  const { ref } = await ctx.params;
  const k = new URL(req.url).searchParams.get('k') || '';
  if (!REF_PATTERN.test(ref) || !KEY_PATTERN.test(k)) return notFound();
  if (!dbEnabled()) return Response.json({ error: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  try {
    const rows = await withTimeout((async () => {
      await ensureSchema();
      return (await db()`SELECT confirmation, access_key FROM bookings WHERE reference = ${ref} LIMIT 1`) as { confirmation: unknown; access_key: string | null }[];
    })(), 12000);
    if (!rows.length || !rows[0].confirmation || !keyMatches(rows[0].access_key, k)) return notFound();
    return Response.json({ confirmation: rows[0].confirmation }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('neon error:', e instanceof Error ? e.message.slice(0, 300) : e);
    return Response.json({ error: 'unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
