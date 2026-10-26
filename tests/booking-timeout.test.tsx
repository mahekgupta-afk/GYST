// @vitest-environment jsdom
// A booking request that never answers must not leave "Booking…" on screen forever, must not be sent twice,
// and a retry must be safe. Clock is faked so the 15 second limit runs instantly.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as XLSX from 'xlsx';
import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import App from '../components/App';
import { PF } from '../lib/pf';
import { bookShipment, idempotencyKeyFor, TOO_SLOW } from '../lib/bookingClient';
import { fetchJson, TimeoutError } from '../lib/net';

const hang = () => new Promise<Response>(() => {});                       // a request that never answers and ignores abort
const json = (body: any, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

const book = (id: string, over: any = {}) => {
  const b: any = { 'Booking ID': id, 'Seller name': 'Northfield Goods', 'Origin city': 'Manchester', 'Origin country': 'United Kingdom', 'Destination city': 'Frankfurt', 'Destination country': 'Germany', 'Destination type': 'Business address',
    'Ready to ship date': '05-11-2026', 'Seller priority': 'Cheapest', Pallets: 3, Cartons: 90, 'Total declared value': 5400, Currency: 'GBP', 'Total gross weight (kg)': 620, 'Delivery appointment booked': 'Yes', ...over };
  return PF.BH.map((h: string) => b[h]);
};
const itm = (id: string) => PF.IH.map((h: string) => ({ 'Booking ID': id, SKU: 'MUG-01', Description: 'Ceramic mug', 'HS code': '691200', 'Quantity (units)': 1080, 'Unit price': 5, 'Units per carton': 12, Cartons: 90, 'Unit weight (kg)': 0.5, 'Country of origin': 'United Kingdom' } as any)[h]);
const xlsxFile = () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([PF.BH, book('BK-001')]), 'Bookings');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([PF.IH, itm('BK-001')]), 'Items');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const f = new File([bytes], 'one.xlsx');
  Object.defineProperty(f, 'arrayBuffer', { value: async () => bytes });  // jsdom's File has no arrayBuffer()
  return f;
};
const booking = () => ({ id: 'T-1', seller: 'Acme', originCity: 'Leeds', destCity: 'Paris', destCountry: 'France', destType: 'Business address', readyDate: '2030-01-01', priority: 'Cheapest',
  pallets: 2, cartons: 10, declaredValue: 100, grossWeight: 300, appointment: 'Yes', items: [{ sku: 'A', desc: 'Mug', hs: '691200', qty: 100, price: 1, upc: 10, cartons: 10, unitWeight: 0.1, coo: 'China' }] });

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); vi.setSystemTime(new Date('2026-10-26T12:00:00')); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('fetchJson: a 15 second limit that also catches requests that ignore abort', () => {
  it('rejects with TimeoutError after 15 s and not before', async () => {
    vi.stubGlobal('fetch', vi.fn(hang));
    let outcome = 'pending';
    const p = fetchJson('/x').then(() => { outcome = 'ok'; }, e => { outcome = e instanceof TimeoutError ? 'timeout' : 'other'; });
    await vi.advanceTimersByTimeAsync(14999);
    expect(outcome).toBe('pending');
    await vi.advanceTimersByTimeAsync(2);
    await p;
    expect(outcome).toBe('timeout');
  });
  it('also times out when the headers arrive but the body never finishes', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) } as any)));
    let outcome = 'pending';
    const p = fetchJson('/x').catch(e => { outcome = e instanceof TimeoutError ? 'timeout' : 'other'; });
    await vi.advanceTimersByTimeAsync(15001);
    await p;
    expect(outcome).toBe('timeout');
  });
});

describe('bookShipment', () => {
  it('a hanging booking request returns the "too long" message after 15 s and keeps the booking data', async () => {
    vi.stubGlobal('fetch', vi.fn(hang));
    const b: any = booking(); const before = JSON.stringify(b, (k, v) => (k.startsWith('_') ? undefined : v));
    const p = bookShipment(b, 'chat');
    await vi.advanceTimersByTimeAsync(15001);
    const r: any = await p;
    expect(r.ok).toBe(false);
    expect(r.message).toBe('That took too long. Nothing has been booked. Please try again.');
    expect(r.message).toBe(TOO_SLOW);
    expect(b._ref).toBeUndefined();
    expect(JSON.stringify(b, (k, v) => (k.startsWith('_') ? undefined : v))).toBe(before);
  });
  it('a network error or a server error gives the same message', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    expect(((await bookShipment(booking(), 'chat')) as any).message).toBe(TOO_SLOW);
    vi.stubGlobal('fetch', vi.fn(() => json({ ok: false, error: 'db_error' }, 502)));
    expect(((await bookShipment(booking(), 'chat')) as any).message).toBe(TOO_SLOW);
  });
  it('refusals keep their own specific messages', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ ok: false, error: 'blocked', problems: ['Declared value doesn’t match the items'] }, 422)));
    expect(((await bookShipment(booking(), 'chat')) as any).message).toMatch(/still has problems.*Declared value/);
  });
  it('a retry of the same booking sends the same key; changing the booking sends a new one', async () => {
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn((_u: string, init: any) => { calls.push(JSON.parse(init.body)); return Promise.reject(new TypeError('x')); }));
    const b: any = booking();
    await bookShipment(b, 'chat'); await bookShipment(b, 'chat');
    expect(calls[0].key).toBeTruthy();
    expect(calls[1].key).toBe(calls[0].key);
    b.pallets = 3;
    await bookShipment(b, 'chat');
    expect(calls[2].key).not.toBe(calls[0].key);
    expect(idempotencyKeyFor(b)).toBe(calls[2].key);
  });
});

