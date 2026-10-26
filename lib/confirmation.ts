// The booking confirmation: a snapshot of what was booked, built only from the booking and the engine's own results.
// It is SIMULATED: the booking is recorded under a reference, but nothing is transmitted to a carrier, and no carrier
// reference is invented. The words below say so wherever the confirmation is shown.
import { PF } from './pf';
import { issueKey } from './fixes';

export const SIMULATED_NOTICE = 'Simulated confirmation: not yet transmitted to the carrier.';
export const SIMULATED_DETAIL = 'Your booking is recorded under this reference and has passed the checks, but GYST does not send it to the carrier yet. Nothing here is a carrier booking or a carrier reference. The dates below are estimates.';

export type TimelineStep = { key: 'booked' | 'collection' | 'transit' | 'customs' | 'delivered'; label: string; status: 'active' | 'upcoming'; date: string | null; estimated: boolean };
export type Confirmation = {
  version: 1;
  reference: string;
  bookedAt: string;                 // ISO date-time
  simulated: true;
  notice: string;
  carrier: { name: string; service: string; pricePerPallet: number; pallets: number; total: number; transit: number; ontime: number };
  estimatedDelivery: string | null;
  shipment: {
    bookingId: string; seller: string; originCity: string; destCity: string; destCountry: string; destType: string; appointment: string;
    readyDate: string | null; pallets: number; cartons: number | null; grossWeight: number | null; declaredValue: number | null; priority: string;
  };
  items: { sku: string; description: string; quantity: number | null; hs: string }[];
  reason: string;
  checks: { passed: number; total: number; rules: { id: string; text: string; result: 'Pass' | 'Amber' | 'Red' | 'Not checked' }[]; acceptedWarnings: string[] };
  changes: { rule: string; scope: string; field: string; from: string; to: string }[];
  timeline: TimelineStep[];
};

const addDays = (iso: string, n: number) => PF.addDays(iso, n);
const later = (a: string, b: string) => (a > b ? a : b);

/** Builds the confirmation for a booking that has just passed. Pure: the same booking and time always give the same result. */
export function buildConfirmation(b: any, ev: any, meta: { reference: string; bookedAt?: string }): Confirmation {
  const rec = ev.rec, sel = rec.selected;
  const bookedAt = meta.bookedAt || new Date().toISOString();
  const ready: string | null = b.readyDate || null;
  const eta = ready ? addDays(ready, sel.transit) : null;
  const acks: string[] = b._acks || [];
  const rules = PF.RULES.map((r: any) => {
    const st = ev.ruleStatus[r.id];
    return { id: r.id, text: r.text, result: (st === 'pass' ? 'Pass' : st === 'red' ? 'Red' : st === 'amber' ? 'Amber' : 'Not checked') as 'Pass' | 'Amber' | 'Red' | 'Not checked' };
  });
  // Estimated steps only. "Customs" is the day before the estimated delivery (or the transit day if that is not later).
  const transit = ready ? addDays(ready, 1) : null;
  const customs = eta && transit ? later(addDays(eta, -1), transit) : null;
  const timeline: TimelineStep[] = [
    { key: 'booked', label: 'Booked', status: 'active', date: bookedAt.slice(0, 10), estimated: false },
    { key: 'collection', label: 'Collection scheduled', status: 'upcoming', date: ready, estimated: true },
    { key: 'transit', label: 'In transit', status: 'upcoming', date: transit, estimated: true },
    { key: 'customs', label: 'Customs', status: 'upcoming', date: customs, estimated: true },
    { key: 'delivered', label: 'Delivered', status: 'upcoming', date: eta, estimated: true },
  ];
  return {
    version: 1, reference: meta.reference, bookedAt, simulated: true, notice: SIMULATED_NOTICE,
    carrier: { name: sel.carrier, service: sel.service, pricePerPallet: sel.price, pallets: rec.pallets, total: sel.price * rec.pallets, transit: sel.transit, ontime: sel.ontime },
    estimatedDelivery: eta,
    shipment: {
      bookingId: b.id || '', seller: b.seller || '', originCity: b.originCity || '', destCity: b.destCity || '', destCountry: b.destCountry || '', destType: b.destType || '', appointment: b.appointment || '',
      readyDate: ready, pallets: rec.pallets, cartons: b.cartons ?? null, grossWeight: b.grossWeight ?? null, declaredValue: b.declaredValue ?? null, priority: rec.priority,
    },
    items: (b.items || []).map((i: any) => ({ sku: i.sku || '', description: i.desc || '', quantity: i.qty ?? null, hs: i.hs == null ? '' : String(i.hs) })),
    reason: rec.reason || '',
    checks: {
      passed: rules.filter((r: any) => r.result === 'Pass').length, total: rules.length, rules,
      acceptedWarnings: ev.issues.filter((i: any) => i.sev === 'amber' && acks.includes(issueKey(i))).map((i: any) => i.title + (i.item ? ' (' + i.item + ')' : '')),
    },
    changes: (b._changes || []).map((c: any) => ({ rule: c.rule, scope: c.scope, field: c.field, from: String(c.from), to: String(c.to) })),
    timeline,
  };
}
