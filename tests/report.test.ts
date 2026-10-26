// The check report: what goes in it, and that the PDF really contains it. The report only presents what the engine decided.
import { describe, it, expect } from 'vitest';
import { PF } from '../lib/pf';
import { applyChange } from '../lib/fixes';
import { buildBookingReport, buildFileReport, REPORT_FOOTER } from '../lib/reportData';
import { bookingReportPdf, fileReportPdf } from '../lib/pdf/report';
import { pdfSafe } from '../lib/pdf/layout';

const all = () => PF.bookingsFromTables(...(Object.values(PF.sampleTables(PF.todayISO())) as [any, any])).bookings as any[];
const get = (id: string) => JSON.parse(JSON.stringify(all().find((b: any) => b.id === id)));
const raw = (doc: any) => Buffer.from(doc.output('arraybuffer')).toString('latin1');
const NOW = new Date('2026-10-26T12:00:00');

describe('report data', () => {
  it('has all ten rules in order with the result the engine gave, and the overall status', () => {
    for (const id of ['BK-001', 'BK-003', 'BK-007', 'BK-008', 'BK-012']) {
      const b = get(id), ev = PF.evaluate(b), r = buildBookingReport(b, ev);
      expect(r.rules.map(x => x.id), id).toEqual(['R-01', 'R-02', 'R-03', 'R-04', 'R-05', 'R-06', 'R-07', 'R-08', 'R-09', 'R-10']);
      r.rules.forEach(x => expect(x.result.toLowerCase().replace('not checked', 'na').replace('pass', 'pass'), id + x.id).toBe(ev.ruleStatus[x.id]));
      expect(r.status).toBe(ev.status === 'clear' ? 'Ready' : ev.status === 'warning' ? 'Needs attention' : 'Blocked');
      expect([r.red, r.amber]).toEqual([ev.counts.red, ev.counts.amber]);
    }
  });
  it('lists what is wrong and how to fix it for a failed rule', () => {
    const b = get('BK-003'), r = buildBookingReport(b, PF.evaluate(b));
    const r02 = r.rules.find(x => x.id === 'R-02')!;
    expect(r02.result).toBe('Red');
    expect(r02.problems.length).toBeGreaterThan(0);
    expect(r02.problems[0].what.length).toBeGreaterThan(10); expect(r02.problems[0].fix.length).toBeGreaterThan(10);
  });
  it('compares the three carriers, marks the recommended one and includes the reason and priority', () => {
    const b = get('BK-001'), r = buildBookingReport(b, PF.evaluate(b));
    expect(r.carrier.rows.map(x => x.carrier)).toEqual(['Carrier A', 'Carrier B', 'Carrier C']);
    expect(r.carrier.rows.filter(x => x.recommended)).toHaveLength(1);
    expect(r.carrier.recommended).toContain('Carrier A');
    expect(r.carrier.priority).toBe('Cheapest');
    expect(r.carrier.reason.length).toBeGreaterThan(20);
    expect(r.carrier.rows[0].total).toBe(540);
  });
  it('includes the fixes applied, before and after', () => {
    const b = get('BK-001'); b.declaredValue = 6000;
    applyChange(b, { kind: 'set', field: 'declaredValue', value: 5400, rule: 'R-02' });
    const r = buildBookingReport(b, PF.evaluate(b));
    expect(r.changes).toEqual([{ rule: 'R-02', scope: 'Booking', field: 'Total declared value (£)', from: '6000', to: '5400' }]);
  });
  it('a whole-file report counts bookings by status', () => {
    const f = buildFileReport('x.xlsx', all());
    expect(f.counts.total).toBe(14);
    expect(f.counts.ready + f.counts.attention + f.counts.blocked).toBe(14);
    expect(f.counts.blocked).toBeGreaterThan(0);
  });
  it('passes HS verification results through when they are given', () => {
    const b = get('BK-001');
    const r = buildBookingReport(b, PF.evaluate(b), [{ item: 'MUG-01', code: '691200', state: 'verified', description: 'Ceramic tableware' }]);
    expect(r.hs).toHaveLength(1);
  });
});

describe('the PDF', () => {
  it('is a real PDF with the header, status, rules, carrier table and the footer disclaimer', () => {
    const b = get('BK-003'), r = buildBookingReport(b, PF.evaluate(b));
    const doc = bookingReportPdf(r, { now: NOW, compress: false });
    const txt = raw(doc);
    expect(txt.startsWith('%PDF-')).toBe(true);
    for (const needle of ['GYST SHIPMENTS', 'Pre-flight check report', 'Booking BK-003', 'BLOCKED', 'The ten rules', 'R-01', 'R-10', 'Carrier recommendation', 'Carrier A', 'Carrier B', 'Carrier C', 'fixed rulebook. Guidance only, not legal or customs advice.']) expect(txt, needle).toContain(needle);
    expect(txt).toContain('Page 1 of ' + doc.getNumberOfPages());
    expect(REPORT_FOOTER).toContain('not legal or customs advice');
  });
  it('shows applied fixes and any HS results when present', () => {
    const b = get('BK-001'); b.declaredValue = 6000;
    applyChange(b, { kind: 'set', field: 'declaredValue', value: 5400, rule: 'R-02' });
    const r = buildBookingReport(b, PF.evaluate(b), [{ item: 'MUG-01', code: '691200', state: 'verified', description: 'Ceramic tableware' }]);
    const txt = raw(bookingReportPdf(r, { now: NOW, compress: false }));
    expect(txt).toContain('Fixes applied'); expect(txt).toContain('-> after'); expect(txt).toContain('6000'); expect(txt).toContain('5400');
    expect(txt).toContain('HS code verification'); expect(txt).toContain('Ceramic tableware'); expect(txt).toContain('READY');
  });
  it('the whole-file report has a summary page and a section for every booking', () => {
    const f = buildFileReport('planted.xlsx', all());
    const doc = fileReportPdf(f, { now: NOW, compress: false });
    const txt = raw(doc);
    expect(txt).toContain('planted.xlsx'); expect(txt).toContain('All bookings');
    for (const b of f.bookings) expect(txt, b.bookingId).toContain('Booking ' + b.bookingId);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(f.bookings.length + 1);
  });
  it('long reports flow onto more pages without losing the footer on any page', () => {
    const b = get('BK-008'); const r = buildBookingReport(b, PF.evaluate(b));
    r.changes = Array.from({ length: 60 }, (_, i) => ({ rule: 'R-02', scope: 'Booking', field: 'Field ' + i, from: String(i), to: String(i + 1) }));
    const doc = bookingReportPdf(r, { now: NOW, compress: false });
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    expect((raw(doc).match(/Guidance only, not legal or customs advice\./g) || []).length).toBe(doc.getNumberOfPages());
  });
  it('turns typographic characters the PDF fonts cannot show into plain ones', () => {
    expect(pdfSafe('It’s “fine” — 5 × 3 ≥ 2… → ✓ £5')).toBe('It\'s "fine" - 5 x 3 >= 2... -> OK £5');
    for (const ch of pdfSafe('日本語 ok')) expect(ch.charCodeAt(0)).toBeLessThan(256);
  });
  it('can be compressed for download too', () => {
    const b = get('BK-001'); const doc = bookingReportPdf(buildBookingReport(b, PF.evaluate(b)), { now: NOW });
    expect(Buffer.from(doc.output('arraybuffer')).length).toBeGreaterThan(1500);
  });
});
