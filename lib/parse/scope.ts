// Checks a chat message against what can be booked: UK collection cities, EU delivery cities and GBP only.
// Deterministic. It reports problems in the same reply and never lets an unsupported value be stored.

export const ORIGINS = ['London', 'Manchester', 'Birmingham', 'Leeds'];
export const DEST_COUNTRY: Record<string, string> = {
  Berlin: 'Germany', Frankfurt: 'Germany', Hamburg: 'Germany', Paris: 'France', Lyon: 'France', Amsterdam: 'Netherlands', Rotterdam: 'Netherlands',
};
const SUPPORTED_COUNTRIES = ['Germany', 'France', 'Netherlands'];

export const COLLECT_TEXT = 'we collect from London, Manchester, Birmingham and Leeds';
export const DELIVER_TEXT = 'we deliver to Germany (Berlin, Frankfurt, Hamburg), France (Paris, Lyon) and the Netherlands (Amsterdam, Rotterdam)';
export const SUPPORTED_TEXT =
  'I collect from London, Manchester, Birmingham and Leeds, and deliver to Germany (Berlin, Frankfurt, Hamburg), France (Paris, Lyon) and the Netherlands (Amsterdam, Rotterdam).';

// Places that are real but not bookable. Not exhaustive: a capitalised word after "to" or "from" is also flagged
// when the message names no supported place for that role.
const FOREIGN_COUNTRIES = ['spain', 'italy', 'portugal', 'ireland', 'belgium', 'austria', 'switzerland', 'poland', 'czechia', 'czech republic', 'denmark', 'sweden', 'norway', 'finland', 'greece', 'hungary', 'romania', 'bulgaria', 'croatia', 'slovakia', 'slovenia', 'lithuania', 'latvia', 'estonia', 'luxembourg', 'iceland', 'turkey', 'usa', 'united states', 'america', 'canada', 'china', 'india', 'japan', 'australia', 'uae', 'ukraine', 'serbia', 'cyprus', 'malta'];
const FOREIGN_CITIES = ['madrid', 'barcelona', 'valencia', 'seville', 'malaga', 'bilbao', 'rome', 'milan', 'naples', 'turin', 'florence', 'venice', 'brussels', 'antwerp', 'ghent', 'bruges', 'vienna', 'salzburg', 'prague', 'warsaw', 'krakow', 'dublin', 'cork', 'lisbon', 'porto', 'copenhagen', 'stockholm', 'gothenburg', 'oslo', 'helsinki', 'athens', 'budapest', 'zurich', 'geneva', 'basel', 'bern', 'munich', 'cologne', 'dusseldorf', 'düsseldorf', 'stuttgart', 'leipzig', 'dresden', 'nuremberg', 'bremen', 'hanover', 'essen', 'dortmund', 'marseille', 'nice', 'toulouse', 'bordeaux', 'lille', 'nantes', 'strasbourg', 'montpellier', 'utrecht', 'eindhoven', 'the hague', 'den haag', 'groningen', 'new york', 'los angeles', 'chicago', 'toronto', 'dubai', 'singapore', 'shanghai', 'tokyo', 'sydney'];
const UK_OTHER = ['glasgow', 'edinburgh', 'liverpool', 'bristol', 'newcastle', 'sheffield', 'cardiff', 'belfast', 'nottingham', 'leicester', 'southampton', 'aberdeen', 'oxford', 'cambridge', 'coventry', 'brighton', 'plymouth', 'derby', 'york', 'bradford', 'swansea'];
const NOT_PLACES = new Set(['warehouse', 'business', 'address', 'the', 'a', 'an', 'my', 'our', 'your', 'carrier', 'uk', 'united', 'kingdom', 'england', 'scotland', 'wales', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'today', 'tomorrow', 'pallets', 'pallet', 'cartons', 'carton', 'europe', 'eu', 'customer', 'customers', 'client', 'clients', 'amazon', 'fba']);

