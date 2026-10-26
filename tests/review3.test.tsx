// Review items 1 to 3, with the fixtures described in the review. Clock mocked to 26-10-2026.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as XLSX from 'xlsx';
import { renderToStaticMarkup } from 'react-dom/server';
import { PF } from '../lib/pf';
import { UploadResults, Detail, csvText } from '../components/Results';
import { correctedRows } from '../lib/fixes';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T12:00:00')); });
afterEach(() => vi.useRealTimers());

const book = (id: any, over: any = {}) => {
  const b: any = { 'Booking ID': id, 'Seller name': 'Northfield Goods', 'Origin city': 'Manchester', 'Origin country': 'United Kingdom', 'Destination city': 'Frankfurt', 'Destination country': 'Germany', 'Destination type': 'Business address',
    'Ready to ship date': '05-11-2026', 'Seller priority': 'Cheapest', Pallets: 3, Cartons: 90, 'Total declared value': 5400, Currency: 'GBP', 'Total gross weight (kg)': 620, 'Delivery appointment booked': 'Yes', ...over };
  return PF.BH.map((h: string) => b[h]);
};
const itm = (id: any, over: any = {}) => {
  const i: any = { 'Booking ID': id, SKU: 'MUG-01', Description: 'Ceramic coffee mug', 'HS code': '691200', 'Quantity (units)': 1080, 'Unit price': 5, 'Units per carton': 12, Cartons: 90, 'Unit weight (kg)': 0.5, 'Country of origin': 'United Kingdom', ...over };
  return PF.IH.map((h: string) => i[h]);
};
const file = (bookings: any[][], items: any[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Bookings'], PF.BH, ...bookings]), 'Bookings');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Items'], PF.IH, ...items]), 'Items');
  const r = PF.parseWorkbook(XLSX, XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  if (r.error) throw new Error(r.error);
  return r;
};
const h = { fix: () => {}, book: () => {}, reset: () => {}, ack: () => {}, bookAllClear: () => {}, download: () => {}, busy: false, bulk: null } as any;
const summary = (r: any) => renderToStaticMarkup(UploadResults({ upload: { fileName: 'f.xlsx', bookings: r.bookings, warnings: r.warnings }, sel: null, setSel: () => {}, filter: 'all', setFilter: () => {}, thumpKey: 0, aiOn: false, h }) as any);
const detail = (b: any) => renderToStaticMarkup(Detail({ b, aiOn: false, thumpKey: 0, opts: { fix: () => {}, book: () => {}, reset: () => {}, booking: false, ack: () => {} } }) as any);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const rowsOf = (html: string) => [...html.matchAll(/<tr[^>]*aria-label="Open [^"]*"[^>]*>(.*?)<\/tr>/g)].map(m => text(m[1]).trim());

describe('1. a row with data but no Booking ID is never silently dropped', () => {
  // one clean booking, one row with data but a blank ID, one fully blank row
  const r = file([book('BK-001'), book(''), PF.BH.map(() => null)], [itm('BK-001'), itm('', { SKU: 'NO-ID' })]);
  it('the summary has 2 rows: the clean booking and "(no ID)", and the blank row is ignored', () => {
    const rows = rowsOf(summary(r));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^BK-001 .*Ready to book/);
    expect(rows[1]).toMatch(/^\(no ID\) .*Needs fixing/);
    expect(r.bookings).toHaveLength(2);
  });
  it('the no-ID row is Red with the exact message, and cannot be booked', () => {
    const b = r.bookings[1], e = PF.evaluate(b);
    expect(e.status).toBe('blocked');
    const i = e.issues.find((x: any) => x.rule === 'INPUT');
    expect(i.sev).toBe('red');
    expect(i.what).toBe('Bookings sheet, row 4 has no Booking ID. Add one and upload again.');
    expect(text(detail(b))).toMatch(/Fix red items to book/);
  });
  it('an Items row with data but no Booking ID gives the visible warning, and the sheet row is right', () => {
    expect(r.warnings).toEqual(['Items sheet, row 4 has no Booking ID, so it was ignored.']);
    expect(text(summary(r))).toContain('Items sheet, row 4 has no Booking ID, so it was ignored.');
  });
  it('the number of bookings equals the number of non-empty data rows', () => {
    const many = file([book('A-1'), book(''), PF.BH.map(() => null), book('  '), book('A-2'), PF.BH.map(() => '   ')], [itm('A-1')]);
    expect(many.bookings).toHaveLength(4);          // A-1, two rows with no ID, A-2: the two blank rows are ignored
  });
});

