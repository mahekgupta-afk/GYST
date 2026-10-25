// Input validation: HS codes (not all zeros), numeric fields (greater than 0, whole counts), and ready dates (not in the past).
// Clock mocked to 26-10-2026.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as XLSX from 'xlsx';
import { PF, C } from '../lib/pf';
import { checkHs, checkNumber, inlineError, checkReadyDate, rejectedClaims } from '../lib/validate';
import { applyChange, canBook, hasPastDate } from '../lib/fixes';
import { checkBooking } from '../lib/server/booking';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T12:00:00')); });
afterEach(() => vi.useRealTimers());

const item = (o: any = {}) => ({ sku: 'MUG-01', desc: 'Ceramic mug', hs: '691200', qty: 100, price: 1, upc: 10, cartons: 10, unitWeight: 0.1, coo: 'China', ...o });
const booking = (o: any = {}) => ({
  id: 'T-1', seller: 'Acme', originCity: 'Leeds', originCountry: 'United Kingdom', destCity: 'Frankfurt', destCountry: 'Germany', destType: 'Business address',
  readyDate: '2026-11-05', priority: 'Cheapest', pallets: 2, cartons: 10, declaredValue: 100, grossWeight: 300, appointment: 'Yes', items: [item()], ...o,
});
const ev = (b: any) => PF.evaluate(b);
const rules = (b: any) => ev(b).issues.map((i: any) => i.rule);
const issue = (b: any, rule: string) => ev(b).issues.find((i: any) => i.rule === rule);

/** Plays a chat. Returns the final chat state and the log of the last message. */
const chat = (...msgs: string[]) => { const c = C.newChat(); let log: any; for (const m of msgs) log = C.step(c, m, {}); return { c, log }; };
/** A complete, valid booking in the chat, so edits can be tested against existing values. */
const ready = () => chat('600 ceramic mugs to Frankfurt', 'Acme, Leeds, business address, ready 5 Nov, cheapest', '£5 each, 12 per carton, 0.5 kg each, HS 691200, made in UK', "that's everything", '3 pallets, 50 cartons, 400 kg, declared £3,000');
const refused = (log: any) => (log.rejected || []).map((r: any) => r.field);

