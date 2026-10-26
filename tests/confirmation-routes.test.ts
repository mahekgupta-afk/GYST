// Saving a booking stores its confirmation and a secret key; reopening needs both the reference and the key.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PF } from '../lib/pf';

type Row = { reference: string; idempotency_key: string | null; confirmation: any; access_key: string | null; carrier: string; pallets: number };
const store = vi.hoisted(() => ({ rows: [] as any[], enabled: true }));
vi.mock('../lib/server/db', () => ({
  dbEnabled: () => store.enabled,
  ensureSchema: async () => {},
  withTimeout: <T,>(p: Promise<T>) => p,
  db: () => async (strings: TemplateStringsArray, ...v: any[]) => {
    const q = strings.join('?');
    if (/INSERT INTO bookings/.test(q)) {
      const [reference, , , , , carrier, pallets, , , , , key, confirmation, access] = v;
      if (store.rows.some(r => r.reference === reference || (key && r.idempotency_key === key))) return [];
      store.rows.push({ reference, idempotency_key: key, confirmation: JSON.parse(confirmation), access_key: access, carrier, pallets });
      return [{ reference }];
    }
    if (/WHERE idempotency_key/.test(q)) return store.rows.filter(r => r.idempotency_key === v[0]).slice(0, 1);
    if (/WHERE reference/.test(q)) return store.rows.filter(r => r.reference === v[0]).slice(0, 1);
    return [];
  },
}));
let ip = 0;
vi.mock('../lib/server/rateLimit', () => ({ allow: () => true, clientIp: () => 'ip-' + ip++ }));

import { POST } from '../app/api/bookings/route';
import { GET } from '../app/api/bookings/[ref]/route';

const booking = () => JSON.parse(JSON.stringify((PF.bookingsFromTables(...(Object.values(PF.sampleTables(PF.todayISO())) as [any, any])).bookings as any[]).find(b => b.id === 'BK-001')));
const post = (b: any, key = 'abcdef12-key') => POST(new Request('http://x/api/bookings', { method: 'POST', body: JSON.stringify({ booking: b, source: 'chat', key, today: PF.todayISO() }) }));
const get = (ref: string, k?: string) => GET(new Request('http://x/api/bookings/' + ref + (k !== undefined ? '?k=' + k : '')), { params: Promise.resolve({ ref }) });

beforeEach(() => { store.rows.length = 0; store.enabled = true; });

describe('saving a booking', () => {
  it('returns the confirmation and a secret key, and stores both', async () => {
    const res = await post(booking()), j = await res.json();
    expect(j).toMatchObject({ ok: true, saved: true });
    expect(j.reference).toMatch(/^GYST-\d{8}-[0-9A-F]{6}$/);
    expect(j.accessKey).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(j.confirmation).toMatchObject({ reference: j.reference, simulated: true, carrier: { name: 'Carrier A', total: 540 } });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].access_key).toBe(j.accessKey);
    expect(store.rows[0].confirmation).toEqual(j.confirmation);
  });
  it('a retry with the same key returns the same booking, confirmation and secret, and stores nothing new', async () => {
    const a = await (await post(booking())).json(), b = await (await post(booking())).json();
    expect(b.reference).toBe(a.reference); expect(b.accessKey).toBe(a.accessKey); expect(b.confirmation).toEqual(a.confirmation);
    expect(b.duplicate).toBe(true); expect(store.rows).toHaveLength(1);
  });
  it('without a database it still returns the confirmation (and no link), saying it was not saved', async () => {
    store.enabled = false;
    const j = await (await post(booking())).json();
    expect(j).toMatchObject({ ok: true, saved: false }); expect(j.confirmation.reference).toBe(j.reference); expect(j.accessKey).toBeUndefined();
  });
  it('a booking with a red problem is still refused and nothing is stored', async () => {
    const b = booking(); b.declaredValue = 1;
    const res = await post(b); expect(res.status).toBe(422); expect(store.rows).toHaveLength(0);
  });
});

describe('reopening a confirmation', () => {
  it('opens with the right reference and key, and is not cached', async () => {
    const a = await (await post(booking())).json();
    const res = await get(a.reference, a.accessKey);
    expect(res.status).toBe(200); expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect((await res.json()).confirmation).toEqual(a.confirmation);
  });
  it('a wrong key, no key, a bad key shape, a wrong reference and an unknown reference all get the same 404', async () => {
    const a = await (await post(booking())).json();
    const wrong = a.accessKey.slice(0, -1) + (a.accessKey.endsWith('A') ? 'B' : 'A');
    const bodies = [];
    for (const [ref, k] of [[a.reference, wrong], [a.reference, undefined], [a.reference, 'short'], ['nope', a.accessKey], ['GYST-20200101-AAAAAA', a.accessKey]] as [string, string | undefined][]) {
      const res = await get(ref, k); expect(res.status, ref + ' ' + k).toBe(404); bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).not.toContain('Northfield');
  });
  it('an older booking with no stored confirmation cannot be opened', async () => {
    const a = await (await post(booking())).json(); store.rows[0].confirmation = null;
    expect((await get(a.reference, a.accessKey)).status).toBe(404);
  });
  it('says so, without details, when there is no database', async () => {
    store.enabled = false;
    const res = await get('GYST-20261026-ABC123', 'a'.repeat(24)); expect(res.status).toBe(503);
  });
});
