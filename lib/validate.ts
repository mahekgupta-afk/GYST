// The one place that decides whether an entered value is acceptable. Chat (built-in and Gemini paths), quick replies,
// "Fix it here" inputs, the editable table and uploaded sheets all call these functions, so the rules cannot drift apart.
// Deterministic code only: nothing here, and nothing that calls it, lets a language model decide validity.

export type FieldKey = 'pallets' | 'cartons' | 'declaredValue' | 'grossWeight' | 'qty' | 'price' | 'upc' | 'itemCartons' | 'unitWeight';

type FieldInfo = {
  label: string;            // used in messages
  column: string;           // spreadsheet column heading
  sheet: 'Bookings' | 'Items';
  whole: boolean;           // counts must be whole numbers
  ask: string;              // what to ask the seller when it is rejected
  /** Rule checks that depend on this value and are skipped while it is invalid. */
  affects: string[];
};

export const FIELDS: Record<FieldKey, FieldInfo> = {
  pallets: { label: 'Pallets', column: 'Pallets', sheet: 'Bookings', whole: true, ask: 'How many pallets are you sending?', affects: ['R-05'] },
  cartons: { label: 'Cartons', column: 'Cartons', sheet: 'Bookings', whole: true, ask: 'How many cartons are there in total?', affects: ['R-04'] },
  declaredValue: { label: 'Total declared value', column: 'Total declared value', sheet: 'Bookings', whole: false, ask: 'What is the total declared value, in £?', affects: ['R-02'] },
  grossWeight: { label: 'Total gross weight', column: 'Total gross weight (kg)', sheet: 'Bookings', whole: false, ask: 'What is the total gross weight, in kg?', affects: ['R-05', 'R-07'] },
  qty: { label: 'Quantity', column: 'Quantity (units)', sheet: 'Items', whole: true, ask: 'How many units are you sending?', affects: ['R-02', 'R-03', 'R-07'] },
  price: { label: 'Unit price', column: 'Unit price', sheet: 'Items', whole: false, ask: 'What is the price per unit, in £?', affects: ['R-02'] },
  upc: { label: 'Units per carton', column: 'Units per carton', sheet: 'Items', whole: true, ask: 'How many units go in each carton?', affects: ['R-03'] },
  itemCartons: { label: 'Cartons', column: 'Cartons', sheet: 'Items', whole: true, ask: 'How many cartons of this product are there?', affects: ['R-03', 'R-04'] },
  unitWeight: { label: 'Unit weight', column: 'Unit weight (kg)', sheet: 'Items', whole: false, ask: 'How much does one unit weigh, in kg?', affects: ['R-07'] },
};

