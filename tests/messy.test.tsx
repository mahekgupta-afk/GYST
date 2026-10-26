// A deliberately messy uploaded file. Clock mocked to 26-10-2026.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as XLSX from 'xlsx';
import { renderToStaticMarkup } from 'react-dom/server';
import { PF } from '../lib/pf';
import { UploadResults, Detail } from '../components/Results';

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
const blank = (n: number) => Array(n).fill(null);
const file = (bookings: any[][], items: any[][]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Bookings title'], PF.BH, ...bookings]), 'Bookings');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Items title'], PF.IH, ...items]), 'Items');
  const r = PF.parseWorkbook(XLSX, XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  if (r.error) throw new Error(r.error);
  return r;
};
const ev = (b: any) => PF.evaluate(b);
const inputs = (b: any) => ev(b).issues.filter((i: any) => i.rule === 'INPUT');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
const noBadText = (html: string) => { const t = text(html); expect(t).not.toMatch(/NaN|Infinity|undefined/); };

describe('Bug 1: all-zero HS codes (uploaded .xlsx)', () => {
  const codes: [any, boolean][] = [['000000', false], ['0', false], ['0000.00.00', false], [0, false], [0.0, false], ['00 00 00', false], ['000000.0', false], ['-691200', false], ['TBC', false], ['', false], ['  ', false], ['N/A', false],
    ['090111', true], ['691200', true], ['6912.00', true]];
  const f = file([book('BK-001')], codes.map(([hs], i) => itm('BK-001', { SKU: 'HS-' + (i + 1), 'HS code': hs, 'Quantity (units)': 12, 'Units per carton': 12, Cartons: 1 })));
  it.each(codes.map(([hs, ok], i) => [JSON.stringify(hs), ok, i] as const))('HS %s → %s', (_label, ok, i) => {
    const sku = 'HS-' + (i + 1);
    const r01 = ev(f.bookings[0]).issues.filter((x: any) => x.rule === 'R-01' && x.item === sku);
    expect(r01.length).toBe(ok ? 0 : 1);
    if (!ok) expect(r01[0].sev).toBe('red');
  });
  it('the zero cases use the exact message with SKU, and name the sheet and row', () => {
    const i = ev(f.bookings[0]).issues.find((x: any) => x.rule === 'R-01' && x.item === 'HS-1');
    expect(i.what).toBe('HS-1 has the HS code “000000”, which is all zeros. Enter a real code of at least 6 digits from the UK Trade Tariff.');
    expect(i.sheet).toBe('Items');
    expect(i.row).toBe(3);
    const z = ev(f.bookings[0]).issues.find((x: any) => x.rule === 'R-01' && x.item === 'HS-7');
    expect(z.what).toContain('“000000.0”');
  });
});

describe('Bug 2: zero and negative numbers (uploaded .xlsx)', () => {
  const f = file(
    [book('BK-001'), book('BK-002', { Cartons: -5, 'Total declared value': 0, 'Total gross weight (kg)': -100 }), book('BK-003'), book('BK-004', { Pallets: 2.5 }), book('BK-005', { Pallets: 0 })],
    [itm('BK-001'), itm('BK-002'),
      itm('BK-003', { SKU: 'Q0', 'Quantity (units)': 0 }), itm('BK-003', { SKU: 'P5', 'Unit price': -5 }), itm('BK-003', { SKU: 'W0', 'Unit weight (kg)': 0 }), itm('BK-003', { SKU: 'U0', 'Units per carton': 0 }),
      itm('BK-004'), itm('BK-005')]);
  const by = (id: string) => f.bookings.find((b: any) => b.id === id);

  it('the clean booking is unaffected', () => {
    const e = ev(by('BK-001'));
    expect(e.status).toBe('clear');
    expect(e.rec.recommended.carrier).toBe('Carrier A');
  });
  it('item cells: each bad value is its own Red input error naming sheet, row and value', () => {
    const msgs = inputs(by('BK-003')).map((i: any) => i.what);
    expect(msgs).toEqual(expect.arrayContaining([
      'BK-003 · Items sheet, row 5 · Quantity is 0. Enter a whole number greater than 0.',
      'BK-003 · Items sheet, row 6 · Unit price is -5. Enter a number greater than 0.',
      'BK-003 · Items sheet, row 7 · Unit weight is 0. Enter a number greater than 0.',
      'BK-003 · Items sheet, row 8 · Units per carton is 0. Enter a whole number greater than 0.',
    ]));
    expect(inputs(by('BK-003'))).toHaveLength(4);
    expect(inputs(by('BK-003')).every((i: any) => i.sev === 'red')).toBe(true);
  });
  it('dependent rules are n/a with an explanation, not misleading results', () => {
    const e = ev(by('BK-003'));
    for (const r of ['R-02', 'R-03', 'R-07']) expect(e.ruleStatus[r]).toBe('na');
    expect(e.issues.some((i: any) => ['R-02', 'R-03', 'R-07'].includes(i.rule))).toBe(false);
    expect(inputs(by('BK-003')).map((i: any) => i.fix).join(' ')).toMatch(/skipped for this booking because of this input error/);
  });
  it('booking fields: Cartons -5, declared value 0, gross weight -100 are three separate Red input errors', () => {
    const msgs = inputs(by('BK-002')).map((i: any) => i.what);
    expect(msgs).toEqual(expect.arrayContaining([
      'BK-002 · Bookings sheet, row 4 · Cartons is -5. Enter a whole number greater than 0.',
      'BK-002 · Bookings sheet, row 4 · Total declared value is 0. Enter a number greater than 0.',
      'BK-002 · Bookings sheet, row 4 · Total gross weight is -100. Enter a number greater than 0.',
    ]));
    expect(msgs).toHaveLength(3);
    const e = ev(by('BK-002'));
    for (const r of ['R-02', 'R-04', 'R-05', 'R-07']) expect(e.ruleStatus[r]).toBe('na');
  });
  it('no carrier is recommended while pallets or gross weight is invalid, and the reason is plain English', () => {
    for (const id of ['BK-002', 'BK-004', 'BK-005']) {
      const e = ev(by(id));
      expect(e.rec.recommended).toBeNull();
      expect(e.rec.blocked).toBe(true);
      expect(e.rec.reason).toBe('Fix the input errors above to get a carrier recommendation.');
    }
  });
  it('pallets 0 and 2.5 are still rejected', () => {
    expect(inputs(by('BK-005'))[0].what).toBe('BK-005 · Bookings sheet, row 7 · Pallets is 0. Enter a whole number greater than 0.');
    expect(inputs(by('BK-004'))[0].what).toContain('Pallets is 2.5, but it must be a whole number');
  });
  it('every bad booking is blocked and cannot be booked', () => {
    for (const id of ['BK-002', 'BK-003', 'BK-004', 'BK-005']) expect(ev(by(id)).status).toBe('blocked');
  });
});

