import { allow, clientIp } from '@/lib/server/rateLimit';
import { searchCodes, verifyCode } from '@/lib/server/tariff';
import { digitsOf } from '@/lib/hs';

export const maxDuration = 15;

/**
 * Advisory help with HS / commodity codes, through the UK Trade Tariff (public, no key).
 *   GET /api/hs?code=691200   verify a code: state, official description, and the full codes under it
 *   GET /api/hs?q=ceramic mug  suggest codes from a description
 * It always answers 200 with a state, even when the tariff cannot be reached ("unavailable"), so nothing downstream breaks.
 * Only the code or the search words are sent on; no booking or seller data leaves the server.
 */
export async function GET(req: Request) {
  if (!allow(clientIp(req), 60)) return Response.json({ error: 'rate_limited' }, { status: 429 });
  const url = new URL(req.url);
  const cache = { 'Cache-Control': 'public, max-age=300, s-maxage=3600' };
  const code = url.searchParams.get('code');
  const q = url.searchParams.get('q');
  if (code !== null) {
    const d = digitsOf(code);
    if (d.length > 14 || !/^\d*$/.test(d)) return Response.json({ error: 'bad_request' }, { status: 400 });
    return Response.json({ result: await verifyCode(d) }, { headers: cache });
  }
  if (q !== null) {
    const text = q.trim();
    if (text.length < 3 || text.length > 80) return Response.json({ error: 'bad_request' }, { status: 400 });
    const r = await searchCodes(text);
    return Response.json({ ok: r.ok, suggestions: r.suggestions }, { headers: r.ok ? cache : { 'Cache-Control': 'no-store' } });
  }
  return Response.json({ error: 'bad_request' }, { status: 400 });
}
