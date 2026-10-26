// @vitest-environment jsdom
// Booking confirmation: the data, the PDF, saving and reopening by secret link, and the on-screen panel. All of it says "simulated".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import { PF } from '../lib/pf';
import { applyChange, issueKey } from '../lib/fixes';
import { buildConfirmation, SIMULATED_NOTICE } from '../lib/confirmation';
import { confirmationPdf, CONFIRMATION_FOOTER } from '../lib/pdf/confirmation';
import { keyMatches, newAccessKey, KEY_PATTERN, REF_PATTERN } from '../lib/server/access';
import ConfirmationPanel from '../components/ConfirmationPanel';
import BookingView from '../components/BookingView';

const bk = (id = 'BK-001') => JSON.parse(JSON.stringify((PF.bookingsFromTables(...(Object.values(PF.sampleTables(PF.todayISO())) as [any, any])).bookings as any[]).find(b => b.id === id)));
const AT = '2026-10-26T10:30:00.000Z';
const make = (b = bk(), ref = 'GYST-20261026-ABC123') => buildConfirmation(b, PF.evaluate(b), { reference: ref, bookedAt: AT });
const raw = (doc: any) => Buffer.from(doc.output('arraybuffer')).toString('latin1');

describe('the confirmation data', () => {
  it('has the reference, carrier, price, transit, on-time and the estimated delivery', () => {
    const b = bk(), c = make(b);
    expect(c.reference).toBe('GYST-20261026-ABC123');
    expect(c.carrier).toEqual({ name: 'Carrier A', service: 'Road economy', pricePerPallet: 180, pallets: 3, total: 540, transit: 5, ontime: 92 });
    expect(c.estimatedDelivery).toBe(PF.addDays(b.readyDate, 5));
  });
  it('has every shipment field', () => {
    const c = make(), s = c.shipment;
    expect(s).toMatchObject({ bookingId: 'BK-001', seller: 'Northfield Goods', originCity: 'Manchester', destCity: 'Frankfurt', destCountry: 'Germany', destType: 'Warehouse', appointment: 'Yes', pallets: 3, cartons: 90, grossWeight: 620, declaredValue: 5400, priority: 'Cheapest' });
    expect(s.readyDate).toBeTruthy();
    expect(c.items[0]).toMatchObject({ sku: 'MUG-01', quantity: 1080 });
  });
  it('carries the plain-English reason for the carrier, the checks passed, and the accepted warnings', () => {
    const b = bk('BK-005'); b._acks = [];
    const ev = PF.evaluate(b);
    const c = make(bk());
    expect(c.reason).toContain('Carrier A (Road economy) is the cheapest carrier');
    expect(c.checks).toMatchObject({ passed: 10, total: 10, acceptedWarnings: [] });
    const w = bk(); w.destType = 'Warehouse'; w.appointment = 'No';
    const evw = PF.evaluate(w); const amber = evw.issues.find((i: any) => i.rule === 'R-08');
    w._acks = [issueKey(amber)];
    const cw = buildConfirmation(w, evw, { reference: 'GYST-20261026-ABC123', bookedAt: AT });
    expect(cw.checks.passed).toBe(9);
    expect(cw.checks.acceptedWarnings).toEqual([amber.title]);
    expect(ev).toBeTruthy();
  });
  it('lists the corrections made before booking', () => {
    const b = bk(); b.declaredValue = 6000; applyChange(b, { kind: 'set', field: 'declaredValue', value: 5400, rule: 'R-02' });
    expect(make(b).changes).toEqual([{ rule: 'R-02', scope: 'Booking', field: 'Total declared value (£)', from: '6000', to: '5400' }]);
  });
  it('the timeline is Booked, Collection scheduled, In transit, Customs, Delivered; only Booked is active and the rest are estimates', () => {
    const b = bk(), c = make(b);
    expect(c.timeline.map(t => t.label)).toEqual(['Booked', 'Collection scheduled', 'In transit', 'Customs', 'Delivered']);
    expect(c.timeline.map(t => t.status)).toEqual(['active', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
    expect(c.timeline.map(t => t.estimated)).toEqual([false, true, true, true, true]);
    expect(c.timeline[0].date).toBe('2026-10-26');
    expect(c.timeline[1].date).toBe(b.readyDate);
    expect(c.timeline[4].date).toBe(c.estimatedDelivery);
    const dates = c.timeline.slice(1).map(t => t.date as string);
    expect([...dates].sort()).toEqual(dates);                       // never out of order, even for a 2-day transit
    const fast = bk(); fast.priority = 'Fastest'; const cf = make(fast);
    const fd = cf.timeline.slice(1).map(t => t.date as string);
    expect([...fd].sort()).toEqual(fd);
  });
  it('is honestly labelled simulated, and invents no carrier reference', () => {
    const c: any = make();
    expect(c.simulated).toBe(true);
    expect(c.notice).toBe(SIMULATED_NOTICE);
    expect(SIMULATED_NOTICE).toContain('not yet transmitted to the carrier');
    expect(Object.keys(c).concat(Object.keys(c.carrier)).filter(k => /carrierRef|tracking|consignment|waybill/i.test(k))).toEqual([]);
  });
  it('is the same every time for the same booking and time', () => { expect(make()).toEqual(make()); });
});

describe('the confirmation PDF', () => {
  it('contains the disclaimer first, the reference, carrier, price, shipment details, checks and timeline', () => {
    const doc = confirmationPdf(make(), { compress: false });
    const txt = raw(doc);
    expect(txt.startsWith('%PDF-')).toBe(true);
    for (const needle of ['GYST SHIPMENTS', 'Booking confirmation', 'GYST-20261026-ABC123', 'Simulated confirmation: not yet transmitted to the carrier.', 'Carrier A', 'Road economy', '540', 'Northfield Goods', 'Frankfurt', 'Why this carrier', '10 of 10 checks passed', 'Status timeline', 'Collection scheduled', 'Customs', 'Delivered', 'estimated']) expect(txt, needle).toContain(needle);
    expect(txt.indexOf('Simulated confirmation')).toBeLessThan(txt.indexOf('Carrier A'));
    expect((txt.match(/not yet transmitted to the carrier\. Checks run/g) || []).length).toBe(doc.getNumberOfPages());
    expect(CONFIRMATION_FOOTER).toContain('not legal or customs advice');
  });
});

describe('the secret link', () => {
  it('keys are long random strings that match the pattern, and only the exact key matches', () => {
    const k = newAccessKey();
    expect(KEY_PATTERN.test(k)).toBe(true); expect(k.length).toBeGreaterThanOrEqual(24); expect(newAccessKey()).not.toBe(k);
    expect(keyMatches(k, k)).toBe(true); expect(keyMatches(k, k.slice(0, -1) + (k.endsWith('a') ? 'b' : 'a'))).toBe(false);
    expect(keyMatches(k, '')).toBe(false); expect(keyMatches(null, k)).toBe(false); expect(keyMatches(k, k + 'x')).toBe(false);
    expect(REF_PATTERN.test('GYST-20261026-ABC123')).toBe(true); expect(REF_PATTERN.test('GYST-2026-abc')).toBe(false);
  });
});

describe('the confirmation panel', () => {
  beforeEach(() => { Object.assign(navigator, { clipboard: { writeText: vi.fn(() => Promise.resolve()) } }); });
  afterEach(() => cleanup());
  it('shows the simulated notice, the reference, the carrier and price, the shipment, the reason, the checks and the timeline', () => {
    render(<ConfirmationPanel c={make()} />);
    expect(screen.getByText(SIMULATED_NOTICE)).toBeTruthy();
    expect(screen.getByText('Booked. Reference GYST-20261026-ABC123')).toBeTruthy();
    expect(screen.getByText('Carrier A · Road economy')).toBeTruthy();
    expect(screen.getByText('£180 × 3 pallets = £540')).toBeTruthy();
    expect(screen.getByText('Northfield Goods')).toBeTruthy();
    expect(screen.getByText(/10 of 10 checks passed/)).toBeTruthy();
    expect(screen.getByText(/is the cheapest carrier/)).toBeTruthy();
    const steps = screen.getByRole('list', { name: 'Booking status timeline' }).querySelectorAll('li');
    expect([...steps].map(s => s.className)).toEqual(['active', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
    expect(steps[0].getAttribute('aria-current')).toBe('step');
    expect(steps[1].textContent).toMatch(/Estimated/);
    expect(screen.getByRole('button', { name: 'Download booking confirmation (PDF)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Copy link/ })).toBeNull();               // no link without a saved booking
  });
  it('offers a copy-link button when there is a secret link, and warns that anyone with it can open it', async () => {
    render(<ConfirmationPanel c={make()} link="https://x.test/booking/GYST-20261026-ABC123?k=SECRETSECRETSECRETSECRET" />);
    screen.getByRole('button', { name: /Copy link/ }).click();
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://x.test/booking/GYST-20261026-ABC123?k=SECRETSECRETSECRETSECRET'));
    expect(screen.getByText(/Anyone with this link can open the confirmation/)).toBeTruthy();
  });
});

describe('reopening from the link', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  const reply = (status: number, body: any) => vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));
  it('shows the saved confirmation when the server returns it, asking with the reference and the key', async () => {
    const f = reply(200, { confirmation: make() }); vi.stubGlobal('fetch', f);
    render(<BookingView reference="GYST-20261026-ABC123" k="KEYKEYKEYKEYKEYKEYKEYKEY" />);
    expect(await screen.findByText('Booked. Reference GYST-20261026-ABC123')).toBeTruthy();
    expect(String((f.mock.calls as any)[0][0])).toBe('/api/bookings/GYST-20261026-ABC123?k=KEYKEYKEYKEYKEYKEYKEYKEY');
    expect(screen.getByText(SIMULATED_NOTICE)).toBeTruthy();
  });
  it('a wrong or missing link gets a friendly message and shows nothing about the booking', async () => {
    vi.stubGlobal('fetch', reply(404, { error: 'not_found' }));
    render(<BookingView reference="GYST-20261026-ABC123" k="" />);
    expect(await screen.findByText('We couldn’t open that confirmation')).toBeTruthy();
    expect(screen.queryByText(/Northfield/)).toBeNull();
  });
  it('an unavailable service gets a friendly message too', async () => {
    vi.stubGlobal('fetch', reply(502, { error: 'unavailable' }));
    render(<BookingView reference="GYST-20261026-ABC123" k="KEYKEYKEYKEYKEYKEYKEYKEY" />);
    expect(await screen.findByText('Confirmations aren’t available right now')).toBeTruthy();
  });
});
