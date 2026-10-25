// Reproduces the live test cases (today is mocked to 26-10-2026) and the hardening requirements, with exact expected outputs.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as XLSX from 'xlsx';
import { PF, C } from '../lib/pf';
import { checkBooking } from '../lib/server/booking';
import { parseDateText } from '../lib/parse/dates';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T12:00:00')); });
afterEach(() => vi.useRealTimers());

const item = (o: any = {}) => ({ sku: 'A-1', desc: 'Ceramic mug', hs: '691200', qty: 100, price: 1, upc: 10, cartons: 10, unitWeight: 0.1, coo: 'China', ...o });
const booking = (o: any = {}) => ({
  id: 'T-1', seller: 'Acme', originCity: 'Leeds', originCountry: 'United Kingdom', destCity: 'Frankfurt', destCountry: 'Germany', destType: 'Business address',
  readyDate: '2026-11-05', priority: 'Cheapest', pallets: 2, cartons: 10, declaredValue: 100, grossWeight: 1500, appointment: 'Yes', items: [item()], ...o,
});
const ev = (b: any) => PF.evaluate(b);
const rules = (b: any) => ev(b).issues.map((i: any) => i.rule);
const issue = (b: any, rule: string) => ev(b).issues.find((i: any) => i.rule === rule);
const chat = (...msgs: string[]) => { const c = C.newChat(); let log: any; for (const m of msgs) log = C.step(c, m, {}); return { c, log }; };

describe('1. dates (A1, B2)', () => {
  it('"ready date tomorrow" is 27-10-2026', () => {
    const { c } = chat('I am Acme, from Leeds to a warehouse in Paris, 2 pallets, ready date tomorrow');
    expect(c.b.readyDate).toBe('2026-10-27');
    expect(C.ackText(chat('ready date tomorrow').log)).toContain('27-10-2026');
  });
  it('"ready to ship today" is 26-10-2026 and R-10 passes; "20-10-2026" is Amber', () => {
    expect(chat('ready to ship today').c.b.readyDate).toBe('2026-10-26');
    expect(rules(booking({ readyDate: '2026-10-26' }))).not.toContain('R-10');
    const r = issue(booking({ readyDate: '2026-10-20' }), 'R-10');
    expect(r.sev).toBe('amber');
    expect(rules(booking({ readyDate: '2026-10-25' }))).toContain('R-10');
  });
  it.each([
    ['day after tomorrow', '2026-10-28'], ['in 3 days', '2026-10-29'], ['in two weeks', '2026-11-09'], ['next Monday', '2026-11-02'],
    ['this Friday', '2026-10-30'], ['5 Nov', '2026-11-05'], ['5th November', '2026-11-05'], ['05/11/2026', '2026-11-05'], ['05-11-2026', '2026-11-05'], ['1-2-2027', '2027-02-01'],
  ])('"%s" resolves to %s (day first, never month first)', (phrase, iso) => {
    expect(parseDateText('ready ' + phrase, '2026-10-26').iso).toBe(iso);
  });
  it('vague phrases ask for an exact date instead of guessing', () => {
    for (const p of ['next week', 'end of the month', 'asap', 'in a few days']) {
      const r = parseDateText('ready ' + p, '2026-10-26');
      expect(r.iso).toBeUndefined();
      expect(r.ambiguous).toBeTruthy();
    }
    const { c, log } = chat('ready next week');
    expect(c.b.readyDate == null).toBe(true);
    expect(log.dateProblem.ambiguous).toBe('next week');
  });
  it('a model-supplied date is never used', () => {
    const c = C.newChat();
    const exAI = C.aiToEx({ readyDate: '26-10-2026', seller: 'Acme' }, c);
    expect(exAI.b.readyDate).toBeUndefined();
    C.stepAI(c, 'ready date tomorrow', { b: { readyDate: '2026-10-26' }, item: {}, rel: [], sets: [], flags: {}, items: null, unsupported: null });
    expect(c.b.readyDate).toBe('2026-10-27');
  });
  it('a date cell for 27-10-2026 stays 27-10-2026, and "05-11-2026" text is 5 November', () => {
    expect(PF.parseDate(new Date(Date.UTC(2026, 9, 27)))).toBe('2026-10-27');
    expect(PF.parseDate(46322)).toBe('2026-10-27');                // Excel serial for 27-10-2026
    expect(PF.parseDate('05-11-2026')).toBe('2026-11-05');
    expect(PF.parseDate('5/11/2026')).toBe('2026-11-05');
    expect(PF.parseDate('31-02-2026')).toBeNull();
  });
});