describe('the app: Book shipment with a request that never answers', () => {
  const setup = async (bookingsFetch: () => Promise<Response>) => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: any) => {
      calls.push((init?.method || 'GET') + ' ' + url);
      if (url === '/api/bookings') return bookingsFetch();
      if (url === '/api/parse-message') return json({ enabled: false });
      if (url === '/api/uploads') return json({ saved: false }, 503);
      return json({});
    }));
    window.scrollTo = (() => {}) as any;
    render(<App />);
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    fireEvent.click(screen.getByRole('tab', { name: 'Upload a file' }));
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [xlsxFile()], configurable: true });
    await act(async () => { fireEvent.change(input); await vi.advanceTimersByTimeAsync(300); });
    await until(() => screen.queryByRole('link', { name: 'Open BK-001' }));
    fireEvent.click(screen.getByRole('link', { name: 'Open BK-001' }));
    return calls;
  };
  // Steps the faked clock and lets real async work (the dynamic import of xlsx, file reading) finish between steps.
  const until = async (fn: () => unknown) => {
    for (let i = 0; i < 100 && !fn(); i++) await act(async () => { await vi.advanceTimersByTimeAsync(20); await new Promise(r => setImmediate(r)); });
    expect(fn()).toBeTruthy();
  };
  const bookButtons = () => screen.getAllByRole('button').filter(b => /^(Book shipment|Booking…)$/.test(b.textContent || ''));

  it('shows "Booking…" while waiting, then after 15 s shows the message and re-enables the button, with the booking intact', async () => {
    const calls = await setup(hang);
    expect(bookButtons().length).toBeGreaterThan(0);
    expect(bookButtons().every(b => (b as HTMLButtonElement).disabled === false)).toBe(true);

    await act(async () => { fireEvent.click(bookButtons()[0]); await vi.advanceTimersByTimeAsync(10); });
    expect(bookButtons().every(b => b.textContent === 'Booking…' && (b as HTMLButtonElement).disabled)).toBe(true);   // in flight: disabled

    await act(async () => { await vi.advanceTimersByTimeAsync(14000); });
    expect(bookButtons().every(b => b.textContent === 'Booking…')).toBe(true);                                         // still waiting at 14 s

    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByRole('alert').textContent).toBe('That took too long. Nothing has been booked. Please try again.');
    expect(bookButtons().length).toBeGreaterThan(0);
    expect(bookButtons().every(b => b.textContent === 'Book shipment' && !(b as HTMLButtonElement).disabled)).toBe(true);   // re-enabled
    expect(screen.queryByText(/Booked\. Reference/)).toBeNull();                                                        // nothing was booked
    expect(document.body.textContent).toMatch(/BK-001 for Northfield Goods/);                                           // the booking is still there
    expect(calls.filter(c => c === 'POST /api/bookings')).toHaveLength(1);
  });

  it('a second click while the request is in flight does not send a second request', async () => {
    const calls = await setup(hang);
    await act(async () => { fireEvent.click(bookButtons()[0]); fireEvent.click(bookButtons()[0]); await vi.advanceTimersByTimeAsync(10); });
    await act(async () => { fireEvent.click(bookButtons()[0] || document.body); await vi.advanceTimersByTimeAsync(10); });
    expect(calls.filter(c => c === 'POST /api/bookings')).toHaveLength(1);
  });

  it('after a timeout the seller can click again and the retry succeeds with the same key', async () => {
    const keys: string[] = [];
    let n = 0;
    const calls = await setup(() => { n++; return n === 1 ? hang() : json({ ok: true, saved: true, reference: 'GYST-20261026-ABC123' }); });
    const origFetch = (globalThis.fetch as any);
    vi.stubGlobal('fetch', vi.fn((url: string, init?: any) => { if (url === '/api/bookings') keys.push(JSON.parse(init.body).key); return origFetch(url, init); }));
    await act(async () => { fireEvent.click(bookButtons()[0]); await vi.advanceTimersByTimeAsync(15500); });
    expect(screen.getByRole('alert').textContent).toMatch(/took too long/);
    await act(async () => { fireEvent.click(bookButtons()[0]); await vi.advanceTimersByTimeAsync(50); });
    expect(document.body.textContent).toMatch(/Booked\. Reference GYST-20261026-ABC123/);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    void calls;
  });
});
