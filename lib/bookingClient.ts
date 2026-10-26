import { PF } from './pf';
import { fetchJson, TimeoutError } from './net';

export type BookResult = { ok: true; reference: string; saved: boolean } | { ok: false; message: string; timedOut?: boolean };

export const TOO_SLOW = 'That took too long. Nothing has been booked. Please try again.';

/**
 * One key per booking content. If a request times out and the seller clicks again, the same key is sent, so the server
 * returns the first booking instead of making a second one. Changing any booking data creates a new key.
 */
export function idempotencyKeyFor(b: any): string {
  const sig = JSON.stringify(b, (k, v) => (k.startsWith('_') ? undefined : v));
  if (b._idemSig !== sig || !b._idem) {
    const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
    b._idem = rnd; b._idemSig = sig;
  }
  return b._idem;
}

/** Asks the server to record the booking. The server re-checks the rulebook and may refuse. Never waits more than 15 s. */
export async function bookShipment(b: any, source: 'chat' | 'upload', fileName?: string): Promise<BookResult> {
  const key = idempotencyKeyFor(b);
  try {
    const { res, json: j } = await fetchJson('/api/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ booking: b, source, fileName, key, today: PF.todayISO() }),
    });
    if (res.ok && j.ok) return { ok: true, reference: j.reference, saved: !!j.saved };
    if (res.status === 422 && j.error === 'past_date') return { ok: false, message: 'The ready date is in the past. Change it to today or later before booking.' };
    if (res.status === 422 && j.error === 'warnings_not_acknowledged') return { ok: false, message: 'Please tick “I understand” for each warning before booking: ' + (j.problems || []).slice(0, 3).join('; ') + '.' };
    if (res.status === 422) return { ok: false, message: 'This booking still has problems that must be fixed first: ' + (j.problems || []).slice(0, 3).join('; ') + '.' };
    if (res.status === 429) return { ok: false, message: 'Too many requests just now. Please try again in a minute.' };
    return { ok: false, message: TOO_SLOW, timedOut: res.status === 504 };
  } catch (e) {
    return { ok: false, message: TOO_SLOW, timedOut: e instanceof TimeoutError };
  }
}
