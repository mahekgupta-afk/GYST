import { randomBytes } from 'node:crypto';
import { PF } from '../pf';

export type BookingCheck =
  | { ok: true; ev: any; clean: any }
  | { ok: false; status: 422 | 400; error: string; red?: number; problems?: string[] };

const todayUTC = () => new Date().toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);

/**
 * The gate every booking passes through. It re-runs the unchanged rules engine on the server,
 * so a booking with any red issue can never be recorded, whatever the browser sent.
 */
export function checkBooking(input: any, clientToday?: string): BookingCheck {
  if (!input || typeof input !== 'object' || !Array.isArray(input.items)) return { ok: false, status: 400, error: 'bad_request' };
  // Keep only the data the engine reads, plus the chosen carrier and the correction log.
  const clean: any = JSON.parse(JSON.stringify(input, (k, v) => (k.startsWith('_') && k !== '_carrier' && k !== '_changes' ? undefined : v)));
  // The client's "today" is accepted only within a day of the server's, to allow for time zones.
  const today = clientToday && /^\d{4}-\d{2}-\d{2}$/.test(clientToday) && dayDiff(clientToday, todayUTC()) <= 1 ? clientToday : todayUTC();
  let ev: any;
  try { ev = PF.evaluate(clean, { todayISO: today }); } catch { return { ok: false, status: 400, error: 'unreadable_booking' }; }
  if (ev.status === 'blocked') {
    return { ok: false, status: 422, error: 'blocked', red: ev.counts.red, problems: ev.issues.filter((i: any) => i.sev === 'red').map((i: any) => i.title) };
  }
  return { ok: true, ev, clean };
}

export function newReference(): string {
  return 'GYST-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + randomBytes(3).toString('hex').toUpperCase();
}
