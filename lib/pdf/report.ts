// The check report as a PDF, built in the browser. Only the data in lib/reportData.ts goes in; nothing is re-judged here.
import { jsPDF } from 'jspdf';
import { PF } from '../pf';
import { Page, COLORS, pdfSafe } from './layout';
import { buildBookingReport, buildFileReport, REPORT_FOOTER, type BookingReport, type FileReport, type HsResultLite } from '../reportData';

const stamp = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const HS_TEXT: Record<HsResultLite['state'], string> = {
  verified: 'Verified', 'six-digits': '6 digits only', 'not-found': 'Not found in tariff', unavailable: 'Could not verify', blank: 'No code',
};

function bookingSection(p: Page, r: BookingReport, now: Date) {
  const statusColor = r.status === 'Ready' ? COLORS.green : r.status === 'Blocked' ? COLORS.red : COLORS.amber;
  p.heading('Booking ' + r.bookingId + (r.reference ? '  (reference ' + r.reference + ')' : ''));
  p.facts([['Seller', r.seller], ['Route', r.route], ['Ready to ship', r.readyDate ? PF.dmy(r.readyDate) : 'Not given'], ['Priority', r.carrier.priority]]);
  p.ensure(30);
  p.doc.setFont('helvetica', 'bold'); p.doc.setFontSize(13); p.doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
  p.doc.text(r.status.toUpperCase() + '   ' + r.red + ' red, ' + r.amber + ' amber', p.m, p.y); p.y += 20;

  p.heading('The ten rules');
  p.table([{ header: 'Rule', width: 36 }, { header: 'What it checks', width: 150 }, { header: 'Result', width: 52 }, { header: 'What is wrong and how to fix it', width: 232 }],
    r.rules.map(x => [x.id, x.text, x.result, x.problems.length ? x.problems.map(i => (i.item ? i.item + ': ' : '') + i.what + ' Fix: ' + i.fix).join('\n') : x.result === 'Pass' ? 'Nothing to fix.' : 'Not checked: a value it needs is missing or invalid.']),
    { colorCol: 2 });
  if (r.otherProblems.length) {
    p.heading('Other problems (missing or invalid details)');
    p.table([{ header: 'Problem', width: 120 }, { header: 'What is wrong', width: 200 }, { header: 'How to fix it', width: 150 }], r.otherProblems.map(o => [o.title, o.what, o.fix]));
  }
  if (r.hs.length) {
    p.heading('HS code verification (UK Trade Tariff, advisory)');
    p.table([{ header: 'Item', width: 90 }, { header: 'Code', width: 70 }, { header: 'Result', width: 90 }, { header: 'Official description / note', width: 220 }],
      r.hs.map(h => [h.item, h.code || '-', HS_TEXT[h.state], [h.description, h.note].filter(Boolean).join(' - ') || '-']));
  }
  p.heading('Carrier recommendation');
  p.paragraph((r.carrier.recommended ? 'Recommended: ' + r.carrier.recommended : 'No carrier recommended yet') + '. Priority: ' + r.carrier.priority + '.', { bold: true });
  if (r.carrier.reason) p.paragraph(r.carrier.reason, { size: 9.5, color: COLORS.grey });
  p.table([{ header: 'Carrier', width: 90 }, { header: 'Per pallet', width: 50, align: 'right' }, { header: 'Total', width: 52, align: 'right' }, { header: 'Days', width: 34, align: 'right' }, { header: 'On time', width: 46, align: 'right' }, { header: 'Weight check', width: 200 }],
    r.carrier.rows.map(c => [c.carrier + ' ' + c.service + (c.recommended ? ' (recommended)' : ''), PF.gbp(c.pricePerPallet), c.total === null ? '-' : PF.gbp(c.total), String(c.transit), c.ontime + '%', c.note || '-']));
  if (r.changes.length) {
    p.heading('Fixes applied (before -> after)');
    p.table([{ header: 'Rule', width: 50 }, { header: 'Applies to', width: 100 }, { header: 'Field', width: 130 }, { header: 'Before', width: 90 }, { header: 'After', width: 90 }], r.changes.map(c => [c.rule, c.scope, c.field, c.from, c.to]));
  }
}

function fileName(base: string) { return pdfSafe(base).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'report'; }

/** Builds the PDF document for one booking. `compress: false` is for tests, so the text can be read back. */
export function bookingReportPdf(r: BookingReport, opts: { now?: Date; compress?: boolean } = {}): jsPDF {
  const now = opts.now || new Date();
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: opts.compress !== false });
  const p = new Page(doc, REPORT_FOOTER);
  p.masthead('Pre-flight check report', 'Generated ' + stamp(now));
  bookingSection(p, r, now);
  p.finish();
  return doc;
}

/** One summary page for the whole upload, then a section per booking. */
export function fileReportPdf(f: FileReport, opts: { now?: Date; compress?: boolean } = {}): jsPDF {
  const now = opts.now || new Date();
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: opts.compress !== false });
  const p = new Page(doc, REPORT_FOOTER);
  p.masthead('Pre-flight check report: ' + f.fileName, 'Generated ' + stamp(now));
  p.facts([['Bookings', String(f.counts.total)], ['Ready', String(f.counts.ready)], ['Needs attention', String(f.counts.attention)], ['Blocked', String(f.counts.blocked)]]);
  p.heading('All bookings');
  p.table([{ header: 'Booking', width: 60 }, { header: 'Seller', width: 120 }, { header: 'Route', width: 120 }, { header: 'Status', width: 70 }, { header: 'Red', width: 28, align: 'right' }, { header: 'Amber', width: 36, align: 'right' }],
    f.bookings.map(b => [b.bookingId, b.seller, b.route, b.status, String(b.red), String(b.amber)]));
  f.bookings.forEach(b => { p.newPage(); bookingSection(p, b, now); });
  p.finish();
  return doc;
}

export function downloadBookingReport(b: any, ev: any, hs: HsResultLite[] = []) {
  const r = buildBookingReport(b, ev, hs);
  bookingReportPdf(r).save(fileName('gyst-check-report-' + r.bookingId) + '.pdf');
}
export function downloadFileReport(name: string, bookings: any[], hsFor?: (b: any) => HsResultLite[]) {
  fileReportPdf(buildFileReport(name, bookings, hsFor)).save(fileName('gyst-check-report-' + name.replace(/\.[^.]+$/, '')) + '.pdf');
}
