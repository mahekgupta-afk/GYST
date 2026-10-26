// The test pack's own answer key. The Answer key sheet inside Preflight_Test_Pack_A_Rulebook.xlsx lists, for every booking,
// which rules should fail and how. The app reads the Bookings and Items sheets exactly as a judge's upload would, with today = 26-10-2026.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { PF } from '../lib/pf';

const TODAY = '2026-10-26';
const file = readFileSync('tests/fixtures/Preflight_Test_Pack_A_Rulebook.xlsx');
const ab = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
const parsed = PF.parseWorkbook(XLSX, ab);
const byId = (id: string) => parsed.bookings.find((b: any) => b.id === id);
const evalOf = (id: string) => PF.evaluate(byId(id), { todayISO: TODAY });

const wb = XLSX.read(ab, { type: 'array' });
const keyRows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets['Answer key'], { header: 1, defval: null });
const RULES = ['R-01', 'R-02', 'R-03', 'R-04', 'R-05', 'R-06', 'R-07', 'R-08', 'R-09', 'R-10'];
const key = keyRows.slice(1).filter(r => r[0]).map(r => ({
  id: String(r[0]),
  expected: Object.fromEntries(RULES.map((rule, i) => [rule, String(r[3 + i]).toLowerCase()])) as Record<string, 'pass' | 'red' | 'amber'>,
  verdict: String(r[13]), carrier: String(r[14]),
}));

describe('the pack is read as a judge would upload it', () => {
  it('reads every booking in the Bookings sheet with no parse error', () => {
    expect(parsed.error).toBeFalsy();
    expect(parsed.bookings.map((b: any) => b.id)).toEqual(['BK-001', ...key.map(k => k.id)]);
    expect(parsed.warnings || []).toEqual([]);
  });
  it('the grey template example (BK-001) comes out clear', () => {
    const ev = evalOf('BK-001'); expect(ev.status).toBe('clear'); expect(ev.issues).toEqual([]);
  });
});

describe('every booking matches the answer key, rule by rule', () => {
  it.each(key.map(k => [k.id, k] as const))('%s: failing rules and severities', (_id, k) => {
    const ev = evalOf(k.id);
    const got: Record<string, string> = Object.fromEntries(RULES.map(r => [r, 'pass']));
    for (const i of ev.issues) if (RULES.includes(i.rule)) got[i.rule] = i.sev;
    expect(got).toEqual(k.expected);
    // nothing outside the ten rules (no input errors, no missing-data problems) on this clean pack
    expect(ev.issues.filter((i: any) => !RULES.includes(i.rule)).map((i: any) => i.rule + ': ' + i.title)).toEqual([]);
  });
  it.each(key.map(k => [k.id, k] as const))('%s: the overall verdict', (_id, k) => {
    const st = evalOf(k.id).status;
    expect(st).toBe(k.verdict.startsWith('CLEAR') ? 'clear' : k.verdict.startsWith('HOLD') ? 'blocked' : 'warning');
  });
});

describe('carriers and prices (answer key, "Expected carrier")', () => {
  // [booking, carrier the app recommends, total price]; null means no carrier can take the load as booked.
  const EXPECT: Record<string, [string | null, number | null]> = {
    'BK-101': ['Carrier A', 340], 'BK-102': ['Carrier C', 640], 'BK-103': ['Carrier B', 440], 'BK-104': ['Carrier A', 360], 'BK-105': ['Carrier C', 320],
    'BK-106': ['Carrier A', 340], 'BK-107': ['Carrier C', 680], 'BK-108': ['Carrier B', 220], 'BK-109': [null, null], 'BK-110': ['Carrier C', 330],
    'BK-111': ['Carrier B', 200], 'BK-112': ['Carrier A', 340], 'BK-113': ['Carrier C', 680], 'BK-114': ['Carrier C', 340], 'BK-115': ['Carrier C', 660],
    'BK-116': ['Carrier B', 220], 'BK-117': ['Carrier A', 160], 'BK-118': ['Carrier A', 170], 'BK-119': ['Carrier C', 340],
    'BK-120': ['Carrier A', 320], 'BK-121': ['Carrier C', 640], 'BK-122': ['Carrier C', 640], 'BK-123': ['Carrier B', 400], 'BK-124': ['Carrier B', 400],
  };
  it.each(Object.entries(EXPECT))('%s', (id, [carrier, total]) => {
    const rec = evalOf(id).rec;
    expect(rec.recommended ? rec.recommended.carrier : null).toBe(carrier);
    expect(rec.recommended ? rec.recommended.price * rec.pallets : null).toBe(total);
  });
  it('the answer key covers every booking listed above', () => { expect(Object.keys(EXPECT).sort()).toEqual(key.map(k => k.id).sort()); });
});