const cap = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());
const lev = (a: string, b: string) => {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

export type Scope = {
  /** Plain-English problems and notes to show the seller in this same reply. */
  messages: string[];
  /** Do not store a destination from this message (unsupported, or city and country disagree). */
  blockDest: boolean;
  blockOrigin: boolean;
  /** A non-GBP currency was mentioned: do not store money amounts from this message. */
  badCurrency: boolean;
  /** Values safely recovered from a misspelling, such as "Rotterdm". */
  resolved: { originCity?: string; destCity?: string };
};

const wordRe = (w: string) => new RegExp('(?:^|[^A-Za-z])' + w.replace(/\s+/g, '\\s+') + '(?![A-Za-z])', 'i');

export function checkScope(raw: string): Scope {
  const text = raw.replace(/[‘’]/g, "'");
  const out: Scope = { messages: [], blockDest: false, blockOrigin: false, badCurrency: false, resolved: {} };
  const say = (m: string) => { if (!out.messages.includes(m)) out.messages.push(m); };

  // Currency: only GBP is supported.
  if (/€|\$|(?:^|[^A-Za-z])(?:euros?|eur|usd|dollars?|cad|aud|us\s?dollars?)(?![A-Za-z])/i.test(text)) {
    out.badCurrency = true;
    say('I can only work in pounds (GBP). Please give me amounts in £, and I haven’t saved the figures from that message.');
  }

  const supportedDest = Object.keys(DEST_COUNTRY).filter(c => wordRe(c).test(text));
  const supportedOrigin = ORIGINS.filter(c => wordRe(c).test(text));

  // A supported delivery city written next to a country that doesn't match it, for example "Lyon, Germany" or "Lyon in Germany".
  const allCountries = [...SUPPORTED_COUNTRIES, ...FOREIGN_COUNTRIES].map(c => c.replace(/\s+/g, '\\s+')).join('|');
  for (const city of supportedDest) {
    const after = new RegExp('(?:^|[^A-Za-z])' + city + '\\s*[,(:\\-–]*\\s*(?:in\\s+)?(' + allCountries + ')(?![A-Za-z])', 'i').exec(text);
    const beforeM = new RegExp('(?:^|[^A-Za-z])(' + allCountries + ')\\s*[,(:\\-–]+\\s*' + city + '(?![A-Za-z])', 'i').exec(text);
    const found = (after && after[1]) || (beforeM && beforeM[1]);
    if (found && cap(found.replace(/\s+/g, ' ')) !== DEST_COUNTRY[city]) {
      out.blockDest = true;
      say(`${city} is in ${DEST_COUNTRY[city]}, not ${cap(found.replace(/\s+/g, ' '))}. Which delivery city do you mean?`);
      break;
    }
  }

  // Known places that can't be booked. A place only counts when the wording treats it as a pickup or delivery location,
  // so "cork coasters", "a nice gift" and "made in China" are left alone.
  const DEST_CUE = /(?:\bto|\binto|\btowards|\bdeliver(?:ed|ing|y)?(?:\s+(?:to|in))?|\bsend(?:ing)?\s+to|\bship(?:ping)?\s+to|\bdestination(?:\s+is)?|\bfor\s+delivery\s+in)\s+(?:the\s+|a\s+|an\s+)?(?:(?:warehouse|business|address|depot|site|port|customer|client)\s+(?:in|at|near)\s+)?$/i;
  const ORIGIN_CUE2 = /(?:\bfrom|\bex|\bout\s+of|\bcollect(?:ed|ing)?(?:\s+(?:from|in))?|\bpick(?:ed)?\s?up(?:\s+(?:from|in))?|\bleaving|\bdepart(?:ing)?(?:\s+from)?)\s+(?:the\s+)?$/i;
  const MADE = /(?:made|manufactured|produced|sourced|origin|imported|printed|grown)\s+(?:\w+\s+){0,2}(?:in|from)?\s*$/i;
  const flagged = new Set<string>();
  const checkList = (names: string[], kind: 'city' | 'country' | 'uk') => {
    for (const n of names) {
      const re = new RegExp('(?:^|[^A-Za-z])' + n.replace(/\s+/g, '\\s+') + '(?![A-Za-z])', 'ig');
      let mm: RegExpExecArray | null;
      while ((mm = re.exec(text))) {
        const at = mm.index + (/^[^A-Za-z]/.test(mm[0]) ? 1 : 0);     // skip the one-character prefix that stands in for a lookbehind
        const lead = text.slice(Math.max(0, at - 40), at);
        if (MADE.test(lead)) continue;
        const asDest = DEST_CUE.test(lead), asOrigin = ORIGIN_CUE2.test(lead);
        const capital = /[A-Z]/.test(text[at]);
        let side: 'dest' | 'origin' | null = null;
        if (kind === 'country') side = asDest ? 'dest' : null;                       // "from China" is usually where goods were made
        else if (kind === 'uk') side = asOrigin || capital ? 'origin' : null;
        else side = asOrigin ? 'origin' : asDest ? 'dest' : capital ? 'dest' : null;
        if (!side || flagged.has(n)) continue;
        flagged.add(n);
        if (side === 'origin') { out.blockOrigin = true; say(`Sorry, I can’t book ${cap(n)} (${COLLECT_TEXT}).`); }
        else { out.blockDest = true; say(`Sorry, I can’t book ${cap(n)} (${DELIVER_TEXT}).`); }
      }
    }
  };
  checkList(FOREIGN_CITIES, 'city');
  checkList(FOREIGN_COUNTRIES, 'country');
  checkList(UK_OTHER, 'uk');

  // Words after "to" / "from" that aren't any known place: a misspelling of a supported city, or an unknown place.
  const cue = /(?:^|[^A-Za-z])(to|into|towards|from|ex)\s+(?:the\s+|a\s+|an\s+)?(?:(?:warehouse|business|address|depot|site|port)\s+(?:in|at|near)\s+)?([A-Za-z][A-Za-z'-]{3,})/g;
  let m: RegExpExecArray | null;
  while ((m = cue.exec(text))) {
    const role = /^(from|ex)$/i.test(m[1]) ? 'origin' : 'dest';
    const word = m[2];
    const lw = word.toLowerCase();
    const known = [...ORIGINS, ...Object.keys(DEST_COUNTRY)].map(s => s.toLowerCase());
    if (known.includes(lw) || NOT_PLACES.has(lw) || FOREIGN_CITIES.includes(lw) || FOREIGN_COUNTRIES.includes(lw) || UK_OTHER.includes(lw)) continue;
    if (SUPPORTED_COUNTRIES.map(c => c.toLowerCase()).includes(lw) || /^(holland|dutch|german|french)$/.test(lw)) continue;
    const pool = role === 'origin' ? ORIGINS : Object.keys(DEST_COUNTRY);
    const near = pool.find(c => c.length >= 5 && lw.length >= 5 && lev(lw, c.toLowerCase()) <= (c.length >= 8 ? 2 : 1));
    if (near) {
      if (role === 'origin') out.resolved.originCity = near; else out.resolved.destCity = near;
      say(`I read “${word}” as ${near}.`);
      continue;
    }
    // Unknown capitalised place: only flag it when this role has no supported value (otherwise it is probably a company name).
    const hasSupported = role === 'origin' ? supportedOrigin.length > 0 : (supportedDest.length > 0 || SUPPORTED_COUNTRIES.some(c => wordRe(c).test(text)));
    if (/^[A-Z]/.test(word) && !hasSupported && !out.resolved.destCity) {
      if (role === 'origin') { out.blockOrigin = true; say(`Sorry, I can’t book ${word} (${COLLECT_TEXT}).`); }
      else { out.blockDest = true; say(`Sorry, I can’t book ${word} (${DELIVER_TEXT}).`); }
    }
  }
  return out;
}