describe('Rule 1: HS codes must not be all zeros', () => {
  it.each(['000000', '0', '0000.00.00', '00 00 00', 0, 0.0, '000000000'])('%j is invalid because it is all zeros', v => {
    const c: any = checkHs(v);
    expect(c.ok).toBe(false);
    expect(c.reason).toBe('zeros');
  });
  it.each(['-691200', '69A200', 'TBC', 'N/A', '6912xx'])('%j is invalid', v => expect(checkHs(v).ok).toBe(false));
  it.each(['090111', '691200', '6912.00', '6912 00', 691200, 90111])('%j is a valid code (length is checked by R-01)', v => expect(checkHs(v).ok).toBe(true));
  it('an all-zero code fails R-01 in Red with the message from the brief, naming the SKU', () => {
    const i = issue(booking({ items: [item({ hs: '000000' })] }), 'R-01');
    expect(i.sev).toBe('red');
    expect(i.what).toBe('MUG-01 has the HS code “000000”, which is all zeros. Enter a real code of at least 6 digits from the UK Trade Tariff.');
    for (const hs of [0, '0', '0000.00.00']) expect(rules(booking({ items: [item({ hs })] }))).toContain('R-01');
  });
  it('a leading zero followed by a real digit passes R-01', () => {
    expect(rules(booking({ items: [item({ hs: '090111' })] }))).not.toContain('R-01');
  });
  it('a negative or lettered code fails R-01', () => {
    for (const hs of ['-691200', '69A200', 'TBC']) expect(rules(booking({ items: [item({ hs })] }))).toContain('R-01');
  });
  it('uploaded file: an HS cell of 000000 is R-01 Red naming the SKU and the sheet row', () => {
    const { bookings } = parseFile({ bookings: [book('BK-001')], items: [itm('BK-001', { 'HS code': '000000' })] });
    const i = issue(bookings[0], 'R-01');
    expect(i.sev).toBe('red');
    expect(i.what).toContain('MUG-01');
    expect(i.sheet).toBe('Items');
    expect(i.row).toBe(3);
  });
  it('chat: an all-zero HS code is not stored, the reason is given, and the real code is asked for again', () => {
    const { c, log } = chat('600 ceramic mugs to Frankfurt', 'Acme, Leeds, business address, ready 5 Nov, cheapest', '£5 each, 12 per carton, 0.5 kg each, made in UK', 'HS code 000000');
    expect(c.b.items[0].hs).toBeNull();
    expect(refused(log)).toContain('hs');
    const msg = log.rejected.find((r: any) => r.field === 'hs').message;
    expect(msg).toContain('all zeros');
    expect(msg).toMatch(/What is the real code\?/);
  });
  it('chat: a bare reply of 0, 0000.00.00 or TBC to the HS question is refused too', () => {
    for (const reply of ['0', '0000.00.00', '000000', 'TBC', '-691200']) {
      const { c, log } = chat('600 ceramic mugs to Frankfurt', 'Acme, Leeds, business address, ready 5 Nov, cheapest', '£5 each, 12 per carton, 0.5 kg each, made in UK', reply);
      expect(c.b.items[0].hs).toBeNull();
      expect(refused(log)).toContain('hs');
    }
  });
  it('chat: a valid code is stored', () => {
    expect(chat('600 ceramic mugs to Frankfurt', 'Acme, Leeds, business address, ready 5 Nov, cheapest', '£5 each, 12 per carton, 0.5 kg each, made in UK', 'HS code 090111').c.b.items[0].hs).toBe('090111');
  });
  it('the Set HS code input refuses all-zero codes and leaves the old value', () => {
    const b: any = booking();
    const r: any = applyChange(b, { kind: 'set', field: 'hs', value: '000000', itemIndex: 0, rule: 'R-01' });
    expect(r.ok).toBe(false);
    expect(b.items[0].hs).toBe('691200');
    expect(applyChange(b, { kind: 'set', field: 'hs', value: '090111', itemIndex: 0, rule: 'R-01' }).ok).toBe(true);
    expect(b.items[0].hs).toBe('090111');
  });
});