describe('2-3. carrier recommendation and R-05 (A2, A5)', () => {
  it('UK→Germany, Cheapest, 2 pallets, 1,500 kg → Carrier B £440, R-05 passes, note explains why A was ruled out', () => {
    const e = ev(booking());
    expect(e.rec.recommended.carrier).toBe('Carrier B');
    expect(e.rec.recommended.price * e.rec.pallets).toBe(440);
    expect(rules(booking())).not.toContain('R-05');
    const note = e.rec.ruledOutNotes[0];
    expect(note).toContain('Carrier A (cheapest per pallet) was ruled out');
    expect(note).toContain('750 kg per pallet exceeds its 500 kg limit');
    expect(note).toContain('With 3 pallets it would fit at £540');
    expect(note).toContain('Carrier B at 2 pallets is cheaper at £440');
  });
  it('same load on 3 pallets → Carrier A £540 (exactly 500 kg per pallet passes)', () => {
    const b = booking({ pallets: 3 });
    const e = ev(b);
    expect(e.rec.recommended.carrier).toBe('Carrier A');
    expect(e.rec.recommended.price * 3).toBe(540);
    expect(rules(b)).not.toContain('R-05');
  });
  it('4,000 kg on 4 pallets, Leeds→Lyon → R-05 Red with the pallets each carrier needs', () => {
    const b = booking({ pallets: 4, grossWeight: 4000, destCity: 'Lyon', destCountry: 'France' });
    const i = issue(b, 'R-05');
    expect(i.sev).toBe('red');
    expect(ev(b).rec.recommended).toBeNull();
    expect(i.fix).toContain('Carrier C needs 10 pallets (£3,300');
    expect(i.fix).toContain('Carrier A needs 8 pallets (£1,360');
    expect(i.fix).toContain('Carrier B needs 6 pallets (£1,260');
  });
  it('exactly at the limit passes, one kg over is ruled out', () => {
    expect(ev(booking({ pallets: 1, grossWeight: 500 })).rec.options.find((o: any) => o.carrier === 'Carrier A').eligible).toBe(true);
    expect(ev(booking({ pallets: 1, grossWeight: 501 })).rec.options.find((o: any) => o.carrier === 'Carrier A').eligible).toBe(false);
  });
  it('pallets 0, blank or negative give a clear error, never Infinity or NaN', () => {
    for (const pallets of [0, null, -2, 2.5]) {
      const e = ev(booking({ pallets }));
      expect(e.issues.some((i: any) => i.rule === 'DATA' && /Pallet count/.test(i.title))).toBe(true);
      expect(JSON.stringify(e.issues)).not.toMatch(/Infinity|NaN/);
      expect(e.rec.wpp).toBeNull();
    }
  });
  it('tie-breaks are deterministic: price, then days, then carrier letter', () => {
    const tie = PF.rankBy([{ carrier: 'Carrier B', price: 100, transit: 3, ontime: 90 }, { carrier: 'Carrier A', price: 100, transit: 3, ontime: 90 }], 'Cheapest');
    expect(tie.map((o: any) => o.carrier)).toEqual(['Carrier A', 'Carrier B']);
  });
  it('Balanced: documented min-max score over feasible carriers, equal thirds, with numbers in the reason', () => {
    const e = ev(booking({ priority: 'Balanced', pallets: 3, grossWeight: 300 }));
    // price 340/220/180, days 2/3/5, on-time 98/95/92: C = (0+1+1)/3, B = (.75+.667+.5)/3, A = (1+0+0)/3
    expect(e.rec.recommended.carrier).toBe('Carrier C');
    expect(e.rec.reason).toContain('£340 a pallet, 2 days, 98% on time');
    expect(e.rec.reason).toContain('weights the three equally');
    expect(e.rec.reason).toMatch(/Scores: C 0\.67, B 0\.64, A 0\.33/);
    expect(e.rec.reason).toContain('The others lost');
  });
  it('Balanced only compares carriers that can take the load', () => {
    const e = ev(booking({ priority: 'Balanced', pallets: 1, grossWeight: 700 }));   // only B can take 700 kg
    expect(e.rec.recommended.carrier).toBe('Carrier B');
    expect(e.rec.ruledOutNotes.length).toBe(2);
  });
});

