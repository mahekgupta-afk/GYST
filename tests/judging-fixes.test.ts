// The fixes the judging brief asks for, on the test pack's own bookings: one-click R-01 and R-05 fixes that really clear the rule,
// and a booking that can be confirmed afterwards.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { PF } from '../lib/pf';
import { fixOptions, previewFix } from '../lib/autofix';
import { applyChange, canBook } from '../lib/fixes';

const TODAY = '2026-10-26';
const file = readFileSync('tests/fixtures/Preflight_Test_Pack_A_Rulebook.xlsx');
const load = () => PF.parseWorkbook(XLSX, file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)).bookings as any[];
const get = (id: string) => load().find(b => b.id === id);
const ev = (b: any) => PF.evaluate(b, { todayISO: TODAY });
const issue = (b: any, rule: string) => ev(b).issues.find((i: any) => i.rule === rule);
const apply = (b: any, opt: any) => { for (const s of opt.specs) expect(applyChange(b, s).ok).toBe(true); };

describe('R-01 leading zero', () => {
  it('BK-102: 90240 is flagged as probably 090240, offers “Use 090240”, and applying it clears R-01', () => {
    const b = get('BK-102');
    const i = ev(b).issues.filter((x: any) => x.rule === 'R-01');
    expect(i).toHaveLength(1);
    expect(i[0].what).toMatch(/probably dropped: 090240/);
    expect(i[0].fix).toMatch(/text/);
    const opt = fixOptions(b, ev(b), i[0]).find(o => o.label === 'Use 090240')!;
    expect(opt).toBeTruthy();
    const pv = previewFix(b, opt.specs) as any;
    expect(pv.ok && pv.fixed).toContain('R-01');
    apply(b, opt);
    expect(ev(b).issues.filter((x: any) => x.rule === 'R-01')).toHaveLength(0);
  });
  it('0901.21 and 6912.00.10 pass R-01', () => {
    const b = get('BK-102');
    b.items[0].hs = '0901.21'; expect(ev(b).issues.filter((x: any) => x.rule === 'R-01')).toHaveLength(0);
    b.items[0].hs = '6912.00.10'; expect(ev(b).issues.filter((x: any) => x.rule === 'R-01')).toHaveLength(0);
  });
});

describe('R-05 against the priority pick', () => {
  it('BK-108: red against Carrier A, with “switch to B £220” and a priced re-palletise option; both clear R-05', () => {
    const b = get('BK-108'), i = issue(b, 'R-05');
    expect(i.sev).toBe('red');
    expect(i.what).toContain('620 kg per pallet; Carrier A (cheapest) takes max 500 kg.');
    const opts = fixOptions(b, ev(b), i);
    expect(opts.map(o => o.label)).toEqual(['Switch to Carrier B (£220)', 'Use 2 pallets with Carrier A (£360)']);
    expect(i.fix).toMatch(/Switch to Carrier B[^.]*£220 for 1 pallet/);
    expect(i.fix).toMatch(/Switching is the cheaper fix/);
    for (const o of opts) {
      const copy = JSON.parse(JSON.stringify(b)); apply(copy, o);
      expect(ev(copy).issues.some((x: any) => x.rule === 'R-05')).toBe(false);
    }
    apply(b, opts[0]);
    expect(canBook(b, ev(b)) || ev(b).status !== 'blocked').toBe(true);
  });
  it('BK-109: nothing fits, so switching cannot fix it; the cheapest option is Carrier A on 2 pallets (£320)', () => {
    const b = get('BK-109'), i = issue(b, 'R-05');
    expect(i.sev).toBe('red');
    expect(i.fix).toContain('Switching carrier cannot fix this');
    expect(i.fix).toContain('Carrier A on 2 pallets (£320)');
    const opts = fixOptions(b, ev(b), i);
    expect(opts[0].label).toBe('Use 2 pallets with Carrier A (£320)');
    apply(b, opts[0]);
    expect(ev(b).issues.some((x: any) => x.rule === 'R-05')).toBe(false);
  });
  it('BK-124: red against Carrier C; “switch to B £400” or “3 pallets on C £960”', () => {
    const b = get('BK-124'), i = issue(b, 'R-05');
    expect(i.fix).toContain('£400');
    expect(i.fix).toMatch(/3 pallets[^.]*£960/);
  });
});

describe('Balanced and priorities', () => {
  it('Balanced on 2 pallets to Rotterdam is Carrier B at £400', () => {
    const e = PF.evaluate({ ...get('BK-101'), destCity: 'Rotterdam', destCountry: 'Netherlands', priority: 'Balanced', pallets: 2, grossWeight: 400 }, { todayISO: TODAY });
    expect(e.rec.recommended.carrier).toBe('Carrier B');
    expect(e.rec.recommended.price * 2).toBe(400);
    expect(e.rec.reason).toContain('cost 40%, speed 30%, reliability 30%');
  });
});