describe('Rule 2: numeric fields must be greater than 0 (and counts whole)', () => {
  it.each([0, 0.0, '0', 'zero', 'none', 'no pallets', -5, '-5', 'minus 3', '-0', NaN, 'abc', '', null, undefined, Infinity])('pallets %j is rejected', v => {
    expect(checkNumber('pallets', v).ok).toBe(false);
  });
  it('counts must be whole numbers; weights, prices and values may have decimals', () => {
    for (const f of ['pallets', 'cartons', 'qty', 'upc', 'itemCartons'] as const) { expect(checkNumber(f, 2.5).ok).toBe(false); expect(checkNumber(f, 3).ok).toBe(true); }
    for (const f of ['declaredValue', 'grossWeight', 'price', 'unitWeight'] as const) { expect(checkNumber(f, 2.5).ok).toBe(true); expect(checkNumber(f, 0).ok).toBe(false); expect(checkNumber(f, -0.5).ok).toBe(false); }
  });
  it('reads "1,080", "£5.00" and " 12 " correctly', () => {
    expect((checkNumber('qty', '1,080') as any).value).toBe(1080);
    expect((checkNumber('price', '£5.00') as any).value).toBe(5);
    expect((checkNumber('upc', ' 12 ') as any).value).toBe(12);
  });

  describe('chat: refused in the same reply, old value kept, field asked again', () => {
    const cases: [string, string][] = [
      ['0 pallets', 'pallets'], ['-3 pallets', 'pallets'], ['2.5 pallets', 'pallets'], ['gross weight 0 kg', 'grossWeight'], ['declared value zero', 'declaredValue'],
      ['500 units at 0 GBP each', 'price'], ['quantity -10', 'qty'], ['0 units per carton', 'upc'], ['0.0 kg each', 'unitWeight'],
    ];
    it.each(cases)('"%s" is refused (field: %s) and the field is asked for again', (msg, field) => {
      const { c, log } = chat(msg);
      expect(refused(log)).toContain(field);
      const text = log.rejected.find((r: any) => r.field === field).message;
      expect(text).toMatch(/\?$/);                                   // it asks again
      expect(JSON.stringify(c.b)).not.toMatch(/"(pallets|grossWeight|declaredValue|price|qty|upc|unitWeight)":(0|-\d|2\.5)\b/);
      const key = field === 'itemCartons' ? 'cartons' : field;
      const stored = ['pallets', 'grossWeight', 'declaredValue'].includes(field) ? c.b[key] : (c.b.items[0] || {})[key];
      expect(stored == null).toBe(true);                             // nothing invalid was stored
    });
    it('the wording says which field and why, for example pallets', () => {
      expect(chat('0 pallets').log.rejected[0].message).toBe('Pallets can’t be 0 or negative. How many pallets are you sending?');
      expect(chat('2.5 pallets').log.rejected[0].message).toMatch(/Pallets must be a whole number.*How many pallets/);
    });
    it.each(['make it 0 pallets', 'remove all the pallets', 'make it -2 pallets', 'make it 2.5 pallets'])('"%s" is refused and the old value is kept', msg => {
      const { c } = ready();
      expect(c.b.pallets).toBe(3);
      const log = C.step(c, msg, {});
      expect(refused(log)).toContain('pallets');
      expect(c.b.pallets).toBe(3);
    });
    it('removing the last pallet with "remove a pallet" is refused after the fact and the value is restored', () => {
      const { c } = chat('600 ceramic mugs to Frankfurt', 'Acme, Leeds, business address, ready 5 Nov, cheapest', '£5 each, 12 per carton, 0.5 kg each, HS 691200, made in UK', "that's everything", '1 pallet, 50 cartons, 400 kg, declared £3,000');
      const log = C.step(c, 'remove a pallet', {});
      expect(c.b.pallets).toBe(1);
      expect(refused(log)).toContain('pallets');
      expect(log.set.concat(log.changed).some((e: any) => e.field === 'pallets')).toBe(false);   // no "updated pallets" message
    });
    it('a message with one valid and one invalid value stores the valid one only, and re-asks only the invalid one', () => {
      const { c, log } = chat('3 pallets and gross weight 0 kg');
      expect(c.b.pallets).toBe(3);
      expect(c.b.grossWeight).toBeNull();
      expect(refused(log)).toEqual(['grossWeight']);
    });
    it('500 units at 0 GBP stores the 500 units and refuses only the price', () => {
      const { c, log } = chat('500 units at 0 GBP each');
      expect(c.b.items[0].qty).toBe(500);
      expect(c.b.items[0].price).toBeNull();
      expect(refused(log)).toEqual(['price']);
    });
    it('a bare reply right after a refusal answers the refused field, and is validated again', () => {
      const { c } = chat('0 pallets');
      expect(c.reask.field).toBe('pallets');
      const again = C.step(c, '0', {});
      expect(c.b.pallets).toBeNull();
      expect(refused(again)).toContain('pallets');
      C.step(c, '4', {});
      expect(c.b.pallets).toBe(4);
      expect(c.reask).toBeNull();
    });
    it('valid values are stored as before', () => {
      const { c } = chat('3 pallets, gross weight 450 kg, declared value £2,000');
      expect(c.b).toMatchObject({ pallets: 3, grossWeight: 450, declaredValue: 2000 });
    });
    it('the Gemini path is validated too: a model that returns 0, -5 or 2.5 cannot get them stored', () => {
      const c = C.newChat();
      const exAI = C.aiToEx({ pallets: 0, cartons: 2.5, declaredValue: -5, grossWeight: 100, items: [{ desc: 'Mug', qty: 10, price: 0, upc: 0 }] }, c);
      const log = C.stepAI(c, 'I have some mugs', exAI);
      expect(c.b.pallets).toBeNull();
      expect(c.b.cartons).toBeNull();
      expect(c.b.declaredValue).toBeNull();
      expect(c.b.grossWeight).toBe(100);
      expect(c.b.items[0].qty).toBe(10);
      expect(c.b.items[0].price).toBeNull();
      expect(c.b.items[0].upc).toBeNull();
      expect(refused(log)).toEqual(expect.arrayContaining(['pallets', 'cartons', 'declaredValue', 'price', 'upc']));
    });
    it('the Gemini path refuses "make it 0 pallets" even if the model obeys it', () => {
      const { c } = ready();
      const exAI = C.aiToEx({ pallets: 0 }, c);
      const log = C.stepAI(c, 'make it 0 pallets', exAI);
      expect(c.b.pallets).toBe(3);
      expect(refused(log)).toContain('pallets');
    });
  });

  describe('"Fix it here" inputs and the editable table', () => {
    it.each([0, -3, 2.5, 'abc', '', NaN])('applying %j to pallets is refused and the value is unchanged', v => {
      const b: any = booking();
      const r: any = applyChange(b, { kind: 'set', field: 'pallets', value: v, rule: 'R-05' });
      expect(r.ok).toBe(false);
      expect(b.pallets).toBe(2);
      expect(b._changes).toBeUndefined();
    });
    it('every covered field refuses 0 and negatives and accepts a good value', () => {
      const fields: [string, number | undefined, any][] = [['pallets', undefined, 3], ['cartons', undefined, 10], ['declaredValue', undefined, 99.5], ['grossWeight', undefined, 12.5],
        ['qty', 0, 100], ['price', 0, 1.5], ['upc', 0, 10], ['cartons', 0, 10], ['unitWeight', 0, 0.1]];
      for (const [field, itemIndex, good] of fields) {
        const b: any = booking();
        for (const bad of [0, -1, 'x']) expect((applyChange(b, { kind: 'set', field, value: bad, itemIndex, rule: 'x' }) as any).ok).toBe(false);
        expect((applyChange(b, { kind: 'set', field, value: good, itemIndex, rule: 'x' }) as any).ok).toBe(true);
      }
    });
    it('the inline errors explain why', () => {
      expect(inlineError('pallets', '0')).toMatch(/greater than 0/);
      expect(inlineError('pallets', '2.5')).toMatch(/whole number/);
      expect(inlineError('grossWeight', 'abc')).toMatch(/isn’t a number/);
      expect(inlineError('grossWeight', '12.5')).toBeNull();
    });
  });

  describe('uploaded files', () => {
    const file = () => parseFile({
      bookings: [book('BK-001'), book('BK-002', { Pallets: 0 }), book('BK-003')],
      items: [itm('BK-001'), itm('BK-002'), itm('BK-003', { 'Unit price': -5 }), itm('BK-003', { SKU: 'MUG-02', 'Quantity (units)': 0 })],
    });
    it('reports each bad cell as a Red input error naming booking, sheet, row, column and value; the clean booking is untouched', () => {
      const { bookings } = file();
      expect(bookings.map((b: any) => b.id)).toEqual(['BK-001', 'BK-002', 'BK-003']);
      const clean = ev(bookings[0]);
      expect(clean.status).toBe('clear');
      expect(clean.issues).toHaveLength(0);

      const pallets = issue(bookings[1], 'INPUT');
      expect(pallets.sev).toBe('red');
      expect(pallets.title).toBe('Input error: Pallets');
      expect(pallets.what).toBe('BK-002 · Bookings sheet, row 4 · Pallets is 0. Enter a whole number greater than 0.');

      const inputs = ev(bookings[2]).issues.filter((i: any) => i.rule === 'INPUT');
      expect(inputs.map((i: any) => i.what)).toEqual(expect.arrayContaining([
        'BK-003 · Items sheet, row 5 · Unit price is -5. Enter a number greater than 0.',
        'BK-003 · Items sheet, row 6 · Quantity is 0. Enter a whole number greater than 0.',
      ]));
      expect(inputs.every((i: any) => i.sev === 'red')).toBe(true);
    });
    it('input errors block booking like any Red', () => {
      const { bookings } = file();
      expect(ev(bookings[1]).status).toBe('blocked');
      expect((checkBooking(bookings[1]) as any).ok).toBe(false);
      expect((checkBooking(bookings[2]) as any).ok).toBe(false);
      expect((checkBooking(bookings[0]) as any).ok).toBe(true);
    });
    it('dependent checks are skipped with an explanation, and give no misleading result', () => {
      const { bookings } = file();
      const b2 = ev(bookings[1]);
      expect(b2.ruleStatus['R-05']).toBe('na');
      expect(b2.issues.some((i: any) => i.rule === 'R-05')).toBe(false);
      expect(issue(bookings[1], 'INPUT').fix).toMatch(/R-05.*skipped.*input error/);
      const b3 = ev(bookings[2]);
      expect(b3.ruleStatus['R-02']).toBe('na');
      expect(b3.ruleStatus['R-03']).toBe('na');
      expect(b3.issues.some((i: any) => i.rule === 'R-02' || i.rule === 'R-03')).toBe(false);
      expect(b3.issues.find((i: any) => i.rule === 'INPUT').fix).toMatch(/skipped/);
    });
    it('no NaN, Infinity or divide-by-zero anywhere in the results, and nothing crashes', () => {
      const { bookings } = file();
      for (const b of bookings) {
        const e = ev(b);
        const dump = JSON.stringify({ issues: e.issues, reason: e.rec.reason, calc: e.calc, notes: e.rec.ruledOutNotes }) + JSON.stringify(PF.summarise(b, e));
        expect(dump).not.toMatch(/NaN|Infinity/);
      }
    });
    it('text in a number cell is an input error that quotes the value; a blank is still a missing-data message', () => {
      const { bookings } = parseFile({ bookings: [book('BK-001', { Pallets: 'three' })], items: [itm('BK-001', { 'Unit price': null })] });
      expect(issue(bookings[0], 'INPUT').what).toContain('Pallets is “three”, which isn’t a number');
      expect(ev(bookings[0]).issues.some((i: any) => i.rule === 'DATA' && /unit price/.test(i.title))).toBe(true);
    });
    it('fractional counts are input errors; fractional weights and prices are fine', () => {
      const { bookings } = parseFile({ bookings: [book('BK-001', { Pallets: 2.5 })], items: [itm('BK-001', { 'Unit price': 4.99, 'Unit weight (kg)': 0.25 })] });
      const inputs = ev(bookings[0]).issues.filter((i: any) => i.rule === 'INPUT');
      expect(inputs).toHaveLength(1);
      expect(inputs[0].what).toContain('Pallets is 2.5, but it must be a whole number');
    });
    it('once a bad value is corrected in the app the error clears and the skipped checks run', () => {
      const { bookings } = file();
      const b = bookings[1];
      expect(applyChange(b, { kind: 'set', field: 'pallets', value: 3, rule: 'INPUT' }).ok).toBe(true);
      const e = ev(b);
      expect(e.issues.some((i: any) => i.rule === 'INPUT')).toBe(false);
      expect(e.ruleStatus['R-05']).toBe('pass');
      expect(e.status).toBe('clear');
    });
  });
});