describe('Bug 3: a row with data but no Booking ID', () => {
  const f = file(
    [book('BK-001'), book('', { 'Seller name': 'Ghost Ltd' }), blank(15), book('  bk-002 ', { Pallets: 2 }), book('   ', { 'Seller name': 'Spaces Ltd' })],
    [itm('BK-001'), itm('BK-002'), itm('', { SKU: 'ORPHAN' }), blank(10), itm('  ', { SKU: 'SPACE' })]);
  it('is shown, not dropped: the count equals the non-empty data rows', () => {
    expect(f.bookings).toHaveLength(4);                       // BK-001, two rows with no ID, BK-002 (the blank row is ignored)
    expect(f.bookings.filter((b: any) => !b.id)).toHaveLength(2);
  });
  it('each is a Red input error with the row number, and cannot be booked', () => {
    const noId = f.bookings.filter((b: any) => !b.id);
    expect(inputs(noId[0])[0].what).toBe('Bookings sheet, row 4 has no Booking ID. Add one and upload again.');
    expect(inputs(noId[1])[0].what).toBe('Bookings sheet, row 7 has no Booking ID. Add one and upload again.');
    for (const b of noId) { expect(ev(b).status).toBe('blocked'); expect(ev(b).issues.some((i: any) => i.title === 'No items found')).toBe(false); }
  });
  it('a completely blank row is ignored with no notice', () => {
    expect(f.warnings.join(' ')).not.toMatch(/Bookings sheet, row 5\b/);
    expect(f.bookings.some((b: any) => b._row === 5)).toBe(false);
  });
  it('an item row with data but no Booking ID is a visible warning with its row number, never a silent drop', () => {
    expect(f.warnings).toEqual(expect.arrayContaining([
      'Items sheet, row 5 has no Booking ID, so it was ignored.',
      'Items sheet, row 7 has no Booking ID, so it was ignored.',
    ]));
  });
  it('the summary table shows "(no ID)" with a Red status', () => {
    const html = renderToStaticMarkup(UploadResults({ upload: { fileName: 'x.xlsx', bookings: f.bookings, warnings: f.warnings }, sel: null, setSel: () => {}, filter: 'all', setFilter: () => {}, thumpKey: 0, aiOn: false, h: handlers }) as any);
    expect(text(html)).toContain('(no ID)');
    expect((text(html).match(/\(no ID\)/g) || []).length).toBe(2);
    expect(text(html)).toMatch(/Needs fixing/);
    noBadText(html);
  });
});

describe('P1: Booking IDs are trimmed and shown normalised', () => {
  const f = file([book('  bk-002 '), book('bk-001')], [itm('BK-002'), itm(' BK-001')]);
  it('"  bk-002 " is BK-002 everywhere, and items still link case-insensitively', () => {
    expect(f.bookings.map((b: any) => b.id)).toEqual(['BK-002', 'BK-001']);
    expect(f.bookings.every((b: any) => b.items.length === 1)).toBe(true);
    const html = renderToStaticMarkup(UploadResults({ upload: { fileName: 'x.xlsx', bookings: f.bookings, warnings: f.warnings }, sel: null, setSel: () => {}, filter: 'all', setFilter: () => {}, thumpKey: 0, aiOn: false, h: handlers }) as any);
    expect(text(html)).toContain('BK-002');
    expect(text(html)).not.toMatch(/bk-002/);
  });
  it('an issue names the normalised ID', () => {
    const g = file([book('  bk-009 ', { Pallets: 0 })], [itm('BK-009')]);
    expect(inputs(g.bookings[0])[0].what).toMatch(/^BK-009 · Bookings sheet, row 3/);
  });
});

