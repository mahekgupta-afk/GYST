// The model must never invent booking totals: the seller's stated totals are what the
// rulebook checks against (R-02, R-04, R-05, R-07). A total from the model is kept only if
// the seller's message contains that number, or the booking already had a value for it
// (so edits like "add a pallet" still work). Anything else is dropped and asked for later.
const TOTALS = ['pallets', 'cartons', 'declaredValue', 'grossWeight'] as const;
const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.push(parseFloat(m[0].replace(/,/g, '')));
  for (const m of text.toLowerCase().matchAll(/\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g)) out.push(WORDS[m[1]]);
  return out;
}

export function dropInventedTotals(result: Record<string, any>, booking: Record<string, any>, text: string) {
  const said = numbersIn(text);
  for (const k of TOTALS) {
    const v = result[k];
    if (v == null) continue;
    const known = booking[k] != null;
    if (!known && !said.some(n => Math.abs(n - Number(v)) < 1e-9)) result[k] = null;
  }
  return result;
}