describe('4-6. R-02, R-03, R-04 (B3, B6)', () => {
  const sized = (declaredValue: number, o: any = {}) => booking({ declaredValue, items: [item({ qty: 500, price: 5, upc: 10, cartons: 50 })], cartons: 50, ...o });
  it('500 × £5 = £2,500, declared £3,000 → R-02 Red, set to £2,500, 20% higher', () => {
    const i = issue(sized(3000), 'R-02');
    expect(i.sev).toBe('red');
    expect(i.what).toContain('20% higher');
    expect(i.fix).toContain('Set the declared value to £2,500');
  });
  it('exactly 1% passes, a penny more fails, and blank or zero gives a clear message', () => {
    expect(rules(sized(2525))).not.toContain('R-02');
    expect(rules(sized(2475))).not.toContain('R-02');
    expect(rules(sized(2525.01))).toContain('R-02');
    expect(issue(sized(0), 'R-02').what).toContain('£0');
    expect(ev(sized(null as any)).issues.some((i: any) => /Declared value missing/.test(i.title))).toBe(true);
    expect(JSON.stringify(ev(sized(0)).issues)).not.toMatch(/NaN|Infinity/);
  });
  it('sums every item of the booking, with pence handled safely', () => {
    const b = booking({ declaredValue: 0.3, cartons: 2, items: [item({ qty: 1, price: 0.1, upc: 1, cartons: 1 }), item({ sku: 'B', qty: 1, price: 0.2, upc: 1, cartons: 1 })] });
    expect(rules(b)).not.toContain('R-02');          // 0.1 + 0.2 is 0.30000000000000004 in floating point
  });
  it('10 per carton × 60 cartons vs quantity 500 → R-03 offers 50 cartons or 600 units; applying 50 leaves R-04 expecting 50', () => {
    const b = booking({ cartons: 60, declaredValue: 2500, items: [item({ qty: 500, price: 5, upc: 10, cartons: 60 })] });
    const i = issue(b, 'R-03');
    expect(i.sev).toBe('red');
    expect(i.fix).toContain('50 cartons');
    expect(i.fix).toContain('600 units');
    b.items[0].cartons = 50;
    expect(rules(b)).not.toContain('R-03');
    const r4 = issue(b, 'R-04');
    expect(r4.sev).toBe('red');
    expect(r4.fix).toContain('Set total cartons to 50');
  });
  it('a non-whole number of cartons says so instead of showing a decimal', () => {
    const i = issue(booking({ items: [item({ qty: 505, upc: 10, cartons: 50, price: 1 })] }), 'R-03');
    expect(i.fix).toMatch(/whole number of cartons/);
    expect(i.fix).not.toMatch(/50\.5/);
  });
});

