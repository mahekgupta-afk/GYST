// Corrections made by a user in the app. Nothing here judges a booking: every edit just
// changes the data, and the unchanged rules engine then decides the result. Every change is
// logged (before, after, and which rule it addressed) so it is visible and exportable.
import { PF } from './pf';
import { checkNumber, checkHs, checkReadyDate, chatRejection, chatHsRejection, type FieldKey } from './validate';

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

// Transient UI state is left out of the snapshot; data that came from the file (_row, _uid, _dup*) and the carrier choice are kept.
const TRANSIENT = new Set(['_orig', '_changes', '_confirmed', '_ref', '_saved', '_bookError', '_edited', '_acks', '_idem', '_idemSig', '_confirmation', '_accessKey']);
const strip = (b: any) => JSON.parse(JSON.stringify(b, (k, v) => (TRANSIENT.has(k) ? undefined : v)));

/** Stable id for an issue, used to record which warnings the seller acknowledged. */
export const issueKey = (i: { rule: string; item?: string | null; title: string }) => [i.rule, i.item || '', i.title].join('|');
/** A past ready date (R-10, Amber) is still reported as Amber, but the booking cannot be made until the date is corrected. */
export const hasPastDate = (ev: any): boolean => ev.issues.some((i: any) => i.rule === 'R-10');
/** Amber warnings that have not been acknowledged yet. The past-date warning cannot be acknowledged away: it has to be fixed. */
export const unacknowledged = (b: any, ev: any): any[] => ev.issues.filter((i: any) => i.sev === 'amber' && i.rule !== 'R-10' && !(b._acks || []).includes(issueKey(i)));
/** Booking is allowed when nothing is red, the date is not in the past, and every other amber warning has been acknowledged. */
export const canBook = (b: any, ev: any) => ev.status !== 'blocked' && !hasPastDate(ev) && unacknowledged(b, ev).length === 0;
const itemName = (it: any) => it.sku || it.desc || 'item';
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(blank)' : v);

export type ApplyResult = { ok: true } | { ok: false; message: string };

// Same validators as the chat, uploads and inline inputs. A value that fails is refused and the old value stays.
const COUNT_KEYS: Record<string, FieldKey> = { pallets: 'pallets', cartons: 'cartons', declaredValue: 'declaredValue', grossWeight: 'grossWeight' };
const ITEM_COUNT_KEYS: Record<string, FieldKey> = { qty: 'qty', price: 'price', upc: 'upc', cartons: 'itemCartons', unitWeight: 'unitWeight' };
function refuse(spec: Spec): { message: string; value?: unknown } | null {
  if (spec.kind !== 'set') return null;
  const fk = spec.itemIndex != null ? ITEM_COUNT_KEYS[spec.field] : COUNT_KEYS[spec.field];
  if (fk) {
    const c = checkNumber(fk, spec.value);
    if (!c.ok) return { message: chatRejection(fk, c) };
    return { message: '', value: c.value };
  }
  if (spec.field === 'hs' && spec.value !== null && spec.value !== undefined && String(spec.value).trim() !== '') {
    const h = checkHs(spec.value);
    if (!h.ok) return { message: chatHsRejection(h) };
    return { message: '', value: h.value };
  }
  if (spec.field === 'readyDate') {
    const d = checkReadyDate(String(spec.value || ''), PF.todayISO());
    if (!d.ok) return { message: d.message };
  }
  return null;
}

/** Applies one correction, logs it, and clears any earlier confirmation (the facts changed). Refuses invalid values. */
export function applyChange(b: any, spec: Spec): ApplyResult {
  const bad = refuse(spec);
  if (bad && bad.message) return { ok: false, message: bad.message };
  if (bad && spec.kind === 'set' && bad.value !== undefined) spec = { ...spec, value: bad.value };
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
  delete b._ref; delete b._confirmation; delete b._accessKey;
  return { ok: true };
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
    const sel = ev.rec.blocked ? null : ev.rec.selected;
    resultRows.push([b.id || '(no ID)', b.seller, b._ref ? 'Booked' : ev.status === 'blocked' ? 'Needs fixing' : ev.status === 'warning' ? 'Ready (warnings)' : 'Ready', ev.counts.red, ev.counts.amber, sel ? sel.carrier : '', sel && ev.rec.pallets ? sel.price * ev.rec.pallets : '', b._ref || '']);
  });
  return { bookingRows, itemRows, changeRows, resultRows };
}
