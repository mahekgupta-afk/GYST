// The booking confirmation as a PDF, built in the browser from the same data as the on-screen panel.
import { jsPDF } from 'jspdf';
import { PF } from '../pf';
import { Page, COLORS, pdfSafe } from './layout';
import { SIMULATED_DETAIL, type Confirmation } from '../confirmation';

export const CONFIRMATION_FOOTER = 'Simulated confirmation: not yet transmitted to the carrier. Checks run using GYST’s fixed rulebook. Guidance only, not legal or customs advice.';
const d = (iso: string | null) => (iso ? PF.dmy(iso) : '-');

export function confirmationPdf(c: Confirmation, opts: { compress?: boolean } = {}): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: opts.compress !== false });
  const p = new Page(doc, CONFIRMATION_FOOTER);
  const s = c.shipment;
  p.masthead('Booking confirmation', 'Reference ' + c.reference + '   Recorded ' + d(c.bookedAt.slice(0, 10)));

  // The disclaimer comes first and is boxed, so it cannot be missed.
  const lines = doc.splitTextToSize(pdfSafe(SIMULATED_DETAIL), p.inner - 24) as string[];
  const boxH = 36 + lines.length * 12;
  doc.setFillColor(255, 246, 219); doc.setDrawColor(COLORS.brand[0], COLORS.brand[1], COLORS.brand[2]); doc.setLineWidth(1.2);
  doc.roundedRect(p.m, p.y - 10, p.inner, boxH, 6, 6, 'FD');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(COLORS.ink[0], COLORS.ink[1], COLORS.ink[2]); doc.text(pdfSafe(c.notice), p.m + 12, p.y + 8);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); lines.forEach((l, i) => doc.text(l, p.m + 12, p.y + 24 + i * 12));
  p.y += boxH + 8;

  p.heading('Carrier');
  p.facts([
    ['Carrier', c.carrier.name + ' - ' + c.carrier.service],
    ['Price', PF.gbp(c.carrier.pricePerPallet) + ' x ' + c.carrier.pallets + ' pallets = ' + PF.gbp(c.carrier.total)],
    ['Transit', c.carrier.transit + ' calendar days'],
    ['On time', c.carrier.ontime + '%'],
    ['Estimated delivery', c.estimatedDelivery ? PF.niceDate(c.estimatedDelivery) : '-'],
    ['Priority', s.priority],
  ]);
  if (c.reason) { p.heading('Why this carrier'); p.paragraph(c.reason, { size: 9.5 }); }

  p.heading('Shipment');
  p.facts([
    ['Booking ID', s.bookingId || '-'], ['Seller', s.seller || '-'],
    ['Collection from', s.originCity || '-'], ['Delivery to', (s.destCity || '-') + (s.destCountry ? ', ' + s.destCountry : '')],
    ['Delivery type', s.destType || '-'], ['Delivery appointment', s.appointment || '-'],
    ['Ready to ship', d(s.readyDate)], ['Pallets', String(s.pallets)],
    ['Cartons', s.cartons === null ? '-' : String(s.cartons)], ['Gross weight', s.grossWeight === null ? '-' : PF.nf(s.grossWeight) + ' kg'],
    ['Declared value', s.declaredValue === null ? '-' : PF.gbp(s.declaredValue)],
  ]);
  if (c.items.length) {
    p.heading('Goods');
    p.table([{ header: 'SKU', width: 70 }, { header: 'Description', width: 200 }, { header: 'Units', width: 50, align: 'right' }, { header: 'HS code', width: 80 }], c.items.map(i => [i.sku || '-', i.description || '-', i.quantity === null ? '-' : String(i.quantity), i.hs || '-']));
  }

  p.heading('Checks');
  p.paragraph(c.checks.passed + ' of ' + c.checks.total + ' checks passed.', { bold: true });
  p.table([{ header: 'Rule', width: 40 }, { header: 'What it checks', width: 330 }, { header: 'Result', width: 60 }], c.checks.rules.map(r => [r.id, r.text, r.result]), { colorCol: 2 });
  if (c.checks.acceptedWarnings.length) { p.paragraph('Warnings accepted by the seller:', { bold: true }); c.checks.acceptedWarnings.forEach(w => p.paragraph('- ' + w, { size: 9.5 })); }
  if (c.changes.length) {
    p.heading('Corrections made before booking (before -> after)');
    p.table([{ header: 'Rule', width: 50 }, { header: 'Applies to', width: 100 }, { header: 'Field', width: 130 }, { header: 'Before', width: 90 }, { header: 'After', width: 90 }], c.changes.map(x => [x.rule, x.scope, x.field, x.from, x.to]));
  }

  p.heading('Status timeline (estimates)');
  p.table([{ header: 'Step', width: 150 }, { header: 'Status', width: 90 }, { header: 'Date', width: 160 }],
    c.timeline.map(t => [t.label, t.status === 'active' ? 'Done' : 'Upcoming', t.date ? d(t.date) + (t.estimated ? ' (estimated)' : '') : 'To be confirmed']));
  p.paragraph('Only "Booked" has happened. The other steps are estimates and are not updated by a carrier.', { size: 9, color: COLORS.grey });
  p.finish();
  return doc;
}

export function downloadConfirmation(c: Confirmation) {
  confirmationPdf(c).save(pdfSafe('gyst-booking-confirmation-' + c.reference).replace(/[^A-Za-z0-9._-]+/g, '-') + '.pdf');
}
