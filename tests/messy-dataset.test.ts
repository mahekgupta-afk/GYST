// Preflight_Messy_Dataset.xlsx: dirty real-world input. Nothing may crash, anything outside the allowed lists gets a plain “Data” message,
// and nothing unbookable is ever shown as ready to book. Today is 2026-10-26.
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { PF } from '../lib/pf';
import { canBook } from '../lib/fixes';

const TODAY = '2026-10-26';
const file = readFileSync('tests/fixtures/Preflight_Messy_Dataset.xlsx');
const parsed: any = PF.parseWorkbook(XLSX, file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
const ev = (id: string, n = 0) => { const b = parsed.bookings.filter((x: any) => x.id === id)[n]; return { b, e: PF.evaluate(b, { todayISO: TODAY }) }; };
const titles = (id: string) => ev(id).e.issues.map((i: any) => i.title);
const ready = (id: string) => { const { b, e } = ev(id); return canBook(b, e); };
const report: string[] = [];

describe('the messy dataset', () => {
  it('is read and every booking is evaluated without a crash', () => {
    expect(parsed.error).toBeFalsy();
    expect(parsed.bookings.length).toBe(33);
    for (const b of parsed.bookings) {
      const e = PF.evaluate(b, { todayISO: TODAY });
      expect(['blocked', 'warning', 'clear']).toContain(e.status);
      report.push(String(b.id).padEnd(8) + e.status.padEnd(8) + (ready(b.id) && e.status !== 'blocked' ? 'READY ' : '      ') + e.issues.map((i: any) => i.rule + ':' + i.title).join(' | ').slice(0, 200));
    }
  });
  it('the template example row BK-001 comes out clear', () => { expect(ev('BK-001').e.status).toBe('clear'); });
  it('skips the note row and the TOTAL row with a notice, and never lists them as bookings', () => {
    expect(parsed.bookings.map((b: any) => b.id)).not.toContain('TOTAL');
    expect(parsed.bookings.some((b: any) => /^NOTES/i.test(b.id))).toBe(false);
    expect(parsed.warnings.filter((w: string) => /is a note or total, not a booking, so it was skipped/.test(w))).toHaveLength(2);
  });
  it('Glasgow → Munich is not ready to book, and says why', () => {
    expect(ready('BK-327')).toBe(false);
    expect(titles('BK-327')).toEqual(expect.arrayContaining(['Collection city not supported', 'Delivery city not supported']));
  });
  it('Rotterdam with Germany is not ready to book, and says the city and country do not match', () => {
    expect(ready('BK-329')).toBe(false);
    expect(titles('BK-329')).toContain('Delivery city and country don’t match');
  });
  it('out-of-list values give Data messages: destination type, priority and appointment', () => {
    expect(titles('BK-317')).toContain('Destination type not recognised');
    expect(titles('BK-317')).toContain('Delivery appointment not recognised');
    expect(titles('BK-323')).toContain('Seller priority not recognised');
    expect(ev('BK-317').e.issues.filter((i: any) => i.rule === 'DATA').every((i: any) => i.sev === 'red')).toBe(true);
  });
  it('dates: serials and DD-MM-YYYY text are read day-first, 31-11-2026 is invalid with no rollover, and TBC is unreadable', () => {
    expect(ev('BK-304').b.readyDate).toBe('2026-11-17');          // an Excel serial (46343)
    expect(ev('BK-321').b.readyDate).toBe('2026-10-26');          // today passes R-10
    expect(ev('BK-322').b.readyDate).toBeNull();
    expect(titles('BK-322')).toContain('Ready date missing or unreadable');
    expect(titles('BK-323')).toContain('Ready date missing or unreadable');
    expect(ev('BK-301').b.readyDate).toBe('2026-11-10');          // 10th Nov 2026
    expect(ev('BK-328').b.readyDate).toBe('2026-12-09');          // Dec 9, 2026
  });
  it('a past date that would be in the future month-first mentions it in the R-10 explanation', () => {
    const i = ev('BK-303').e.issues.find((x: any) => x.rule === 'R-10');
    expect(ev('BK-303').b.readyDate).toBe('2026-05-11');          // 11/05/2026 is read day-first
    expect(i.what).toContain('month-first');
    expect(i.what).toContain('5 Nov 2026');
  });
  it('HS codes: 0901.21.00 passes, 90230 is a lost leading zero, a bare serial-like 906.2 is too short', () => {
    expect(ev('BK-304').e.issues.filter((i: any) => i.rule === 'R-01').map((i: any) => i.title)).toEqual(['HS code lost its leading zero', 'HS code too short']);
  });
  it('a repeated Booking ID is warned about and both copies are held', () => {
    expect(parsed.warnings.some((w: string) => /BK-325.*2 times/.test(w))).toBe(true);
    expect(titles('BK-325')).toContain('Duplicate Booking ID');
    expect(PF.evaluate(ev('BK-325', 1).b, { todayISO: TODAY }).issues.map((i: any) => i.title)).toContain('Duplicate Booking ID');
    expect(ready('BK-325')).toBe(false);
  });
  it('item IDs that differ in case or spacing (bk324, “BK 324”) still attach', () => {
    expect(ev('BK-324').b.items).toHaveLength(2);
    expect(titles('BK-324')).not.toContain('No items found');
    expect(parsed.warnings.some((w: string) => /BK-399/.test(w))).toBe(true);
  });
  it('nothing blocked is ever “ready to book”', () => {
    for (const b of parsed.bookings) { const e = PF.evaluate(b, { todayISO: TODAY }); if (e.status === 'blocked') expect(canBook(b, e)).toBe(false); }
  });
});

afterAll(() => { writeFileSync(process.env.MESSY_REPORT || 'messy-report.txt', 'WARNINGS\n' + (parsed.warnings || []).join('\n') + '\n\n' + report.join('\n') + '\n'); });
