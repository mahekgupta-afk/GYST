// Corrections made by a user in the app. Nothing here judges a booking: every edit just
// changes the data, and the unchanged rules engine then decides the result. Every change is
// logged (before, after, and which rule it addressed) so it is visible and exportable.
import { PF } from './pf';

export type Change = {
  at: string;
  rule: string;
  scope: string;          // 'Booking' or the item's SKU / description
  field: string;          // human label
  from: unknown;
  to: unknown;
};

export type Spec =
  | { kind: 'set'; field: string; value: unknown; rule: string; itemIndex?: number }
  | { kind: 'route'; city: string; rule: string }
  | { kind: 'carrier'; carrier: string; rule: string }
  | { kind: 'remove'; itemIndex: number; rule: string };

const LABEL: Record<string, string> = {
  seller: 'Seller name', pallets: 'Pallets', cartons: 'Cartons', declaredValue: 'Total declared value (£)',
  grossWeight: 'Total gross weight (kg)', appointment: 'Delivery appointment booked', readyDate: 'Ready to ship date',
  destType: 'Destination type', priority: 'Seller priority',
  hs: 'HS code', qty: 'Quantity (units)', price: 'Unit price (£)', upc: 'Units per carton', unitWeight: 'Unit weight (kg)', coo: 'Country of origin', desc: 'Description',
};

const strip = (b: any) => JSON.parse(JSON.stringify(b, (k, v) => (k.startsWith('_') ? undefined : v)));
const itemName = (it: any) => it.sku || it.desc || 'item';
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(blank)' : v);

/** Applies one correction, logs it, and clears any earlier confirmation (the facts changed). */
export function applyChange(b: any, spec: Spec): void {
  if (!b._orig) b._orig = strip(b);
  b._changes = b._changes || [];
  const log = (scope: string, field: string, from: unknown, to: unknown, rule: string) =>
    b._changes.push({ at: new Date().toISOString(), rule, scope, field, from: show(from), to: show(to) } as Change);

  if (spec.kind === 'set') {
    const target = spec.itemIndex != null ? b.items[spec.itemIndex] : b;
    log(spec.itemIndex != null ? itemName(target) : 'Booking', LABEL[spec.field] || spec.field, target[spec.field], spec.value, spec.rule);
    target[spec.field] = spec.value;
  } else if (spec.kind === 'route') {
    log('Booking', 'Destination', (b.destCity || b.destCountry), spec.city, spec.rule);
    b.destCity = spec.city;
    b.destCountry = PF.DESTS[spec.city] || b.destCountry;
  } else if (spec.kind === 'carrier') {
    log('Booking', 'Carrier', b._carrier || '(first choice)', spec.carrier, spec.rule);
    b._carrier = spec.carrier;
  } else if (spec.kind === 'remove') {
    const it = b.items[spec.itemIndex];
    log(itemName(it), 'Item removed from this shipment', `${it.desc || ''} × ${it.qty ?? '?'}`.trim(), '(removed)', spec.rule);
    b.items.splice(spec.itemIndex, 1);
  }
  b._confirmed = false;
  delete b._ref;
}

/** Puts the booking back to exactly what was uploaded. */
export function resetBooking(b: any): void {
  if (!b._orig) return;
  const original = JSON.parse(JSON.stringify(b._orig));
  Object.keys(b).forEach(k => delete b[k]);
  Object.assign(b, original);
}

export const hasChanges = (b: any) => !!(b._changes && b._changes.length);

/** Numbers the user can adopt in one click. They are suggestions only: the user decides. */
export function suggestions(b: any) {
  const items = b.items || [];
  const num = (v: any) => (typeof v === 'number' ? v : 0);
  return {
    itemsValue: Math.round(items.reduce((s: number, i: any) => s + num(i.qty) * num(i.price), 0) * 100) / 100,
    itemsCartons: items.reduce((s: number, i: any) => s + num(i.cartons), 0),
    itemsWeight: Math.round(items.reduce((s: number, i: any) => s + num(i.qty) * num(i.unitWeight), 0) * 1000) / 1000,
  };
}

/** Item-level checks used only to point at the right rows in the editor. The engine remains the judge. */
export const itemFlags = (it: any) => {
  const h = PF.hsInfo(it.hs);
  return {
    hs: h.blank || !h.valid || h.digits.length < 6,
    cartonMath: typeof it.qty === 'number' && typeof it.upc === 'number' && typeof it.cartons === 'number' && it.upc * it.cartons !== it.qty,
    coo: !it.coo,
  };
};

const fmtDate = (iso: string | null) => (iso ? PF.dmy(iso) : '');

/** Rows for a corrected workbook in the same template layout the parser reads. */
export function correctedRows(bookings: any[]) {
  const bookingRows: unknown[][] = [['Bookings: one row per shipment. Enter data from row 3.'], [...PF.BH, 'Chosen carrier']];
  const itemRows: unknown[][] = [['Items: one row per product in a booking. Enter data from row 3.'], PF.IH];
  const changeRows: unknown[][] = [['Booking ID', 'Rule addressed', 'Applies to', 'Field', 'Was', 'Now', 'When']];
  const resultRows: unknown[][] = [['Booking ID', 'Seller', 'Status after corrections', 'Open red', 'Open amber', 'Carrier', 'Total (£)', 'Reference']];
  bookings.forEach(b => {
    const ev = PF.evaluate(b);
    bookingRows.push([b.id, b.seller, b.originCity, b.originCountry, b.destCity, b.destCountry, b.destType, fmtDate(b.readyDate), b.priority, b.pallets, b.cartons, b.declaredValue, b.currency || 'GBP', b.grossWeight, b.appointment, b._carrier || '']);
    (b.items || []).forEach((i: any) => itemRows.push([b.id, i.sku, i.desc, i.hs == null ? null : String(i.hs), i.qty, i.price, i.upc, i.cartons, i.unitWeight, i.coo]));
    (b._changes || []).forEach((c: Change) => changeRows.push([b.id, c.rule, c.scope, c.field, String(c.from), String(c.to), c.at]));
    const sel = ev.rec.selected;
    resultRows.push([b.id, b.seller, b._ref ? 'Booked' : ev.status === 'blocked' ? 'Needs fixing' : ev.status === 'warning' ? 'Ready (warnings)' : 'Ready', ev.counts.red, ev.counts.amber, sel ? sel.carrier : '', sel && ev.rec.pallets ? sel.price * ev.rec.pallets : '', b._ref || '']);
  });
  return { bookingRows, itemRows, changeRows, resultRows };
}
