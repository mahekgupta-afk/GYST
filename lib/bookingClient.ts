import { PF } from './pf';

export type BookResult = { ok: true; reference: string; saved: boolean } | { ok: false; message: string };

/** Asks the server to record the booking. The server re-checks the rulebook and may refuse. */
export async function bookShipment(b: any, source: 'chat' | 'upload', fileName?: string): Promise<BookResult> {
  try {
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ booking: b, source, fileName, today: PF.todayISO() }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.ok) return { ok: true, reference: j.reference, saved: !!j.saved };
    if (res.status === 422 && j.error === 'warnings_not_acknowledged') return { ok: false, message: 'Please tick “I understand” for each warning before booking: ' + (j.problems || []).slice(0, 3).join('; ') + '.' };
    if (res.status === 422) return { ok: false, message: 'This booking still has problems that must be fixed first: ' + (j.problems || []).slice(0, 3).join('; ') + '.' };
    if (res.status === 429) return { ok: false, message: 'Too many requests just now. Please try again in a minute.' };
    return { ok: false, message: 'We couldn’t record the booking. Nothing was booked, please try again.' };
  } catch {
    return { ok: false, message: 'We couldn’t reach the server. Nothing was booked, please try again.' };
  }
}