describe('P2 and rendered output: no NaN, Infinity or undefined anywhere', () => {
  const f = file(
    [book('BK-001'), book('BK-002', { Cartons: -5, 'Total declared value': 0, 'Total gross weight (kg)': -100 }), book('BK-003', { Pallets: 0 }), book('', {}), book('BK-005', { Pallets: null, 'Total gross weight (kg)': 'abc' })],
    [itm('BK-001'), itm('BK-002', { 'Quantity (units)': 0, 'Unit price': -5, 'Unit weight (kg)': 0, 'Units per carton': 0, 'HS code': '000000' }), itm('BK-003'), itm('BK-005', { 'Quantity (units)': 'x', 'Unit price': null })]);
  it('the summary table shows "—" for the carrier on rows with a blocked recommendation', () => {
    const html = renderToStaticMarkup(UploadResults({ upload: { fileName: 'x.xlsx', bookings: f.bookings, warnings: f.warnings }, sel: null, setSel: () => {}, filter: 'all', setFilter: () => {}, thumpKey: 0, aiOn: false, h: handlers }) as any);
    noBadText(html);
    const rows = [...html.matchAll(/<tr[^>]*aria-label="Open [^"]*"[^>]*>(.*?)<\/tr>/g)].map(m => text(m[1]).replace(/\s+/g, ' ').trim());
    expect(rows.length).toBe(5);
    expect(rows[0]).toMatch(/BK-001.*Carrier A, £540.*Ready to book/);
    for (const i of [1, 2, 4]) { expect(rows[i]).not.toMatch(/£/); expect(rows[i]).toMatch(/—/); }   // invalid pallets or weight: no carrier, shown as a dash
    expect(rows[3]).toMatch(/^\(no ID\).*Needs fixing/);                                          // valid numbers, but no ID: Red and not bookable
  });
  it('every booking detail view renders without bad text, and explains why there is no carrier', () => {
    for (const b of f.bookings) {
      const html = renderToStaticMarkup(Detail({ b, aiOn: false, thumpKey: 0, opts: { fix: () => {}, book: () => {}, reset: () => {}, booking: false, ack: () => {} } }) as any);
      noBadText(html);
      if (ev(b).rec.blocked) expect(text(html)).toContain('Fix the input errors above to get a carrier recommendation');
    }
  });
  it('summarise and the results rows never contain bad text', () => {
    for (const b of f.bookings) noBadText(JSON.stringify(PF.summarise(b, ev(b))).replace(/"/g, ' ') + JSON.stringify(ev(b).issues));
  });
});

const handlers = { fix: () => {}, book: () => {}, reset: () => {}, ack: () => {}, bookAllClear: () => {}, download: () => {}, busy: false, bulk: null } as any;

describe('chat and "Fix it here" refuse the same values, keep the old value and ask again', async () => {
  const { C } = await import('../lib/pf');
  const { applyChange } = await import('../lib/fixes');
  const ready = () => { const c = C.newChat(); for (const m of ['600 ceramic mugs to Frankfurt', 'Acme, Leeds, business address, ready 5 Nov, cheapest', '£5 each, 12 per carton, 0.5 kg each, HS 691200, made in UK', "that's everything", '3 pallets, 50 cartons, 400 kg, declared £3,000']) C.step(c, m, {}); return c; };
  it.each(['0', '-5', '2.5'])('chat: "make it %s pallets" is refused, 3 is kept, pallets are asked for again', v => {
    const c = ready();
    const log = C.step(c, `make it ${v} pallets`, {});
    expect(c.b.pallets).toBe(3);
    expect(log.rejected.map((r: any) => r.field)).toContain('pallets');
    expect(log.rejected[0].message).toMatch(/How many pallets are you sending\?$/);
  });
  it('chat: an all-zero HS code is refused and asked for again; the old code is kept', () => {
    const c = ready();
    const log = C.step(c, 'change the HS code to 000000', {});
    expect(c.b.items[0].hs).toBe('691200');
    expect(log.rejected[0].message).toMatch(/all zeros.*What is the real code\?/);
  });
  it.each([0, -5, 2.5, 'abc', '0', '000000'])('Fix it here: %j is refused for pallets and for HS, and the old value is kept', v => {
    const b: any = { pallets: 2, items: [{ sku: 'A', hs: '691200', qty: 10, price: 1, upc: 10, cartons: 1, unitWeight: 1 }] };
    expect((applyChange(b, { kind: 'set', field: 'pallets', value: v, rule: 'x' }) as any).ok).toBe(false);
    expect(b.pallets).toBe(2);
    if (typeof v === 'string') { expect((applyChange(b, { kind: 'set', field: 'hs', value: v, itemIndex: 0, rule: 'x' }) as any).ok).toBe(false); expect(b.items[0].hs).toBe('691200'); }
  });
});