const WORDS: Record<string, number> = { zero: 0, nil: 0, nought: 0, none: 0, no: 0, nothing: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

export type Parsed = { kind: 'number'; n: number } | { kind: 'blank' } | { kind: 'text'; text: string };

/**
 * Reads a number from a cell or from typed text: 5, "1,080", "£5.00", "-0". With `words` (chat only) it also reads "zero", "none", "minus 3" and "three".
 * Uploaded cells and typed inputs leave `words` off, so text stays text and is reported as not a number.
 */
export function parseNumeric(raw: unknown, words = false): Parsed {
  if (raw === null || raw === undefined) return { kind: 'blank' };
  if (typeof raw === 'number') return Number.isFinite(raw) ? { kind: 'number', n: raw === 0 ? 0 : raw } : { kind: 'text', text: String(raw) };
  const s = String(raw).trim();
  if (s === '') return { kind: 'blank' };
  const low = s.toLowerCase().replace(/\s+/g, ' ');
  const minus = !words ? null : /^(?:minus|negative)\s+(\d[\d,]*(?:\.\d+)?)$/.exec(low);
  if (minus) return { kind: 'number', n: -parseFloat(minus[1].replace(/,/g, '')) };
  if (words && /^(?:no|none|nil|zero|nought|nothing)(?:\s+\w+)?$/.test(low)) return { kind: 'number', n: 0 };
  if (words && Object.prototype.hasOwnProperty.call(WORDS, low)) return { kind: 'number', n: WORDS[low] };
  const cleaned = low.replace(/[£,\s]/g, '').replace(/gbp|kgs?|kilos?|pounds?|units?/g, '');
  if (/^-?\d*\.?\d+$/.test(cleaned)) { const n = parseFloat(cleaned); return Number.isFinite(n) ? { kind: 'number', n: n === 0 ? 0 : n } : { kind: 'text', text: s }; }
  return { kind: 'text', text: s };
}

export type NumCheck =
  | { ok: true; value: number }
  | { ok: false; reason: 'blank' | 'not-number' | 'zero' | 'negative' | 'fraction'; shown: string };

/** Counts must be whole numbers greater than 0. Weights, prices and the declared value must be greater than 0. */
export function checkNumber(field: FieldKey, raw: unknown, words = false): NumCheck {
  const p = parseNumeric(raw, words);
  if (p.kind === 'blank') return { ok: false, reason: 'blank', shown: '' };
  if (p.kind === 'text') return { ok: false, reason: 'not-number', shown: p.text };
  if (p.n === 0) return { ok: false, reason: 'zero', shown: '0' };
  if (p.n < 0) return { ok: false, reason: 'negative', shown: String(p.n) };
  if (FIELDS[field].whole && !Number.isInteger(p.n)) return { ok: false, reason: 'fraction', shown: String(p.n) };
  return { ok: true, value: p.n };
}

const need = (field: FieldKey) => (FIELDS[field].whole ? 'Enter a whole number greater than 0.' : 'Enter a number greater than 0.');

/** Message for an uploaded cell: names the value and what to enter. The caller adds sheet, row and column. */
export function inputErrorText(field: FieldKey, c: Extract<NumCheck, { ok: false }>): string {
  const f = FIELDS[field];
  if (c.reason === 'blank') return `${f.label} is blank. ${need(field)}`;
  if (c.reason === 'not-number') return `${f.label} is “${c.shown}”, which isn’t a number. ${need(field)}`;
  if (c.reason === 'fraction') return `${f.label} is ${c.shown}, but it must be a whole number. ${need(field)}`;
  return `${f.label} is ${c.shown}. ${need(field)}`;
}

/** Short reason for an inline error under a "Fix it here" box. */
export function inlineError(field: FieldKey, raw: unknown): string | null {
  const c = checkNumber(field, raw);
  if (c.ok) return null;
  if (c.reason === 'blank') return 'Enter a value.';
  if (c.reason === 'not-number') return 'That isn’t a number.';
  return need(field).replace('Enter', 'Must be');
}

/** Reply for the chat: says which field was rejected and why, then asks again. */
export function chatRejection(field: FieldKey, c: Extract<NumCheck, { ok: false }>): string {
  const f = FIELDS[field];
  const name = f.label.replace(/^Total /, '').toLowerCase();
  const cap = name.charAt(0).toUpperCase() + name.slice(1);
  if (c.reason === 'fraction') return `${cap} must be a whole number (${c.shown} isn’t possible). ${f.ask}`;
  if (c.reason === 'not-number') return `I couldn’t read “${c.shown}” as a number for ${name}. ${f.ask}`;
  return `${cap} can’t be 0 or negative. ${f.ask}`;
}

// ---------------- HS codes ----------------
export type HsCheck =
  | { ok: true; value: string | null; blank: boolean }
  | { ok: false; reason: 'zeros' | 'negative' | 'invalid'; raw: string };

/**
 * Spaces and dots are ignored. Only digits are allowed, and not all zeros. Leading zeros are fine when a non-zero digit follows ("090111").
 * Length is not checked here: a short code is still stored and flagged by R-01.
 */
export function checkHs(raw: unknown): HsCheck {
  if (raw === null || raw === undefined || String(raw).trim() === '') return { ok: true, value: null, blank: true };
  const shown = String(raw).trim();
  const s = shown.replace(/[\s.]/g, '');
  if (/^[-−–]/.test(s)) return { ok: false, reason: 'negative', raw: shown };
  if (!/^\d+$/.test(s)) return { ok: false, reason: 'invalid', raw: shown };
  if (/^0+$/.test(s)) return { ok: false, reason: 'zeros', raw: shown };
  return { ok: true, value: s, blank: false };
}

export const hsZerosText = (sku: string | null | undefined, raw: string) =>
  `${sku || 'This item'} has the HS code “${raw}”, which is all zeros. Enter a real code of at least 6 digits from the UK Trade Tariff.`;

export function chatHsRejection(c: Extract<HsCheck, { ok: false }>): string {
  if (c.reason === 'zeros') return `“${c.raw}” is all zeros, which isn’t a real HS code, so I haven’t saved it. What is the real code? It needs at least 6 digits from the UK Trade Tariff.`;
  if (c.reason === 'negative') return `An HS code can’t be negative, so I haven’t saved “${c.raw}”. What is the real code? It needs at least 6 digits.`;
  return `“${c.raw}” isn’t a valid HS code (digits only), so I haven’t saved it. What is the real code? It needs at least 6 digits from the UK Trade Tariff.`;
}

// ---------------- ready date ----------------
export type DateCheck = { ok: true } | { ok: false; reason: 'unreadable' | 'past'; message: string };
const dmy = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}-${m}-${y}`; };

/** Today is allowed. Anything earlier is not. `today` is the browser's local date (YYYY-MM-DD). */
export function checkReadyDate(iso: string | null | undefined, today: string): DateCheck {
  if (!iso) return { ok: false, reason: 'unreadable', message: 'Enter the date as DD-MM-YYYY.' };
  if (iso < today) return { ok: false, reason: 'past', message: `That date is in the past. Today is ${dmy(today)}. What date will the goods be ready?` };
  return { ok: true };
}

// ---------------- reading claims out of free text ----------------
export type Claim = { field: FieldKey | 'hs'; raw: string };

const N = '(?:minus\\s+\\d[\\d,]*(?:\\.\\d+)?|-\\s?\\d[\\d,]*(?:\\.\\d+)?|\\d[\\d,]*(?:\\.\\d+)?|\\.\\d+|zero|nil|nought|none|no|an?|one|two|three|four|five|six|seven|eight|nine|ten)';
const NQ = '(?:minus\\s+\\d[\\d,]*(?:\\.\\d+)?|-\\s?\\d[\\d,]*(?:\\.\\d+)?|\\d[\\d,]*(?:\\.\\d+)?|\\.\\d+|zero|nil|nought|none|no)';
const IS = '(?:\\s+(?:is|are|was|will\\s+be)|\\s*[:=]|\\s+of|\\s+to|\\s+at)?';

const PATTERNS: { field: FieldKey; re: RegExp }[] = [
  // order matters: more specific phrases first, each match is blanked out so it is not counted twice
  { field: 'upc', re: new RegExp(`(${N})\\s*(?:units?|pcs|pieces)?\\s*(?:per|to\\s+a|in\\s+(?:a|each)|a|each|/)\\s*carton`, 'gi') },
  { field: 'upc', re: new RegExp(`units?\\s+per\\s+carton${IS}\\s*(${N})`, 'gi') },
  { field: 'unitWeight', re: new RegExp(`(${N})\\s*(?:kg|kgs|kilos?|g|grams?)\\s*(?:each|per\\s+(?:unit|item|piece)|a\\s+piece|apiece)`, 'gi') },
  { field: 'unitWeight', re: new RegExp(`unit\\s+weight${IS}\\s*(${N})`, 'gi') },
  { field: 'price', re: new RegExp(`(?:at|@|for)\\s*£?\\s*(${N})\\s*(?:gbp|pounds?|quid|£)?\\s*(?:each|per\\s+(?:unit|item|piece)|a\\s+piece|apiece)`, 'gi') },
  { field: 'price', re: new RegExp(`£\\s*(${N})\\s*(?:each|per\\s+(?:unit|item|piece)|a\\s+piece|apiece)`, 'gi') },
  { field: 'price', re: new RegExp(`(${N})\\s*(?:gbp|pounds?)\\s*(?:each|per\\s+(?:unit|item|piece)|apiece)`, 'gi') },
  { field: 'price', re: new RegExp(`unit\\s+price${IS}\\s*£?\\s*(${N})`, 'gi') },
  { field: 'grossWeight', re: new RegExp(`gross\\s+weight${IS}\\s*(${N})`, 'gi') },
  { field: 'grossWeight', re: new RegExp(`(${N})\\s*(?:kg|kgs|kilos?)\\s+(?:gross|in\\s+total|total)`, 'gi') },
  { field: 'declaredValue', re: new RegExp(`declared(?:\\s+(?:value|at|as))?${IS}\\s*£?\\s*(${N})`, 'gi') },
  { field: 'declaredValue', re: new RegExp(`(?:total\\s+)?value\\s+(?:is|of)\\s*£?\\s*(${N})`, 'gi') },
  { field: 'pallets', re: new RegExp(`(?:remove|delete|drop|take\\s+off)\\s+all\\s+(?:of\\s+)?(?:the\\s+)?pallets?()`, 'gi') },
  { field: 'pallets', re: new RegExp(`(${N})\\s+(?:more\\s+|extra\\s+|additional\\s+|total\\s+)?pallets?`, 'gi') },
  { field: 'pallets', re: new RegExp(`pallets?${IS}\\s*(${NQ})`, 'gi') },
  { field: 'cartons', re: new RegExp(`(${N})\\s+(?:more\\s+|extra\\s+|additional\\s+|total\\s+)?cartons?`, 'gi') },
  { field: 'cartons', re: new RegExp(`(?:total\\s+)?cartons?${IS}\\s*(${NQ})`, 'gi') },
  { field: 'qty', re: new RegExp(`quantity${IS}\\s*(${NQ})`, 'gi') },
  { field: 'qty', re: new RegExp(`(${NQ})\\s+(?:units?|pcs|pieces)\\b`, 'gi') },
];

/** Finds every number the seller attached to a covered field in a message, including zero, negative and word forms. */
export function scanClaims(text: string): Claim[] {
  let work = text.replace(/[‘’]/g, "'").replace(/−/g, '-');
  const out: Claim[] = [];
  for (const { field, re } of PATTERNS) {
    work = work.replace(re, (m, g1) => {
      out.push({ field, raw: g1 === '' ? 'zero' : String(g1).replace(/\s+/g, ' ').trim() });
      return ' '.repeat(m.length);
    });
  }
  // HS code: "HS 000000", "HS code is -691200", "hs code: 69A200"
  const hs = /\b(?:hs|tariff|commodity)(?:\s*code)?\s*(?:is|=|:)?\s*(-?[A-Za-z0-9][A-Za-z0-9.\s-]{0,18}?)(?=[,;]|\s+(?:and|but|made|from|at|per|each)\b|$|\.\s)/i.exec(work);
  if (hs && /\d/.test(hs[1])) out.push({ field: 'hs', raw: hs[1].trim() });
  return out;
}

export type Rejection = { field: FieldKey | 'hs' | 'readyDate'; message: string };

/** Checks every claim in a message. Returns the ones to refuse, each with the sentence to show the seller. */
export function rejectedClaims(text: string): Rejection[] {
  const seen = new Set<string>();
  const out: Rejection[] = [];
  for (const c of scanClaims(text)) {
    if (seen.has(c.field)) continue;
    if (c.field === 'hs') {
      const h = checkHs(c.raw);
      if (!h.ok) { seen.add('hs'); out.push({ field: 'hs', message: chatHsRejection(h) }); }
    } else {
      const k = checkNumber(c.field, c.raw, true);
      if (!k.ok && k.reason !== 'blank') { seen.add(c.field); out.push({ field: c.field, message: chatRejection(c.field, k) }); }
    }
  }
  return out;
}