describe('6-7. chat scope, SKU and currency (A3, A4)', () => {
  it('"Ship 4 pallets of gel to Madrid" is refused in the same reply and Madrid is not stored', () => {
    const { c, log } = chat('Ship 4 pallets of gel to Madrid');
    expect(log.scope.join(' ')).toContain('I can’t deliver to Madrid');
    expect(log.scope.join(' ')).toContain('London, Manchester, Birmingham and Leeds');
    expect(log.scope.join(' ')).toContain('Amsterdam, Rotterdam');
    expect(c.b.destCity).toBeNull();
    expect(c.b.destCountry).toBeNull();
    expect(c.b.pallets).toBe(4);
  });
  it('unsupported origin, mismatched city and country, city only, country only, misspellings', () => {
    expect(chat('Collect 4 pallets from Glasgow to Paris').log.scope.join(' ')).toContain('I can’t collect from Glasgow');
    expect(chat('Collect 4 pallets from Glasgow to Paris').c.b.originCity).toBeNull();
    const mm = chat('Deliver to Lyon, Germany');
    expect(mm.log.scope.join(' ')).toContain('Lyon is in France, not Germany');
    expect(mm.c.b.destCity).toBeNull();
    expect(chat('Deliver to Lyon').c.b.destCountry).toBe('France');
    const g = chat('Deliver to Germany');
    expect(g.c.b.destCountry).toBe('Germany');
    expect(g.c.b.destCity).toBeNull();
    expect(chat('Deliver to Frankfurt am Main').c.b.destCity).toBe('Frankfurt');
    expect(chat('Deliver to Rotterdm').c.b.destCity).toBe('Rotterdam');
  });
  it('does not false-flag ordinary words', () => {
    expect(chat('100 cork coasters from Leeds to Paris').log.scope).toEqual([]);
    expect(chat('mugs made in China from Leeds to Paris').log.scope).toEqual([]);
    expect(chat('a nice gift from Leeds to Paris').log.scope).toEqual([]);
  });
  it('non-GBP currency is explained and the amounts are not stored', () => {
    for (const msg of ['100 mugs at 5 euros each from Leeds to Paris', 'declared value $500 from Leeds to Paris', 'mugs at €5 each from Leeds to Paris']) {
      const { c, log } = chat(msg);
      expect(log.scope.join(' ')).toContain('only work in pounds');
      expect(c.b.declaredValue).toBeNull();
      expect(c.b.items.every((i: any) => i.price == null)).toBe(true);
    }
  });
  it('a stated SKU is kept exactly; no SKU stays blank and nothing is invented', () => {
    expect(chat('200 ceramic mugs from Leeds to Paris, SKU HS-1').c.b.items[0].sku).toBe('HS-1');
    expect(chat('200 ceramic mugs, SKU is HS-1').c.b.items[0].sku).toBe('HS-1');
    expect(chat('200 ceramic mugs from Leeds to Paris').c.b.items[0].sku).toBeNull();
    expect(chat('200 ceramic mugs from Leeds to Paris, no SKU yet').c.b.items[0].sku).toBeNull();
  });
  it('a SKU the model invents is dropped when the seller did not type it', () => {
    const c = C.newChat();
    const ex = C.aiToEx({ seller: 'Acme', items: [{ desc: 'Hand cream', sku: 'HAND-01', qty: 10 }] }, c);
    C.stepAI(c, 'I sell 10 hand cream', ex);
    expect(c.b.items[0].sku == null).toBe(true);
  });
});

describe('8. R-01 HS codes (B4)', () => {
  const hs = (v: any) => rules(booking({ items: [item({ hs: v })] })).filter((r: string) => r === 'R-01').length;
  it('"6912.00" passes; "6912" fails; blank fails; "TBC" fails; 691200.0 as a number passes', () => {
    expect(hs('6912.00')).toBe(0);
    expect(hs('6912 00')).toBe(0);
    expect(hs(691200.0)).toBe(0);
    expect(hs('6912')).toBe(1);
    expect(hs(null)).toBe(1);
    expect(hs('')).toBe(1);
    expect(hs('TBC')).toBe(1);
    expect(hs('N/A')).toBe(1);
  });
  it('a 5-digit numeric code mentions a dropped leading zero', () => {
    const i = issue(booking({ items: [item({ hs: 90111 })] }), 'R-01');
    expect(i.what).toMatch(/leading zero/);
    expect(i.fix).toMatch(/text/);
  });
});

describe('9. R-06 restricted goods (B7)', () => {
  const flagged = (d: string) => !!PF.hazardOf({ desc: d, sku: '' });
  it.each(['Power bank (lithium battery)', 'Deodorant spray', 'Alcohol-based hand sanitiser gel', 'Li-Po battery pack', 'LiFePO4 cell', 'Lithium-ion torch',
    'Butane gas canister', 'Spray can of paint', 'Pressurised container', 'Lighter fluid', 'White spirit 1L', 'Acetone nail polish remover', 'Ethanol-based sanitizer', 'Perfume 50ml',
    'Aftershave balm', 'Box of matches', 'Cigarette lighters', 'Gadget, batteries not included', 'Hairspray aerosol'])('flags "%s"', d => expect(flagged(d)).toBe(true));
  it.each(['Battery-free phone stand', 'Lithium soap bar', 'Non-aerosol spray bottle', 'Scented candle', 'Ceramic mug', 'Olive oil 500 ml', 'Lighter weight cotton shirt', 'Alcohol-free wipes',
    'Phone case, no battery', 'Torch without batteries'])('does not flag "%s"', d => expect(flagged(d)).toBe(false));
  it('shows which word triggered the flag, with the fix', () => {
    const i = issue(booking({ items: [item({ desc: 'Power bank (lithium battery)' })] }), 'R-06');
    expect(i.what).toMatch(/matched “/);
    expect(i.fix).toMatch(/correct the description/);
  });
});

