// Opt-in: talks to the real Neon database. Run with RUN_DB_TESTS=1 npx vitest run tests/db-idempotency.live.test.ts
// It writes two test rows and deletes them again.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const run = process.env.RUN_DB_TESTS === '1';
describe.skipIf(!run)('idempotent booking against the real database', () => {
  it('the same key twice gives one row and the same reference; a different key gives a second row', async () => {
    const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
    process.env.DATABASE_URL = env.DATABASE_URL;
    const { POST } = await import('../app/api/bookings/route');
    const { db } = await import('../lib/server/db');
    const mk = (key: string, ip: string) => new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({
      source: 'chat', key, fileName: 'idempotency-test', booking: { id: 'IDEM-TEST', seller: 'Idempotency Test', originCity: 'Leeds', destCity: 'Paris', destCountry: 'France', destType: 'Business address', readyDate: '2030-01-01', priority: 'Cheapest',
        pallets: 2, cartons: 10, declaredValue: 100, grossWeight: 300, appointment: 'Yes', items: [{ sku: 'A', desc: 'Mug', hs: '691200', qty: 100, price: 1, upc: 10, cartons: 10, unitWeight: 0.1, coo: 'China' }] } }) });
    const k1 = 'idem-test-' + Date.now() + '-a', k2 = 'idem-test-' + Date.now() + '-b';
    try {
      const a: any = await (await POST(mk(k1, '8.8.8.1'))).json();
      const b: any = await (await POST(mk(k1, '8.8.8.2'))).json();
      const c: any = await (await POST(mk(k2, '8.8.8.3'))).json();
      expect(a.ok && a.saved).toBe(true);
      expect(a.duplicate).toBe(false);
      expect(b.reference).toBe(a.reference);
      expect(b.duplicate).toBe(true);
      expect(c.reference).not.toBe(a.reference);
      const rows = (await db()`SELECT reference FROM bookings WHERE idempotency_key = ANY(${[k1, k2]})`) as unknown[];
      expect(rows).toHaveLength(2);
    } finally {
      await db()`DELETE FROM bookings WHERE idempotency_key = ANY(${[k1, k2]})`;
    }
  }, 60000);
});
