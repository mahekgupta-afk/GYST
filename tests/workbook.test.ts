import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { PF } from '../lib/pf';

describe('real xlsx upload (same path the browser uses)', () => {
  const buf = readFileSync(__dirname + '/fixtures/planted.xlsx');
  const res = PF.parseWorkbook(XLSX, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const rulesOf = (id: string) => PF.evaluate(res.bookings.find((b: any) => b.id === id)).issues.map((i: any) => i.rule);

  it('reads all 14 bookings with no parse error', () => {
    expect(res.error).toBeFalsy();
    expect(res.bookings).toHaveLength(14);
  });
  it('catches the planted errors', () => {
    expect(rulesOf('BK-002')).toContain('R-01');
    expect(rulesOf('BK-003')).toContain('R-02');
    expect(rulesOf('BK-004')).toContain('R-03');
    expect(rulesOf('BK-005')).toContain('R-04');
    expect(rulesOf('BK-007')).toContain('R-05');
    expect(rulesOf('BK-008')).toContain('R-06');
    expect(rulesOf('BK-014')).toHaveLength(0);
  });
});

describe('blank template (the download offered in the UI)', () => {
  const build = (extraBooking?: any[], extraItem?: any[]) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Bookings: one row per shipment. Enter data from row 3.'], PF.BH, ...(extraBooking ? [extraBooking] : [])]), 'Bookings');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Items: one row per product in a booking. Enter data from row 3.'], PF.IH, ...(extraItem ? [extraItem] : [])]), 'Items');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    return out as ArrayBuffer;
  };
  it('an empty template parses to zero bookings, not a crash', () => {
    const r = PF.parseWorkbook(XLSX, build());
    expect(r.error || r.bookings.length === 0).toBeTruthy();
  });
  it('a filled-in template is read and checked', () => {
    const r = PF.parseWorkbook(XLSX,
      build(['BK-101', 'Acme Ltd', 'London', 'United Kingdom', 'Paris', 'France', 'Warehouse', '01-12-2030', 'Cheapest', 1, 10, 100, 'GBP', 50, 'Yes'],
            ['BK-101', 'SKU1', 'Wooden spoons', '441900', 100, 1, 10, 10, 0.4, 'Vietnam']));
    expect(r.bookings).toHaveLength(1);
    expect(PF.evaluate(r.bookings[0]).status).toBe('clear');
  });
});