describe('R-07 to R-10 (B8)', () => {
  it('R-07 only when gross is below the items, equal passes, and states the minimum', () => {
    const b = booking({ grossWeight: 5, pallets: 1, items: [item({ qty: 100, unitWeight: 0.1, upc: 10, cartons: 10 })] });   // items weigh 10 kg
    expect(issue(b, 'R-07').fix).toContain('at least 10 kg');
    expect(rules({ ...b, grossWeight: 10 })).not.toContain('R-07');
  });
  it('R-08 only for warehouses without an appointment', () => {
    expect(rules(booking({ destType: 'Warehouse', appointment: 'No' }))).toContain('R-08');
    expect(rules(booking({ destType: 'Warehouse', appointment: 'Yes' }))).not.toContain('R-08');
    expect(rules(booking({ destType: 'Business address', appointment: 'No' }))).not.toContain('R-08');
  });
  it('R-09 treats blank, whitespace, N/A, - and unknown as missing', () => {
    for (const coo of [null, '', '   ', 'N/A', 'n/a', '-', 'unknown', 'Unknown']) expect(rules(booking({ items: [item({ coo })] }))).toContain('R-09');
    expect(rules(booking({ items: [item({ coo: 'China' })] }))).not.toContain('R-09');
  });
});

// ---------------- uploads ----------------
const BH = PF.BH, IH = PF.IH;
const book = (id: string, over: any = {}) => {
  const b = { 'Booking ID': id, 'Seller name': 'Northfield Goods', 'Origin city': 'Manchester', 'Origin country': 'United Kingdom', 'Destination city': 'Frankfurt', 'Destination country': 'Germany', 'Destination type': 'Warehouse',
    'Ready to ship date': '05-11-2026', 'Seller priority': 'Cheapest', Pallets: 3, Cartons: 90, 'Total declared value': 5400, Currency: 'GBP', 'Total gross weight (kg)': 620, 'Delivery appointment booked': 'Yes', ...over };
  return BH.map((h: string) => b[h]);
};
const itm = (id: string, over: any = {}) => {
  const i = { 'Booking ID': id, SKU: 'MUG-01', Description: 'Ceramic coffee mug, 350 ml', 'HS code': '691200', 'Quantity (units)': 1080, 'Unit price': 5, 'Units per carton': 12, Cartons: 90, 'Unit weight (kg)': 0.5, 'Country of origin': 'United Kingdom', ...over };
  return IH.map((h: string) => i[h]);
};
const workbook = (opts: { bookings: any[][]; items: any[][]; bookingsName?: string; itemsName?: string; titleRow?: boolean; extraSheets?: boolean }) => {
  const wb = XLSX.utils.book_new();
  const title = (t: string) => (opts.titleRow === false ? [] : [[t]]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...title('Bookings: one row per record. Row 3 is an example (grey); enter data from row 4.'), BH, ...opts.bookings]), opts.bookingsName ?? 'Bookings');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...title('Items: one row per record.'), IH, ...opts.items]), opts.itemsName ?? 'Items');
  if (opts.extraSheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Carrier', 'Price'], ['Carrier A', 1], ['Carrier B', 1]]), 'Carrier options');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Rule', 'Check'], ['R-01', 'changed rule text']]), 'Rulebook');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Term', 'Meaning']]), 'Glossary');
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellDates: true }) as ArrayBuffer;
};
const parse = (opts: Parameters<typeof workbook>[0]) => PF.parseWorkbook(XLSX, workbook(opts));

