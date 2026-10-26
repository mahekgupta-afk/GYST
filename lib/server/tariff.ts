import { classify, parseHeading, digitsOf, type HsResult, type HsSuggestion, type TariffHeading } from '../hs';

// The UK Trade Tariff is public and needs no key (https://www.trade-tariff.service.gov.uk/api/v2). It is called from the server only,
// with a short timeout and a cache, and any failure becomes "could not verify": it never throws into the booking flow.
const BASE = 'https://www.trade-tariff.service.gov.uk/api/v2';
const TIMEOUT_MS = 5000;
const HEADING_TTL = 24 * 3600_000, SEARCH_TTL = 3600_000, MAX = 300;

type Entry<T> = { at: number; value: T };
const headings = new Map<string, Entry<TariffHeading | null>>();
const searches = new Map<string, Entry<HsSuggestion[]>>();
const fresh = <T,>(m: Map<string, Entry<T>>, k: string, ttl: number): T | undefined => { const e = m.get(k); return e && Date.now() - e.at < ttl ? e.value : undefined; };
const put = <T,>(m: Map<string, Entry<T>>, k: string, v: T) => { if (m.size >= MAX) m.delete(m.keys().next().value as string); m.set(k, { at: Date.now(), value: v }); };
export const clearTariffCache = () => { headings.clear(); searches.clear(); };

async function get(path: string): Promise<{ status: number; json: any } | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, { headers: { Accept: 'application/json' }, signal: ctl.signal });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  } catch { return null; } finally { clearTimeout(t); }
}

/** The heading for the first four digits: the heading, null if the tariff has no such heading, undefined if it could not be reached. */
export async function headingFor(h4: string): Promise<TariffHeading | null | undefined> {
  const hit = fresh(headings, h4, HEADING_TTL);
  if (hit !== undefined) return hit;
  const r = await get('/headings/' + h4);
  if (!r) return undefined;
  if (r.status === 404) { put(headings, h4, null); return null; }
  if (r.status !== 200) return undefined;
  const parsed = parseHeading(r.json);
  if (!parsed) return undefined;
  put(headings, h4, parsed);
  return parsed;
}

/** Verifies a code. Always resolves: an unreachable or odd tariff gives the state "unavailable". */
export async function verifyCode(raw: unknown): Promise<HsResult> {
  const code = digitsOf(raw);
  if (!code) return classify('', null);
  if (!/^\d+$/.test(code)) return classify(code, null);
  if (code.length < 4) return classify(code, null);
  return classify(code, await headingFor(code.slice(0, 4)));
}

const isHeadingId = (s: string) => /^\d{4}$/.test(s);

/** Suggests codes for a description: up to six headings or commodities, best first. */
export async function searchCodes(q: string): Promise<{ ok: boolean; suggestions: HsSuggestion[] }> {
  // The tariff's search wants the product's own name, so a long description that finds nothing is retried with its last words
  // ("cotton tote bag" -> "tote bag" -> "bag"), keeping the noun at the end.
  const words = q.trim().split(/\s+/).filter(Boolean);
  for (let from = 0; from < Math.min(words.length, 3); from++) {
    const r = await searchOnce(words.slice(from).join(' '));
    if (!r.ok || r.suggestions.length) return r;
  }
  return { ok: true, suggestions: [] };
}

async function searchOnce(q: string): Promise<{ ok: boolean; suggestions: HsSuggestion[] }> {
  const key = q.trim().toLowerCase();
  const hit = fresh(searches, key, SEARCH_TTL);
  if (hit) return { ok: true, suggestions: hit };
  const r = await get('/search?q=' + encodeURIComponent(q.trim()));
  if (!r || r.status !== 200 || !r.json || !r.json.data) return { ok: false, suggestions: [] };
  const a = r.json.data.attributes || {};
  const out: HsSuggestion[] = [];
  const add = (s: HsSuggestion) => { if (s.code && !out.some(o => o.code === s.code)) out.push(s); };
  if (a.type === 'exact_match' && a.entry && typeof a.entry.id === 'string') {
    const id = a.entry.id;
    if (a.entry.endpoint === 'headings' && isHeadingId(id)) { const h = await headingFor(id); if (h) add({ code: id, kind: 'heading', title: h.description }); }
    else if (a.entry.endpoint === 'commodities' && /^\d{10}$/.test(id)) { const h = await headingFor(id.slice(0, 4)); const i = h ? h.commodities.findIndex(c => c.code === id && c.leaf) : -1; if (h && i >= 0) add({ code: id, kind: 'commodity', title: h.commodities[i].description }); }
  } else if (a.type === 'fuzzy_match') {
    const ref = a.reference_match || {}, gm = a.goods_nomenclature_match || {};
    const kinds = [['headings', 'heading'], ['commodities', 'commodity']] as const;
    for (const [list, kind] of kinds) for (const h of (ref[list] || [])) {
      const id = h && h._source && h._source.reference && h._source.reference.goods_nomenclature_item_id;
      if (typeof id === 'string') add(kind === 'heading' ? { code: id.slice(0, 4), kind, title: String(h._source.title || '') } : { code: id, kind, title: String(h._source.title || '') });
    }
    for (const [list, kind] of kinds) for (const h of (gm[list] || [])) {
      const s = h && h._source, id = s && s.goods_nomenclature_item_id;
      if (typeof id === 'string') add(kind === 'heading' ? { code: id.slice(0, 4), kind, title: String(s.description || '') } : { code: id, kind, title: String(s.description || '') });
    }
  }
  const suggestions = out.filter(s => s.title).slice(0, 6);
  put(searches, key, suggestions);
  return { ok: true, suggestions };
}
