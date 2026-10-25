import { describe, it, expect } from 'vitest';
import { PF } from '../lib/pf';
import { checkBooking, newReference } from '../lib/server/booking';

const all = () => PF.bookingsFromTables(...(Object.values(PF.sampleTables(PF.todayISO())) as [any, any])).bookings as any[];
const get = (id: string) => all().find(b => b.id === id);

describe('server booking gate', () => {
  it('refuses a booking with red issues, and says which', () => {
    const r: any = checkBooking(get('BK-003'));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(422);
    expect(r.red).toBeGreaterThan(0);
    expect(r.problems.length).toBe(r.red);
  });
  it('accepts a clear booking', () => {
    expect(checkBooking(get('BK-001')).ok).toBe(true);
  });
  it('accepts a booking that has only amber warnings', () => {
    const r: any = checkBooking(get('BK-010'));
    expect(r.ok).toBe(true);
    expect(r.ev.counts.amber).toBeGreaterThan(0);
  });
  it('cannot be fooled by fake status fields sent by the browser', () => {
    const b = get('BK-006');
    b._confirmed = true; b.status = 'clear'; b._edited = false;
    expect(checkBooking(b).ok).toBe(false);
  });
  it('still judges R-05 against the carrier the user chose', () => {
    const b = get('BK-006');
    expect(checkBooking(b).ok).toBe(false);     // Carrier C is over its limit
    b._carrier = 'Carrier B';
    expect(checkBooking(b).ok).toBe(true);
  });
  it('rejects malformed input instead of throwing', () => {
    expect((checkBooking(null) as any).ok).toBe(false);
    expect((checkBooking({ items: 'nope' }) as any).ok).toBe(false);
    expect((checkBooking({ items: [null] }) as any).ok).toBe(false);
  });
  it('a past date is only a warning, and a client date far from the server date is ignored', () => {
    const b = get('BK-001');
    const r: any = checkBooking(b, '1999-01-01');
    expect(r.ok).toBe(true);
    expect(r.ev.today).not.toBe('1999-01-01');
  });
  it('references look right and are unique', () => {
    const a = newReference(), b = newReference();
    expect(a).toMatch(/^GYST-\d{8}-[0-9A-F]{6}$/);
    expect(a).not.toBe(b);
  });
});
