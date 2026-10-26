import { randomBytes, createHash } from 'node:crypto';
import { PF } from '../pf';
import { issueKey } from '../fixes';

export type BookingCheck =
  | { ok: true; ev: any; clean: any }
  | { ok: false; status: 422 | 400; error: string; red?: number; problems?: string[] };

const KEEP = new Set(['_carrier', '_changes', '_acks', '_dupCount', '_dupLater', '_dupRows', '_row']);
const todayUTC = () => new Date().toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);

/**
 * The gate every booking passes through. It re-runs the unchanged rules engine on the server,
 * so a booking with any red issue can never be recorded, whatever the browser sent.
 */
export function checkBooking(input: any, clientToday?: string): BookingCheck {
  if (!input || typeof input !== 'object' || !Array.isArray(input.items)) return { ok: false, status: 400, error: 'bad_request' };
  // Keep only the data the engine reads, plus the chosen carrier and the correction log.
  const clean: any = JSON.parse(JSON.stringify(input, (k, v) => (k.startsWith('_') && !KEEP.has(k) ? undefined : v)));
  // The client's "today" is accepted only within a day of the server's, to allow for time zones.
  const today = clientToday && /^\d{4}-\d{2}-\d{2}$/.test(clientToday) && dayDiff(clientToday, todayUTC()) <= 1 ? clientToday : todayUTC();
  let ev: any;
  try { ev = PF.evaluate(clean, { todayISO: today }); } catch { return { ok: false, status: 400, error: 'unreadable_booking' }; }
  if (ev.status === 'blocked') {
    return { ok: false, status: 422, error: 'blocked', red: ev.counts.red, problems: ev.issues.filter((i: any) => i.sev === 'red').map((i: any) => i.title) };
  }
  // A past ready date is reported as Amber (R-10) but cannot be booked until the date is corrected.
  if (ev.issues.some((i: any) => i.rule === 'R-10')) return { ok: false, status: 422, error: 'past_date', problems: ['The ready to ship date is in the past. Change it to today or later.'] };
  // Warnings do not block a booking, but each one must have been acknowledged by the seller.
  const acks = new Set(Array.isArray(clean._acks) ? clean._acks : []);
  const open = ev.issues.filter((i: any) => i.sev === 'amber' && !acks.has(issueKey(i)));
  if (open.length) return { ok: false, status: 422, error: 'warnings_not_acknowledged', problems: open.map((i: any) => i.title) };
  return { ok: true, ev, clean };
}

/** The same key always gives the same reference (on a given day), so a retried request cannot create a second booking. */
export function referenceFor(key: string): string {
  return 'GYST-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + createHash('sha256').update(key).digest('hex').slice(0, 6).toUpperCase();
}
export function newReference(): string {
  return 'GYST-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + randomBytes(3).toString('hex').toUpperCase();
}
