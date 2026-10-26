// HS / commodity code verification against the UK Trade Tariff. This is an ADVISORY layer on top of rule R-01:
// R-01 (at least 6 digits, Red if broken) is untouched and still decides pass or fail. Nothing here blocks a booking.

export type HsState = 'verified' | 'six-digits' | 'partial' | 'not-found' | 'unavailable' | 'short' | 'blank';

export type HsChild = { code: string; description: string };
export type HsResult = {
  code: string;                 // digits only
  state: HsState;
  description: string | null;   // the official description (the heading, or the full chain for a declarable code)
  heading: string | null;       // the heading's own description
  children: HsChild[];          // declarable 10-digit codes under this code, with their official descriptions
};
export type HsSuggestion = { code: string; kind: 'heading' | 'commodity'; title: string };

export type TariffCommodity = { code: string; suffix: string; description: string; indents: number; leaf: boolean };
export type TariffHeading = { id: string; description: string; commodities: TariffCommodity[] };

/** Digits only. Spaces and dots in a code such as "6912.00 2100" are allowed and removed. */
export const digitsOf = (raw: unknown): string => String(raw ?? '').replace(/[\s.]/g, '');

const strip = (s: unknown) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

/** Reads the Trade Tariff's /headings/{4 digits} response. Returns null if it is not in the expected shape. */
export function parseHeading(json: any): TariffHeading | null {
  const a = json && json.data && json.data.attributes;
  if (!a || typeof a.goods_nomenclature_item_id !== 'string') return null;
  const commodities: TariffCommodity[] = (Array.isArray(json.included) ? json.included : [])
    .filter((x: any) => x && x.type === 'commodity' && x.attributes && typeof x.attributes.goods_nomenclature_item_id === 'string')
    .map((x: any) => ({
      code: x.attributes.goods_nomenclature_item_id, suffix: String(x.attributes.producline_suffix ?? ''),
      description: strip(x.attributes.description_plain || x.attributes.description), indents: Number(x.attributes.number_indents ?? 0), leaf: x.attributes.leaf === true,
    }));
  const description = strip(a.description_plain || a.description);
  // A heading with nothing below it (such as 8206) is itself the declarable commodity.
  if (!commodities.length && a.declarable === true) commodities.push({ code: a.goods_nomenclature_item_id, suffix: '80', description, indents: 0, leaf: true });
  return { id: a.goods_nomenclature_item_id.slice(0, 4), description, commodities };
}

/** The official wording for a commodity: the heading, then each parent line down to the commodity itself. */
export function chainFor(h: TariffHeading, idx: number): string {
  const parts: string[] = [];
  let level = h.commodities[idx].indents + 1;
  for (let i = idx; i >= 0; i--) {
    const c = h.commodities[i];
    if (c.indents < level) { parts.unshift(c.description); level = c.indents; if (c.indents <= 0) break; }
  }
  return [h.description, ...parts].join(' › ');
}

const leavesUnder = (h: TariffHeading, prefix: string, cap = 24): HsChild[] => {
  const seen = new Set<string>(), out: HsChild[] = [];
  h.commodities.forEach((c, i) => {
    if (!c.leaf || !c.code.startsWith(prefix) || seen.has(c.code)) return;
    seen.add(c.code); out.push({ code: c.code, description: chainFor(h, i) });
  });
  return out.slice(0, cap);
};

/**
 * Decides the verification state of a code from the heading the tariff returned for its first four digits.
 * `heading` is null when the tariff said the heading does not exist, and undefined when it could not be reached.
 */
export function classify(rawCode: unknown, heading: TariffHeading | null | undefined): HsResult {
  const code = digitsOf(rawCode);
  const base = { code, description: null, heading: null, children: [] as HsChild[] };
  if (!code) return { ...base, state: 'blank' };
  if (!/^\d+$/.test(code)) return { ...base, state: 'not-found' };
  if (heading === undefined) return { ...base, state: 'unavailable' };
  if (code.length < 4) return { ...base, state: 'short' };
  if (heading === null || heading.id !== code.slice(0, 4)) return { ...base, state: 'not-found' };
  const head = { ...base, heading: heading.description, description: heading.description };
  if (code.length < 6) return { ...head, state: 'short', children: leavesUnder(heading, code) };
  if (code.length > 10) return { ...base, state: 'not-found' };
  const idx = heading.commodities.findIndex(c => c.code.startsWith(code));
  if (idx < 0) return { ...base, state: 'not-found' };
  if (code.length === 10) {
    const exact = heading.commodities.findIndex(c => c.code === code && c.leaf);
    if (exact >= 0) return { ...head, state: 'verified', description: chainFor(heading, exact), children: [] };
    return { ...head, state: 'partial', children: leavesUnder(heading, code) };
  }
  return { ...head, state: code.length === 6 ? 'six-digits' : 'partial', children: leavesUnder(heading, code) };
}

const STOP = new Set(['with', 'other', 'than', 'from', 'made', 'that', 'this', 'their', 'parts', 'part', 'articles', 'article', 'goods', 'products', 'product', 'item', 'items', 'used', 'kind', 'type', 'set', 'pack', 'each', 'new']);
const stem = (w: string) => (w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.endsWith('es') && w.length > 4 ? w.slice(0, -2) : w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w);
const words = (s: string) => Array.from(new Set((s.toLowerCase().match(/[a-z]{3,}/g) || []).filter(w => !STOP.has(w)).map(stem)));

/**
 * A soft check that what the seller wrote about an item has something in common with the official wording for its code.
 * It can only produce a gentle warning: it never fails a rule and never blocks a booking.
 */
export function descriptionLooksOff(itemDescription: string | null | undefined, official: string | null | undefined): boolean {
  if (!itemDescription || !official) return false;
  const mine = words(itemDescription), theirs = words(official);
  if (!mine.length || !theirs.length) return false;
  return !mine.some(m => theirs.some(t => t.includes(m) || (t.length >= 4 && m.includes(t))));
}

/** The one-line message for each state, in plain English. */
export function hsMessage(r: HsResult): string {
  switch (r.state) {
    case 'verified': return 'Found in the UK Tariff.';
    case 'six-digits': return 'This is a 6-digit code. A full 8 to 10 digit commodity code is usually needed on a customs declaration. Pick one below.';
    case 'partial': return 'This code is real but not a complete commodity code. A full 10 digit code is usually needed on a customs declaration.';
    case 'short': return 'This code is too short to check against the tariff. Rule R-01 needs at least 6 digits.';
    case 'not-found': return 'This code was not found in the UK Tariff. Check it, or search for a code by description.';
    case 'unavailable': return 'Could not check this code right now. This does not affect your booking.';
    case 'blank': return 'No code to check.';
  }
}

/** A long official description cut at a word boundary, for buttons and lists. The full text stays available as a tooltip. */
export function shortText(s: string, max = 150): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[,;:\s]+$/, '') + '…';
}
