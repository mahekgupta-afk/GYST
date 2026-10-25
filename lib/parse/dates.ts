// Deterministic date reading for the chat. Nothing here asks a model: dates are resolved from the text and
// the browser's local "today" only. Numeric dates are always day first (DD-MM-YYYY), never month first.

export type DateParse = {
  /** Resolved calendar day as YYYY-MM-DD. */
  iso?: string;
  /** The phrase that was too vague to turn into a date (for example "next week"). */
  ambiguous?: string;
  /** A date was written but is not a real day (for example 31-02-2026). */
  invalid?: string;
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const NUMW: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const DAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };

/** Words that suggest a message is talking about the ready/collection date. */
export const DATE_CUE = /\d{4}|ready|collect|pick|ship|send|dispatch|pack|date|\bon\b|\bby\b|tomorrow|today|yesterday|next |this |in \w+ (?:day|week)s?|\d{1,2}[-/.]\d{1,2}/i;

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number): string | undefined => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : undefined;
};
export const addDaysISO = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const weekdayOf = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const monthNum = (name: string) => MONTHS[name.toLowerCase().slice(0, 4) === 'sept' ? 'sept' : name.toLowerCase().slice(0, 3)];
const count = (w: string) => (/^\d+$/.test(w) ? +w : NUMW[w.toLowerCase()]);

export function parseDateText(text: string, today: string): DateParse {
  const t = text.replace(/[‘’]/g, "'");
  const year = +today.slice(0, 4);
  let m: RegExpExecArray | null;

  // 05-11-2026, 5/11/26, 05.11.2026: always DD-MM-YYYY.
  m = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/.exec(t);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const iso = isoOf(y, +m[2], +m[1]);
    return iso ? { iso } : { invalid: m[0] };
  }
  // 2026-11-05
  m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (m) { const iso = isoOf(+m[1], +m[2], +m[3]); return iso ? { iso } : { invalid: m[0] }; }

  // 5 Nov, 5th November 2026, 5 of November
  m = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?' + MON + '\\.?(?:,?\\s*(\\d{4}))?\\b', 'i').exec(t);
  if (m) { const iso = isoOf(m[3] ? +m[3] : year, monthNum(m[2]), +m[1]); return iso ? { iso } : { invalid: m[0] }; }
  // November 5th, Nov 5 2026
  m = new RegExp('\\b' + MON + '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b', 'i').exec(t);
  if (m) { const iso = isoOf(m[3] ? +m[3] : year, monthNum(m[1]), +m[2]); return iso ? { iso } : { invalid: m[0] }; }

  // Phrases too vague to turn into one day: ask instead of guessing.
  m = /\b(next\s+week|this\s+week|next\s+month|this\s+month|end\s+of\s+(?:the\s+)?(?:next\s+)?(?:week|month|year)|start\s+of\s+(?:the\s+)?(?:next\s+)?(?:week|month)|beginning\s+of\s+(?:the\s+)?(?:next\s+)?(?:week|month)|mid[\s-]?(?:week|month)|asap|as\s+soon\s+as\s+possible|soon|in\s+a\s+few\s+days|in\s+a\s+couple\s+of\s+days|in\s+a\s+couple\s+of\s+weeks|in\s+a\s+few\s+weeks|sometime|whenever|a\s+week\s+or\s+so)\b/i.exec(t);

  // Relative days. "in 3 days" / "in two weeks" are exact enough to resolve.
  if (/\bday\s+after\s+tomorrow\b/i.test(t)) return { iso: addDaysISO(today, 2) };
  if (/\btomorrow\b/i.test(t)) return { iso: addDaysISO(today, 1) };
  if (/\byesterday\b/i.test(t)) return { iso: addDaysISO(today, -1) };
  if (/\b(today|tonight)\b/i.test(t)) return { iso: today };
  const rel = /\bin\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(day|week)s?\b/i.exec(t);
  if (rel && count(rel[1])) return { iso: addDaysISO(today, count(rel[1]) * (rel[2].toLowerCase() === 'week' ? 7 : 1)) };

  // Weekdays. "next Monday" is the first Monday after today. "this Friday" or a bare "Friday" is the upcoming Friday, today included.
  const wd = /\b(?:(next|this|on|by|before)\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*day\b/i.exec(t);
  if (wd) {
    const target = DAYS[wd[2].toLowerCase()];
    const cur = weekdayOf(today);
    let add = (target - cur + 7) % 7;
    if (wd[1] && wd[1].toLowerCase() === 'next' && add === 0) add = 7;
    return { iso: addDaysISO(today, add) };
  }

  if (m) return { ambiguous: m[1].replace(/\s+/g, ' ') };
  return {};
}
