import { fetchJson } from './net';
import { digitsOf, type HsResult, type HsSuggestion } from './hs';

// Browser side of the HS lookup. It talks to our own /api/hs (never to the tariff directly) and never throws:
// any failure is "unavailable", which the page shows as "could not verify" without affecting the booking.
const TIMEOUT = 8000;
const unavailable = (code: string): HsResult => ({ code, state: 'unavailable', description: null, heading: null, children: [] });
const memo = new Map<string, HsResult>();
export const clearHsClientCache = () => memo.clear();

export async function verifyHs(raw: unknown): Promise<HsResult> {
  const code = digitsOf(raw);
  if (!code) return { code: '', state: 'blank', description: null, heading: null, children: [] };
  const hit = memo.get(code);
  if (hit) return hit;
  try {
    const { res, json } = await fetchJson('/api/hs?code=' + encodeURIComponent(code), {}, TIMEOUT);
    if (!res.ok || !json || !json.result) return unavailable(code);
    const r = json.result as HsResult;
    if (r.state !== 'unavailable') memo.set(code, r);          // a failed lookup is never remembered
    return r;
  } catch { return unavailable(code); }
}

export async function suggestHs(q: string): Promise<{ ok: boolean; suggestions: HsSuggestion[] }> {
  const text = q.trim();
  if (text.length < 3) return { ok: true, suggestions: [] };
  try {
    const { res, json } = await fetchJson('/api/hs?q=' + encodeURIComponent(text.slice(0, 80)), {}, TIMEOUT);
    if (!res.ok || !json || !Array.isArray(json.suggestions)) return { ok: false, suggestions: [] };
    return { ok: !!json.ok, suggestions: json.suggestions };
  } catch { return { ok: false, suggestions: [] }; }
}