describe('the planted cases the answer key singles out', () => {
  const issue = (id: string, rule: string) => evalOf(id).issues.filter((i: any) => i.rule === rule);
  it('BK-102: only the tea fails R-01, with a hint about the lost zero; the dotted coffee code passes; a business address with no appointment does not trip R-08', () => {
    const r = issue('BK-102', 'R-01'); expect(r).toHaveLength(1);
    expect(r[0].item).toBe('TEA-01'); expect(r[0].title).toMatch(/leading zero/i); expect(r[0].what + r[0].fix).toMatch(/090240/);
    expect(issue('BK-102', 'R-08')).toEqual([]);
  });
  it('BK-103: the explanation states both figures and the fix', () => {
    const w = issue('BK-103', 'R-02')[0]; expect(w.what).toContain('£540,000'); expect(w.what).toContain('£5,400'); expect(w.fix).toContain('£5,400');
  });
  it('BK-104 passes R-02 at exactly 1%, BK-105 fails at 1.2%', () => { expect(issue('BK-104', 'R-02')).toEqual([]); expect(issue('BK-105', 'R-02')).toHaveLength(1); });
  it('BK-106: R-03 on the pens only, and the fix says to recount (750 does not divide by 40)', () => {
    const r = issue('BK-106', 'R-03'); expect(r).toHaveLength(1); expect(r[0].item).toBe('PEN-01'); expect(r[0].fix).toMatch(/whole number of cartons|recount|packing list/i);
  });
  it('BK-108: R-05 against the cheapest pick (A), with the two priced fixes and a statement of which is cheaper', () => {
    const r = issue('BK-108', 'R-05'); expect(r).toHaveLength(1);
    expect(r[0].what).toMatch(/620 kg per pallet/); expect(r[0].what).toContain('Carrier A');
    expect(r[0].fix).toContain('Switch to Carrier B'); expect(r[0].fix).toContain('£220'); expect(r[0].fix).toMatch(/2 pallets/); expect(r[0].fix).toContain('£360'); expect(r[0].fix).toMatch(/cheaper fix/);
    expect(r[0].autofix.label).toMatch(/Switch to Carrier B/); expect(r[0].autofix2.label).toMatch(/Use 2 pallets with Carrier A/);
  });
  it('BK-109: nothing fits, so switching cannot fix it, and the cheapest fix is Carrier A on 2 pallets for £320', () => {
    const r = issue('BK-109', 'R-05')[0];
    expect(r.what).toMatch(/900 kg per pallet/); expect(r.fix).toMatch(/Cheapest way to make it fit/); expect(r.fix).toContain('Carrier A on 2 pallets'); expect(r.fix).toContain('£320');
    expect(r.autofix.label).toBe('Use 2 pallets with Carrier A'); expect(r.autofix2).toBeUndefined();
  });
  it('BK-110: exactly 400 kg on Carrier C passes', () => { expect(issue('BK-110', 'R-05')).toEqual([]); });
  it('BK-111: the earbuds are flagged and the phone case is not', () => {
    const r = issue('BK-111', 'R-06'); expect(r.map((i: any) => i.item)).toEqual(['EAR-01']);
  });
  it('BK-112: exactly two R-06 findings (perfume, dry shampoo); not the alkaline AA, not the candle; and a note that alkaline is not lithium', () => {
    expect(issue('BK-112', 'R-06').map((i: any) => i.item).sort()).toEqual(['PERF-01', 'SHMP-01']);
    expect(evalOf('BK-112').advisories.map((a: any) => a.title + ' ' + a.what).join(' ')).toMatch(/not lithium/i);
  });
  it('BK-113: every safe-word trap passes', () => { expect(issue('BK-113', 'R-06')).toEqual([]); });
  it('BK-115: R-07 amber, with a note that the true weight would knock out Carrier C', () => {
    expect(issue('BK-115', 'R-07')).toHaveLength(1);
    expect(issue('BK-115', 'R-07')[0].fix + ' ' + evalOf('BK-115').advisories.map((a: any) => a.what).join(' ')).toMatch(/Carrier C can no longer take|above Carrier C/i);
  });
  it('BK-119: all nine broken rules at the right severities, and R-05 passes only on the declared weight', () => {
    const ev = evalOf('BK-119');
    expect(new Set(ev.issues.map((i: any) => i.rule))).toEqual(new Set(['R-01', 'R-02', 'R-03', 'R-04', 'R-06', 'R-07', 'R-08', 'R-09', 'R-10']));
    expect(ev.issues.filter((i: any) => i.rule === 'R-01').length).toBe(2);                    // speaker (8518 too short) and hairspray (blank)
  });
  it('BK-120 to BK-123: four priorities, four explained recommendations; Balanced on 2 pallets to Rotterdam is Carrier B at £400', () => {
    const ids = ['BK-120', 'BK-121', 'BK-122', 'BK-123'];
    expect(ids.map(i => evalOf(i).rec.recommended.carrier)).toEqual(['Carrier A', 'Carrier C', 'Carrier C', 'Carrier B']);
    expect(new Set(ids.map(i => evalOf(i).rec.reason)).size).toBe(4);
    expect(evalOf('BK-123').rec.reason).toMatch(/cost 40%, speed 30%, reliability 30%/);
  });
  it('BK-124: R-05 against Carrier C (the Fastest pick), fall back to B for £400, or 3 pallets on C for £960', () => {
    const r = issue('BK-124', 'R-05')[0];
    expect(r.what).toContain('Carrier C'); expect(r.fix).toContain('Switch to Carrier B'); expect(r.fix).toContain('£400'); expect(r.fix).toMatch(/3 pallets/); expect(r.fix).toContain('£960');
  });
  it('applying the offered R-05 fixes clears R-05 and the booking can then be booked', () => {
    for (const [id, which] of [['BK-108', 'autofix'], ['BK-108', 'autofix2'], ['BK-124', 'autofix'], ['BK-124', 'autofix2'], ['BK-109', 'autofix']] as const) {
      const b = JSON.parse(JSON.stringify(byId(id))); const r = PF.evaluate(b, { todayISO: TODAY }).issues.find((i: any) => i.rule === 'R-05');
      Object.assign(b, r[which].set);
      const after = PF.evaluate(b, { todayISO: TODAY });
      expect(after.issues.filter((i: any) => i.rule === 'R-05'), id + which).toEqual([]);
      expect(after.status, id + which).toBe('clear');
    }
  });
});
