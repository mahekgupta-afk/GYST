// Server side of "booking is safe to retry". No database needed for these.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST } from '../app/api/bookings/route';
import { referenceFor, newReference } from '../lib/server/booking';

const body = (over: any = {}) => ({
  source: 'chat', key: 'abc12345-key', today: '2026-10-26',
  booking: { id: 'T-1', seller: 'Acme', originCity: 'Leeds', destCity: 'Paris', destCountry: 'France', destType: 'Business address', readyDate: '2030-01-01', priority: 'Cheapest',
    pallets: 2, cartons: 10, declaredValue: 100, grossWeight: 300, appointment: 'Yes', items: [{ sku: 'A', desc: 'Mug', hs: '691200', qty: 100, price: 1, upc: 10, cartons: 10, unitWeight: 0.1, coo: 'China' }] },
  ...over,
});
const post = (b: any, ip = '9.9.9.' + Math.floor(Math.random() * 250)) =>
  POST(new Request('http://x/api/bookings', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(b) }));

beforeEach(() => { vi.stubEnv('DATABASE_URL', ''); });
afterEach(() => vi.unstubAllEnvs());

describe('a retried booking cannot become a second booking', () => {
  it('the same key always gives the same reference', async () => {
    const a: any = await (await post(body())).json();
    const b: any = await (await post(body())).json();
    expect(a.ok).toBe(true);
    expect(b.reference).toBe(a.reference);
    expect(a.reference).toBe(referenceFor('abc12345-key'));
  });
  it('different keys give different references; with no key every request is its own booking', async () => {
    const a: any = await (await post(body({ key: 'key-one-1234' }))).json();
    const b: any = await (await post(body({ key: 'key-two-1234' }))).json();
    expect(a.reference).not.toBe(b.reference);
    const c: any = await (await post(body({ key: undefined }))).json();
    const d: any = await (await post(body({ key: undefined }))).json();
    expect(c.reference).not.toBe(d.reference);
    expect(c.reference).toMatch(/^GYST-\d{8}-[0-9A-F]{6}$/);
  });
  it('a malformed key is ignored rather than trusted', async () => {
    const r: any = await (await post(body({ key: 'x' }))).json();
    expect(r.ok).toBe(true);
    expect(r.reference).not.toBe(referenceFor('x'));
  });
  it('a refused booking is still refused with the key present, and never reaches storage', async () => {
    const bad = body(); bad.booking.pallets = 0;
    const res = await post(bad);
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error).toBe('blocked');
  });
  it('references are deterministic per key and look right', () => {
    expect(referenceFor('k-12345678')).toBe(referenceFor('k-12345678'));
    expect(referenceFor('k-12345678')).toMatch(/^GYST-\d{8}-[0-9A-F]{6}$/);
    expect(newReference()).not.toBe(newReference());
  });
});
