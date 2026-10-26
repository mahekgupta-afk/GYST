import { describe, it, expect } from 'vitest';
import { PF } from '../lib/pf';

const TODAY = PF.todayISO();
const t = PF.sampleTables(TODAY);
const { bookings } = PF.bookingsFromTables(t.bookingRows, t.itemRows);
const get = (id: string) => bookings.find((b: any) => b.id === id);
const run = (id: string) => PF.evaluate(get(id));
const rules = (id: string) => run(id).issues.map((i: any) => i.rule);

describe('planted-error sample bookings', () => {
  it('loads all 14 bookings', () => expect(bookings).toHaveLength(14));

  it('BK-001 is clean, Cheapest = Carrier A at £540', () => {
    const ev = run('BK-001');
    expect(ev.status).toBe('clear');
    expect(ev.rec.recommended.carrier).toBe('Carrier A');
    expect(ev.rec.recommended.price * ev.rec.pallets).toBe(540);
  });
  it('BK-002 R-01 twice (blank and 5-digit HS)', () => expect(rules('BK-002').filter((r: string) => r === 'R-01')).toHaveLength(2));
  it('BK-003 R-02', () => expect(rules('BK-003')).toContain('R-02'));
  it('BK-004 R-03', () => expect(rules('BK-004')).toContain('R-03'));
  it('BK-005 R-04', () => expect(rules('BK-005')).toContain('R-04'));
  it('BK-006 (Fastest, 500 kg per pallet): R-05 is Red against Carrier C (the Fastest pick), Carrier B is what to switch to', () => {
    const ev = run('BK-006');
    expect(rules('BK-006')).toContain('R-05');
    expect(ev.rec.selected.carrier).toBe('Carrier C');
    expect(ev.rec.recommended.carrier).toBe('Carrier B');
    const r = ev.issues.find((i: any) => i.rule === 'R-05');
    expect(r.fix).toContain('Switch to Carrier B'); expect(r.autofix.set).toEqual({ _carrier: 'Carrier B' });
    expect(ev.rec.ruledOutNotes.join(' ')).toMatch(/Carrier C .*ruled out/);
  });
  it('BK-007 R-05 and no carrier fits', () => {
    expect(rules('BK-007')).toContain('R-05');
    expect(run('BK-007').rec.recommended).toBeFalsy();
  });
  it('BK-008 R-06 twice', () => expect(rules('BK-008').filter((r: string) => r === 'R-06')).toHaveLength(2));
  it('BK-009 R-07 amber', () => {
    const i = run('BK-009').issues.find((x: any) => x.rule === 'R-07');
    expect(i.sev).toBe('amber');
  });
  it('BK-010 R-08 amber', () => expect(rules('BK-010')).toContain('R-08'));
  it('BK-011 R-09 amber', () => expect(rules('BK-011')).toContain('R-09'));
  it('BK-012 R-10 amber', () => expect(rules('BK-012')).toContain('R-10'));
  it('BK-013 trips every rule it should (R-05 too: Carrier C, the Fastest pick, cannot take 500 kg a pallet)', () => {
    const r = rules('BK-013');
    for (const id of ['R-01', 'R-03', 'R-04', 'R-05', 'R-06', 'R-08', 'R-09', 'R-10']) expect(r).toContain(id);
  });
  it('BK-014 negative controls pass (R-02 within 1%, olive oil, business address)', () => {
    expect(run('BK-014').status).toBe('clear');
  });
});

describe('boundaries', () => {
  const base = () => structuredClone(get('BK-001'));
  it('exactly 500 kg per pallet passes on Carrier A', () => {
    const b = base(); b.pallets = 1; b.grossWeight = 500;
    expect(PF.evaluate(b).issues.map((i: any) => i.rule)).not.toContain('R-05');
  });
  it('501 kg per pallet rules Carrier A (the Cheapest pick) out: R-05 is Red, and Carrier B is what to switch to', () => {
    const b = base(); b.pallets = 1; b.grossWeight = 501;
    const ev = PF.evaluate(b);
    expect(ev.issues.map((i: any) => i.rule)).toContain('R-05');
    expect(ev.rec.recommended.carrier).toBe('Carrier B');
    b._carrier = 'Carrier B';                                         // once Carrier B is chosen, R-05 passes
    expect(PF.evaluate(b).issues.map((i: any) => i.rule)).not.toContain('R-05');
  });
  it('exactly 750 kg per pallet passes on Carrier B; 751 kg fails on every carrier', () => {
    const b = base(); b.pallets = 1; b.grossWeight = 750; b._carrier = 'Carrier B';
    expect(PF.evaluate(b).issues.map((i: any) => i.rule)).not.toContain('R-05');
    b.grossWeight = 751;
    const ev = PF.evaluate(b);
    expect(ev.issues.map((i: any) => i.rule)).toContain('R-05');
    expect(ev.rec.recommended).toBeNull();
  });
  it('today passes R-10', () => {
    const b = base(); b.readyDate = TODAY;
    expect(PF.evaluate(b).issues.map((i: any) => i.rule)).not.toContain('R-10');
  });
});