describe('10. official template and multi-booking files (B1, B5)', () => {
  it('the grey example row alone is processed as BK-001 with correct results', () => {
    const r = parse({ bookings: [book('BK-001')], items: [itm('BK-001')], extraSheets: true });
    expect(r.error).toBeUndefined();
    expect(r.bookings).toHaveLength(1);
    const b = r.bookings[0], e = ev(b);
    expect(b.id).toBe('BK-001');
    expect(e.status).toBe('clear');
    expect(e.calc.sumVal).toBe(5400);
    expect(e.calc.sumWt).toBe(540);
    expect(e.calc.wpp).toBeCloseTo(206.67, 1);
    expect(e.rec.recommended.carrier).toBe('Carrier A');
    expect(PF.nf(e.calc.wpp)).toBe('206.7');
  });
  it('works with headers in row 1, blank rows, whitespace rows, odd sheet case and extra reference sheets', () => {
    const r = parse({ titleRow: false, bookings: [book('BK-001'), [null, '  ', null], book('bk-002')], items: [itm('BK-001'), [], itm('BK-002')], bookingsName: ' bookings ', itemsName: 'ITEMS', extraSheets: true });
    expect(r.error).toBeUndefined();
    expect(r.bookings.map((b: any) => b.id)).toEqual(['BK-001', 'bk-002']);
    expect(r.bookings[1].items).toHaveLength(1);                 // IDs link case-insensitively
  });
  it('five bookings (clean, single mistakes, several mistakes) each get their own result, with sheet rows', () => {
    const r = parse({
      bookings: [book('BK-001'), book('BK-002', { 'Total declared value': 6000 }), book('BK-003', { 'Ready to ship date': '20-10-2026' }), book('BK-004', { 'Delivery appointment booked': 'No' }), book('BK-005', { Cartons: 80, 'Total declared value': 6000 })],
      items: [itm('BK-001'), itm('BK-002'), itm('BK-003'), itm('BK-004'), itm('BK-005', { 'HS code': null, 'Country of origin': 'N/A' })],
    });
    const out = r.bookings.map((b: any) => [b.id, ev(b).status, rules(b).join(',')]);
    expect(out).toEqual([
      ['BK-001', 'clear', ''], ['BK-002', 'blocked', 'R-02'], ['BK-003', 'warning', 'R-10'], ['BK-004', 'warning', 'R-08'], ['BK-005', 'blocked', 'R-01,R-02,R-04,R-09'],
    ]);
    const hs = issue(r.bookings[4], 'R-01');
    expect(hs.sheet).toBe('Items');
    expect(hs.row).toBe(7);                                       // title row 1, header row 2, BK-005's item is the 5th data row
    expect(hs.bookingId).toBe('BK-005');
    expect(issue(r.bookings[1], 'R-02').row).toBe(4);             // Bookings sheet, BK-002 is the 2nd data row
  });
  // Real Excel files store a date as a plain serial number plus a date format, with no timezone. 46322 is 27-10-2026.
  const withDateCell = (bookType: 'xlsx' | 'ods') => {
    const ws = XLSX.utils.aoa_to_sheet([BH, book('BK-001', { 'Ready to ship date': 0 })]);
    const col = BH.indexOf('Ready to ship date');
    ws[XLSX.utils.encode_cell({ r: 1, c: col })] = { t: 'n', v: 46322, z: 'dd-mm-yyyy' };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Bookings');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([IH, itm('BK-001')]), 'Items');
    return PF.parseWorkbook(XLSX, XLSX.write(wb, { type: 'array', bookType }));
  };
  it('a real .xlsx date cell for 27-10-2026 stays 27-10-2026 in every timezone', () => {
    expect(withDateCell('xlsx').bookings[0].readyDate).toBe('2026-10-27');
  });
  it('a real .ods date cell for 27-10-2026 stays 27-10-2026 in every timezone', () => {
    expect(withDateCell('ods').bookings[0].readyDate).toBe('2026-10-27');
  });
  it('an unreadable date is a clear row-level error, not a silent pass', () => {
    const r = parse({ bookings: [book('BK-001', { 'Ready to ship date': 'soon-ish' })], items: [itm('BK-001')] });
    const i = ev(r.bookings[0]).issues.find((x: any) => /Ready date/.test(x.title));
    expect(i.what).toContain('soon-ish');
    expect(i.fix).toContain('DD-MM-YYYY');
    expect(i.row).toBe(3);
  });
  it('numbers and text stored as text are read: "1,080", "£5.00", " 12 "', () => {
    const r = parse({ bookings: [book('BK-001', { Pallets: ' 3 ', Cartons: '90', 'Total declared value': '£5,400.00', 'Total gross weight (kg)': '620 ' })], items: [itm('BK-001', { 'Quantity (units)': '1,080', 'Unit price': '£5.00', 'Units per carton': ' 12 ' })] });
    expect(ev(r.bookings[0]).status).toBe('clear');
  });
  it('appointment accepts Yes, yes, Y and TRUE', () => {
    for (const v of ['Yes', 'yes', 'Y', 'TRUE', true]) {
      const r = parse({ bookings: [book('BK-001', { 'Delivery appointment booked': v })], items: [itm('BK-001')] });
      expect(rules(r.bookings[0])).not.toContain('R-08');
    }
  });
});