describe('2. Booking IDs are trimmed and upper-cased for display, matching stays case-insensitive', () => {
  const r = file([book('  bk-002 ', { Pallets: 0 }), book('bk-001')], [itm('BK-002'), itm(' Bk-001 ')]);
  it('shows BK-002 in the summary table, the card header, the issue text and the downloads', () => {
    expect(r.bookings.map((b: any) => b.id)).toEqual(['BK-002', 'BK-001']);
    expect(r.bookings.every((b: any) => b.items.length === 1)).toBe(true);        // items still matched case-insensitively
    expect(rowsOf(summary(r)).map(x => x.split(' ')[0])).toEqual(['BK-002', 'BK-001']);
    expect(text(detail(r.bookings[0]))).toContain('BK-002 for Northfield Goods');
    expect(text(detail(r.bookings[0]))).toMatch(/BK-002 · Bookings sheet, row 3/);
    const csv = csvText(r.bookings);
    expect(csv).toContain('"BK-002"');
    expect(csv).not.toMatch(/bk-0/);
    const rows = correctedRows(r.bookings);
    expect(rows.bookingRows.slice(2).map((x: any) => x[0])).toEqual(['BK-002', 'BK-001']);
    expect(rows.itemRows.slice(2).map((x: any) => x[0])).toEqual(['BK-002', 'BK-001']);
    expect(rows.resultRows.slice(1).map((x: any) => x[0])).toEqual(['BK-002', 'BK-001']);
  });
});

describe('3. no carrier recommendation while pallets or gross weight is unusable', () => {
  const cases: [string, any][] = [
    ['0 pallets', { Pallets: 0 }], ['2.5 pallets', { Pallets: 2.5 }], ['a valid booking with gross weight -100', { 'Total gross weight (kg)': -100 }],
    ['gross weight 0', { 'Total gross weight (kg)': 0 }], ['blank pallets', { Pallets: null }], ['blank gross weight', { 'Total gross weight (kg)': null }], ['text pallets', { Pallets: 'lots' }],
  ];
  it.each(cases)('%s: no recommended carrier, no "scores highest" explanation, the replacement message, and "—" in the summary', (_label, over) => {
    const r = file([book('BK-001'), book('BK-009', over)], [itm('BK-001'), itm('BK-009')]);
    const b = r.bookings[1], e = PF.evaluate(b);
    expect(e.rec.recommended).toBeNull();
    expect(e.rec.blocked).toBe(true);
    const page = text(detail(b));
    expect(page).toContain('Fix the input errors above to get a carrier recommendation.');
    expect(page).not.toMatch(/scores highest|can take this load|is the cheapest|is the fastest|has the highest on-time|Carrier [ABC] ·/);
    expect(detail(b)).not.toMatch(/pill green">Recommended</);
    const rows = rowsOf(summary(r));
    expect(rows[0]).toMatch(/Carrier A, £540/);                                  // the valid booking is unaffected
    expect(rows[1]).toMatch(/—/);
    expect(rows[1]).not.toMatch(/Carrier [ABC]/);
    expect(JSON.stringify(PF.summarise(b, e))).not.toMatch(/Carrier [ABC]|£\d/);
  });
  it('when only other inputs are invalid and the load can still be assessed, the recommendation stays', () => {
    const r = file([book('BK-001', { 'Total declared value': 0 })], [itm('BK-001', { 'Unit price': -5 })]);
    const e = PF.evaluate(r.bookings[0]);
    expect(e.rec.blocked).toBe(false);
    expect(e.rec.recommended.carrier).toBe('Carrier A');
    expect(text(detail(r.bookings[0]))).toMatch(/Carrier A · Road economy/);
  });
  it('the recommendation returns as soon as the input is corrected', () => {
    const r = file([book('BK-001', { Pallets: 0 })], [itm('BK-001')]);
    const b = r.bookings[0];
    expect(PF.evaluate(b).rec.recommended).toBeNull();
    b.pallets = 3;
    expect(PF.evaluate(b).rec.recommended.carrier).toBe('Carrier A');
  });
});