describe('Rule 3: past dates are not accepted', () => {
  it('chat refuses "20-10-2026", "yesterday", "last Friday" and "two days ago" and re-asks', () => {
    for (const phrase of ['ready 20-10-2026', 'ready yesterday', 'ready last Friday', 'ready two days ago', 'ready 2 days ago']) {
      const { c, log } = chat('Acme, Leeds to Paris, business address, cheapest, ' + phrase);
      expect(c.b.readyDate).toBeNull();
      expect(refused(log)).toContain('readyDate');
      expect(log.rejected.find((r: any) => r.field === 'readyDate').message).toBe('That date is in the past. Today is 26-10-2026. What date will the goods be ready?');
    }
  });
  it('chat accepts 26-10-2026, today and tomorrow, and echoes the date', () => {
    const cases: [string, string][] = [['ready 26-10-2026', '2026-10-26'], ['ready today', '2026-10-26'], ['ready tomorrow', '2026-10-27']];
    for (const [phrase, iso] of cases) {
      const { c, log } = chat('Acme, Leeds to Paris, business address, cheapest, ' + phrase);
      expect(c.b.readyDate).toBe(iso);
      expect(refused(log)).toEqual([]);
    }
  });
  it('a past date in an edit is refused and the previous valid date is kept', () => {
    const { c } = ready();
    expect(c.b.readyDate).toBe('2026-11-05');
    for (const edit of ['change the ready date to yesterday', 'ready date 20-10-2026', 'make it last Friday']) {
      const log = C.step(c, edit, {});
      expect(refused(log)).toContain('readyDate');
      expect(c.b.readyDate).toBe('2026-11-05');
    }
    C.step(c, 'ready date 10-11-2026', {});
    expect(c.b.readyDate).toBe('2026-11-10');
  });
  it('after a refusal, a bare date answers it', () => {
    const { c } = chat('Acme, Leeds to Paris, business address, cheapest, ready yesterday');
    expect(c.reask.field).toBe('readyDate');
    C.step(c, '10 Nov', {});
    expect(c.b.readyDate).toBe('2026-11-10');
  });
  it('an unparseable or impossible date is refused and re-asked', () => {
    for (const phrase of ['ready 31-02-2026', 'ready next week']) {
      const { c, log } = chat('Acme, Leeds to Paris, business address, cheapest, ' + phrase);
      expect(c.b.readyDate).toBeNull();
      expect(log.dateProblem).toBeTruthy();
    }
  });
  it('checkReadyDate: today passes, yesterday fails', () => {
    expect(checkReadyDate('2026-10-26', '2026-10-26').ok).toBe(true);
    expect(checkReadyDate('2026-10-25', '2026-10-26').ok).toBe(false);
    expect(checkReadyDate(null, '2026-10-26').ok).toBe(false);
  });
  it('the date Fix it here input refuses past dates and accepts today', () => {
    const b: any = booking({ readyDate: '2026-10-20' });
    expect((applyChange(b, { kind: 'set', field: 'readyDate', value: '2026-10-25', rule: 'R-10' }) as any).ok).toBe(false);
    expect(b.readyDate).toBe('2026-10-20');
    expect(applyChange(b, { kind: 'set', field: 'readyDate', value: '2026-10-26', rule: 'R-10' }).ok).toBe(true);
    expect(rules(b)).not.toContain('R-10');
  });

  describe('uploaded files keep R-10 Amber but block booking until the date is fixed', () => {
    const past = () => booking({ readyDate: '2026-10-20', destType: 'Warehouse', appointment: 'No' });
    it('still reports R-10 as Amber with the same message, and does not lose other rule results', () => {
      const e = ev(past());
      const r10 = e.issues.find((i: any) => i.rule === 'R-10');
      expect(r10.sev).toBe('amber');
      expect(r10.title).toBe('Ready date is in the past');
      expect(r10.what).toContain('6 days ago');
      expect(e.issues.map((i: any) => i.rule).sort()).toEqual(['R-08', 'R-10']);   // R-08 still reported
      expect(e.status).toBe('warning');
      expect(e.ruleStatus['R-10']).toBe('amber');
    });
    it('cannot be booked until the date is corrected (UI gate and server gate)', () => {
      const b: any = past();
      const e = ev(b);
      expect(hasPastDate(e)).toBe(true);
      expect(canBook(b, e)).toBe(false);
      b._acks = e.issues.map((i: any) => [i.rule, i.item || '', i.title].join('|'));   // acknowledging cannot override a past date
      expect(canBook(b, ev(b))).toBe(false);
      const r: any = checkBooking(b);
      expect(r.ok).toBe(false);
      expect(r.error).toBe('past_date');
      expect(applyChange(b, { kind: 'set', field: 'readyDate', value: '2026-10-26', rule: 'R-10' }).ok).toBe(true);
      expect(hasPastDate(ev(b))).toBe(false);
      b._acks = [];
      expect(canBook(b, ev(b))).toBe(false);                                           // the R-08 warning still needs acknowledging
      b._acks = ev(b).issues.map((i: any) => [i.rule, i.item || '', i.title].join('|'));
      expect(canBook(b, ev(b))).toBe(true);
      expect(checkBooking(b).ok).toBe(true);
    });
    it('a file with a past date shows R-10 and the date is not silently changed', () => {
      const { bookings } = parseFile({ bookings: [book('BK-001', { 'Ready to ship date': '20-10-2026' })], items: [itm('BK-001')] });
      expect(bookings[0].readyDate).toBe('2026-10-20');
      expect(rules(bookings[0])).toEqual(['R-10']);
    });
    it('an unparseable date in a file is reported with its row', () => {
      const { bookings } = parseFile({ bookings: [book('BK-001', { 'Ready to ship date': 'whenever' })], items: [itm('BK-001')] });
      const i = ev(bookings[0]).issues.find((x: any) => /Ready date/.test(x.title));
      expect(i.row).toBe(3);
      expect(i.what).toContain('whenever');
    });
  });
});