describe('12. broken files give specific messages and never crash (B1, B5)', () => {
  it('orphan items, bookings with no items and duplicate Booking IDs', () => {
    const r = parse({
      bookings: [book('BK-001'), book('BK-002'), book('BK-003'), book('bk-003')],
      items: [itm('BK-001'), itm('BK-003'), itm('BK-999', { SKU: 'GHOST' })],
    });
    expect(r.error).toBeUndefined();
    expect(r.warnings.join(' ')).toMatch(/BK-999.*Items sheet, row 5.*no matching booking/);
    expect(r.warnings.join(' ')).toMatch(/BK-003.*appears 2 times.*rows 5, 6/);
    const none = ev(r.bookings.find((b: any) => b.id === 'BK-002'));
    expect(none.issues.some((i: any) => i.title === 'No items found')).toBe(true);
    expect(none.ruleStatus['R-02']).toBe('na');                    // no misleading value or carton mismatch
    expect(none.ruleStatus['R-04']).toBe('na');
    expect(none.issues.some((i: any) => i.rule === 'R-02' || i.rule === 'R-04')).toBe(false);
    const dups = r.bookings.filter((b: any) => b.id.toLowerCase() === 'bk-003');
    expect(dups).toHaveLength(2);
    dups.forEach((b: any) => expect(ev(b).issues.some((i: any) => i.title === 'Duplicate Booking ID')).toBe(true));
  });
  it('a missing sheet names exactly what is missing', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([BH, book('BK-001')]), 'Bookings');
    const r = PF.parseWorkbook(XLSX, XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    expect(r.error).toMatch(/couldn’t find a sheet called Items/);
    expect(r.error).toMatch(/“Bookings”/);
  });
  it('a missing column names exactly which one', () => {
    const wb = XLSX.utils.book_new();
    const heads = BH.filter((h: string) => h !== 'Pallets');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([heads, heads.map(() => 'x')]), 'Bookings');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([IH.filter((h: string) => h !== 'HS code'), []]), 'Items');
    const r = PF.parseWorkbook(XLSX, XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    expect(r.error).toContain('The Bookings sheet is missing the column: Pallets.');
    expect(r.error).toContain('The Items sheet is missing the column: HS code.');
  });
  it('garbage input never throws', () => {
    expect(PF.parseWorkbook(XLSX, new Uint8Array([1, 2, 3, 4]).buffer).error || 'ok').toBeTruthy();
    expect(() => PF.parseWorkbook(XLSX, new ArrayBuffer(0))).not.toThrow();
  });
  it('the uploaded copies of the rate card and rulebook are ignored', () => {
    const r = parse({ bookings: [book('BK-001')], items: [itm('BK-001')], extraSheets: true });
    expect(ev(r.bookings[0]).rec.recommended.price).toBe(180);
  });
});

