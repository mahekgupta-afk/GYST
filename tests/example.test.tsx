// @vitest-environment jsdom
// "Try an example": four bookings that go through the real parser and rule engine, never stored or sent.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as XLSX from 'xlsx';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import App from '../components/App';
import { PF } from '../lib/pf';
import { parseExample, exampleTables } from '../lib/example';

const TODAY = '2026-10-26';
const ex = () => parseExample(XLSX, TODAY);
const ev = (id: string) => PF.evaluate(ex().bookings.find((b: any) => b.id === id));
const rules = (id: string) => ev(id).issues.map((i: any) => i.rule);

describe('the example data, read by the real parser and rulebook', () => {
  it('has four bookings and no parse error or warning', () => {
    const r = ex();
    expect(r.error).toBeFalsy();
    expect(r.bookings).toHaveLength(4);
    expect(r.warnings || []).toEqual([]);
  });
  it('(a) is fully clean and ready to book', () => {
    expect(ev('EX-001').status).toBe('clear');
    expect(ev('EX-001').issues).toHaveLength(0);
  });
  it('(b) has only an Amber warning: a warehouse delivery with no appointment', () => {
    const e = ev('EX-002');
    expect(e.status).toBe('warning');
    expect(e.counts.red).toBe(0);
    expect(rules('EX-002')).toEqual(['R-08']);
  });
  it('(c) has several Reds: missing HS code, wrong declared value, carton maths, an aerosol', () => {
    const e = ev('EX-003');
    expect(e.status).toBe('blocked');
    expect(e.counts.red).toBeGreaterThanOrEqual(4);
    for (const r of ['R-01', 'R-02', 'R-03', 'R-06']) expect(rules('EX-003')).toContain(r);
  });
  it('(d) is a heavy load: the cheapest carrier is over its weight limit (R-05 red) and another is recommended', () => {
    const e = ev('EX-004');
    expect(e.status).toBe('blocked');
    expect(e.issues.map((i: any) => i.rule)).toContain('R-05');
    expect(e.rec.preferred.carrier).toBe('Carrier A');
    expect(e.rec.preferred.eligible).toBe(false);
    expect(e.rec.recommended.carrier).toBe('Carrier B');
    expect(e.rec.ruledOutNotes.join(' ')).toContain('Carrier A (cheapest per pallet) was ruled out');
  });
  it('uses dates relative to today: ready dates are today plus 2 to 5 days', () => {
    const days = (iso: string) => PF.diffDays(TODAY, iso);
    expect(ex().bookings.map((b: any) => days(b.readyDate))).toEqual([3, 4, 5, 2]);
    const later = parseExample(XLSX, '2031-03-01');
    expect(later.bookings.map((b: any) => PF.diffDays('2031-03-01', b.readyDate))).toEqual([3, 4, 5, 2]);
    for (const b of later.bookings) expect(PF.evaluate(b).issues.map((i: any) => i.rule)).not.toContain('R-10');
  });
  it('the results are not stored in the data: the tables hold only inputs', () => {
    const t = exampleTables(TODAY);
    expect(JSON.stringify(t)).not.toMatch(/Ready to book|clear|blocked|Carrier/);
  });
});

describe('in the app', () => {
  let fetchMock: any;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-26T12:00:00'));
    Element.prototype.scrollIntoView = vi.fn(); window.scrollTo = vi.fn() as any;
    fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ enabled: false }), { status: 200, headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const nav = () => screen.getByRole('navigation', { name: 'App' });

  it('Try an example shows the banner and four bookings, one of each kind plus the heavy load, and Clear example removes it', async () => {
    render(<App />);
    fireEvent.click(within(nav()).getByRole('button', { name: 'Try an example' }));
    await waitFor(() => expect(screen.getByText(/Example data, not your file/)).toBeTruthy());
    expect(screen.getByRole('tab', { name: 'Upload a file' }).getAttribute('aria-selected')).toBe('true');
    expect(within(nav()).getByRole('button', { name: 'Try an example' }).getAttribute('aria-current')).toBe('true');
    const tile = (n: RegExp) => screen.getByRole('button', { name: n }).textContent;
    expect(tile(/all bookings/)).toContain('4');
    expect(tile(/red: need fixing/)).toContain('2');
    expect(tile(/amber: ready/)).toContain('1');
    expect(tile(/green: clear/)).toContain('1');
    for (const id of ['EX-001', 'EX-002', 'EX-003', 'EX-004']) expect(screen.getByRole('link', { name: 'Open ' + id })).toBeTruthy();
    expect(within(screen.getByRole('link', { name: 'Open EX-004' })).getByText(/Carrier B/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear example' }));
    expect(screen.queryByText(/Example data, not your file/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open EX-001' })).toBeNull();
    expect(screen.getByText('Check your bookings')).toBeTruthy();
  });

  it('nothing is stored or sent, and booking is off', async () => {
    render(<App />);
    fireEvent.click(within(nav()).getByRole('button', { name: 'Try an example' }));
    await waitFor(() => expect(screen.getByText(/Example data, not your file/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /Booking is off for the example/ }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'Open EX-001' }));
    const offs = screen.getAllByRole('button', { name: /Example only: booking is off/ });
    expect(offs.length).toBeGreaterThan(0);
    for (const b of offs) expect(b.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Clear example' }));
    const urls = fetchMock.mock.calls.map((c: any[]) => String(c[0]));
    expect(urls.filter((u: string) => !u.includes('/api/parse-message'))).toEqual([]);
  });

  it('New booking clears the example too', async () => {
    render(<App />);
    fireEvent.click(within(nav()).getByRole('button', { name: 'Try an example' }));
    await waitFor(() => expect(screen.getByText(/Example data, not your file/)).toBeTruthy());
    fireEvent.click(within(nav()).getByRole('button', { name: 'New booking' }));
    expect(screen.queryByText(/Example data, not your file/)).toBeNull();
  });
});
