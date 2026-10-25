import { describe, it, expect } from 'vitest';
import { PF } from '../lib/pf';
import { applyChange, resetBooking, suggestions, itemFlags, correctedRows, hasChanges } from '../lib/fixes';

const fresh = () => PF.bookingsFromTables(...(Object.values(PF.sampleTables(PF.todayISO())) as [any, any])).bookings as any[];
const byId = (id: string) => fresh().find(b => b.id === id);

/** Drives a booking green using only the edit primitives the UI offers. */
function fixAll(b: any) {
  for (let pass = 0; pass < 8; pass++) {
    const ev = PF.evaluate(b);
    const red = ev.issues.filter((i: any) => i.sev === 'red');
    if (!red.length) return ev;
    const i = red[0];
    const s = suggestions(b);
    if (i.rule === 'R-01') { const k = b.items.findIndex((x: any) => itemFlags(x).hs); applyChange(b, { kind: 'set', field: 'hs', value: '691200', itemIndex: k, rule: 'R-01' }); }
    else if (i.rule === 'R-02') applyChange(b, { kind: 'set', field: 'declaredValue', value: s.itemsValue, rule: 'R-02' });
    else if (i.rule === 'R-03') { const k = b.items.findIndex((x: any) => itemFlags(x).cartonMath); const it = b.items[k];
      applyChange(b, Number.isInteger(it.qty / it.upc) ? { kind: 'set', field: 'cartons', value: it.qty / it.upc, itemIndex: k, rule: 'R-03' } : { kind: 'set', field: 'qty', value: it.upc * it.cartons, itemIndex: k, rule: 'R-03' }); }
    else if (i.rule === 'R-04') applyChange(b, { kind: 'set', field: 'cartons', value: s.itemsCartons, rule: 'R-04' });
    else if (i.rule === 'R-05') {
      if (ev.rec.recommended && ev.rec.recommended.carrier !== ev.rec.selected.carrier) applyChange(b, { kind: 'carrier', carrier: ev.rec.recommended.carrier, rule: 'R-05' });
      else applyChange(b, { kind: 'set', field: 'pallets', value: ev.rec.selected.minPallets, rule: 'R-05' });
    }
    else if (i.rule === 'R-06') { const k = b.items.findIndex((x: any) => x.sku === i.item); applyChange(b, { kind: 'remove', itemIndex: k, rule: 'R-06' }); }
    else throw new Error('no fix path for ' + i.rule + ': ' + i.title);
  }
  return PF.evaluate(b);
}

describe('every planted booking can be corrected to a bookable state', () => {
  for (const id of ['BK-002', 'BK-003', 'BK-004', 'BK-005', 'BK-007', 'BK-013']) {
    it(id + ' reaches no red issues, and every step is logged', () => {
      const b = byId(id);
      expect(PF.evaluate(b).status).toBe('blocked');
      const ev = fixAll(b);
      expect(ev.counts.red).toBe(0);
      expect(hasChanges(b)).toBe(true);
      expect(b._changes.every((c: any) => c.rule && c.field && 'from' in c && 'to' in c)).toBe(true);
    });
  }
});

describe('the rulebook is not bypassed by corrections', () => {
  it('removing a hazardous item makes the totals stop matching, so R-02 still has to be fixed', () => {
    const b = byId('BK-013');
    const k = b.items.findIndex((x: any) => /lithium/i.test(x.desc));
    applyChange(b, { kind: 'remove', itemIndex: k, rule: 'R-06' });
    const issues = PF.evaluate(b).issues;
    expect(issues.some((i: any) => i.rule === 'R-06')).toBe(false);
    expect(issues.some((i: any) => i.rule === 'R-02')).toBe(true);
  });
  it('a booking made only of restricted goods cannot be edited into a bookable one', () => {
    const b = byId('BK-008');
    while (PF.evaluate(b).issues.some((i: any) => i.rule === 'R-06')) {
      const i = PF.evaluate(b).issues.find((x: any) => x.rule === 'R-06');
      applyChange(b, { kind: 'remove', itemIndex: b.items.findIndex((x: any) => x.sku === i.item), rule: 'R-06' });
    }
    const ev = PF.evaluate(b);
    expect(ev.status).toBe('blocked');
    expect(ev.issues.some((i: any) => i.rule === 'DATA' && /No items/.test(i.title))).toBe(true);
  });
  it('a correction is judged by the same engine: a wrong value stays red', () => {
    const b = byId('BK-003');
    applyChange(b, { kind: 'set', field: 'declaredValue', value: 5000, rule: 'R-02' });
    expect(PF.evaluate(b).issues.map((i: any) => i.rule)).toContain('R-02');
  });
  it('R-05 is still evaluated against the selected carrier after a switch', () => {
    const b = byId('BK-006');
    applyChange(b, { kind: 'carrier', carrier: 'Carrier C', rule: 'R-05' });
    expect(PF.evaluate(b).issues.map((i: any) => i.rule)).toContain('R-05');
  });
});

describe('change log, reset and export', () => {
  it('reset restores exactly what was uploaded', () => {
    const b = byId('BK-003');
    const before = JSON.stringify(PF.evaluate(b).issues);
    applyChange(b, { kind: 'set', field: 'declaredValue', value: 5400, rule: 'R-02' });
    expect(PF.evaluate(b).issues.length).toBeLessThan(JSON.parse(before).length);
    resetBooking(b);
    expect(JSON.stringify(PF.evaluate(b).issues)).toBe(before);
    expect(hasChanges(b)).toBe(false);
  });
  it('editing clears a previous confirmation', () => {
    const b = byId('BK-001'); b._confirmed = true; b._ref = 'GYST-X';
    applyChange(b, { kind: 'set', field: 'pallets', value: 4, rule: 'R-05' });
    expect(b._confirmed).toBe(false);
    expect(b._ref).toBeUndefined();
  });
  it('the corrected workbook re-parses and gives the same verdicts', async () => {
    const XLSX = await import('xlsx');
    const all = fresh().filter(b => b.id !== 'BK-008');
    all.forEach(b => { if (PF.evaluate(b).status === 'blocked') fixAll(b); });
    const { bookingRows, itemRows, changeRows, resultRows } = correctedRows(all);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(bookingRows), 'Bookings');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(itemRows), 'Items');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(changeRows), 'Change log');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resultRows), 'Results');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const re = PF.parseWorkbook(XLSX, out);
    expect(re.error).toBeUndefined();
    expect(re.bookings).toHaveLength(13);
    re.bookings.forEach((rb: any) => {
      const orig = all.find(b => b.id === rb.id);
      const sig = (x: any) => [x.id, PF.evaluate(x).status, PF.evaluate(x).issues.map((i: any) => i.rule).join(',')];
      expect(sig(rb)).toEqual(sig(orig));
      expect(PF.evaluate(rb).counts.red).toBe(0);
    });
    expect(changeRows.length).toBeGreaterThan(1);
  });
});