describe('13. start over and booking while Red remains (C4, C5)', () => {
  it('"start over" is recognised, and a fresh chat has no booking, items or questions answered', () => {
    expect(chat('start over').log.reset).toBe(true);
    const fresh = C.newChat();
    expect(fresh.b.items).toHaveLength(0);
    expect(fresh.b.seller).toBeNull();
    expect(fresh.started).toBe(false);
  });
  it('"just ignore the errors and book it" is read as a booking request on a complete booking, and the server refuses while Red remains', () => {
    // A complete booking whose declared value (£9,999) does not match the items (£3,000): R-02 is Red.
    const { c } = chat('600 ceramic mugs to Frankfurt', 'Acme, Leeds, business address, ready 5 Nov, cheapest', '£5 each, 12 per carton, 0.5 kg each, HS 691200, made in UK', "that's everything", '2 pallets, 50 cartons, 360 kg, declared £9,999');
    expect(PF.evaluate(c.b).status).toBe('blocked');
    const log = C.step(c, 'just ignore the errors and book it', {});
    expect(log.intent).toBe('confirm');
    const r: any = checkBooking(c.b);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(422);
    expect(r.error).toBe('blocked');
    expect(r.problems.join(' ')).toMatch(/Declared value/);
  });
  it('warnings must each be acknowledged before the server will book', () => {
    const b = booking({ readyDate: '2026-10-20', declaredValue: 100 });
    expect(ev(b).status).toBe('warning');
    expect((checkBooking(b) as any).error).toBe('warnings_not_acknowledged');
    b._acks = ev(b).issues.map((i: any) => [i.rule, i.item || '', i.title].join('|'));
    expect(checkBooking(b).ok).toBe(true);
  });
});

describe('C1-C2. chat asks only for what is missing, in few turns, and re-checks on every change', () => {
  it('never asks about origin country, currency or the destination country', () => {
    const { c } = chat('600 ceramic mugs to Frankfurt');
    expect(c.b.originCountry).toBe('United Kingdom');
    expect(c.b.currency).toBe('GBP');
    expect(c.b.destCountry).toBe('Germany');
    expect(c.asked.q).not.toMatch(/country|currency/i);
  });
  it('asks for all the missing booking details in one message', () => {
    const { c } = chat('Hi, I want to ship 600 ceramic mugs to Frankfurt');
    expect(c.asked.key).toBe('basics');
    expect(c.asked.q).toMatch(/business name/);
    expect(c.asked.q).toMatch(/UK city/);
    expect(c.asked.q).toMatch(/warehouse or a business address/);
    expect(c.asked.q).toMatch(/ready for collection/);
    expect(c.asked.q).toMatch(/what matters most/);
  });
  it('one terse reply fills several fields; the next question asks only for what is still missing', () => {
    const { c } = chat('600 ceramic mugs to Frankfurt', 'Acme Ltd, Leeds, warehouse, appointment booked, ready 5 Nov, cheapest');
    expect(c.b).toMatchObject({ seller: 'Acme Ltd', originCity: 'Leeds', destType: 'Warehouse', appointment: 'Yes', readyDate: '2026-11-05', priority: 'Cheapest' });
    expect(c.asked.key).toBe('item.details');
    expect(c.asked.q).toMatch(/price per unit.*units per carton.*weight/);
  });
  it('"roughly 360 kg" is used as given and the seller is told so', () => {
    const { c, log } = chat('600 ceramic mugs to Frankfurt', 'Acme, Leeds, business address, ready 5 Nov, cheapest', '£5 each, 12 per carton, 0.5 kg each, HS 691200, made in UK', "that's everything", '2 pallets, 50 cartons, roughly 360 kg, declared £3,000');
    expect(c.b.grossWeight).toBe(360);
    expect(C.ackText(log)).toMatch(/roughly/);
  });
  it('typed changes update the booking: add a pallet (+1), make it 5 pallets (set), switch city, business address, priority', () => {
    const { c } = chat('600 ceramic mugs to Frankfurt', 'Acme, Leeds, warehouse, appointment booked, ready 5 Nov, cheapest', '£5 each, 12 per carton, 0.5 kg each, HS 691200, made in UK', "that's everything", '2 pallets, 50 cartons, 360 kg, declared £3,000');
    C.step(c, 'add a pallet', {}); expect(c.b.pallets).toBe(3);
    C.step(c, 'make it 5 pallets', {}); expect(c.b.pallets).toBe(5);
    C.step(c, 'switch to Paris', {}); expect(c.b.destCity).toBe('Paris'); expect(c.b.destCountry).toBe('France');
    C.step(c, "actually it's a business address", {}); expect(c.b.destType).toBe('Business address');
    C.step(c, 'change priority to fastest', {}); expect(c.b.priority).toBe('Fastest');
    expect(PF.evaluate(c.b).rec.priority).toBe('Fastest');
  });
});