// ---------------- helpers for uploaded files ----------------
function book(id: string, over: any = {}) {
  const b: any = { 'Booking ID': id, 'Seller name': 'Northfield Goods', 'Origin city': 'Manchester', 'Origin country': 'United Kingdom', 'Destination city': 'Frankfurt', 'Destination country': 'Germany', 'Destination type': 'Warehouse',
    'Ready to ship date': '05-11-2026', 'Seller priority': 'Cheapest', Pallets: 3, Cartons: 90, 'Total declared value': 5400, Currency: 'GBP', 'Total gross weight (kg)': 620, 'Delivery appointment booked': 'Yes', ...over };
  return PF.BH.map((h: string) => b[h]);
}
function itm(id: string, over: any = {}) {
  const i: any = { 'Booking ID': id, SKU: 'MUG-01', Description: 'Ceramic coffee mug, 350 ml', 'HS code': '691200', 'Quantity (units)': 1080, 'Unit price': 5, 'Units per carton': 12, Cartons: 90, 'Unit weight (kg)': 0.5, 'Country of origin': 'United Kingdom', ...over };
  return PF.IH.map((h: string) => i[h]);
}
function parseFile(opts: { bookings: any[][]; items: any[][] }) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Bookings title row'], PF.BH, ...opts.bookings]), 'Bookings');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Items title row'], PF.IH, ...opts.items]), 'Items');
  const r = PF.parseWorkbook(XLSX, XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  if (r.error) throw new Error(r.error);
  return r;
}

describe('claim scanner', () => {
  it('finds invalid claims only', () => {
    expect(rejectedClaims('3 pallets of mugs').length).toBe(0);
    expect(rejectedClaims('add a pallet').length).toBe(0);
    expect(rejectedClaims('0.5 kg each at £5 each, 12 per carton').length).toBe(0);
    expect(rejectedClaims('no pallets').map(r => r.field)).toEqual(['pallets']);
  });
});
