// @vitest-environment jsdom
// Booking through the app shows the confirmation panel, with a secret link only when the booking was really saved.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as XLSX from 'xlsx';
import React from 'react';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import App from '../components/App';
import { PF } from '../lib/pf';
import { buildConfirmation } from '../lib/confirmation';

const json = (body: any, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const row = PF.BH.map((h: string) => ({ 'Booking ID': 'BK-001', 'Seller name': 'Northfield Goods', 'Origin city': 'Manchester', 'Origin country': 'United Kingdom', 'Destination city': 'Frankfurt', 'Destination country': 'Germany', 'Destination type': 'Business address',
  'Ready to ship date': '05-11-2030', 'Seller priority': 'Cheapest', Pallets: 3, Cartons: 90, 'Total declared value': 5400, Currency: 'GBP', 'Total gross weight (kg)': 620, 'Delivery appointment booked': 'Yes' } as any)[h]);
const item = PF.IH.map((h: string) => ({ 'Booking ID': 'BK-001', SKU: 'MUG-01', Description: 'Ceramic mug', 'HS code': '691200', 'Quantity (units)': 1080, 'Unit price': 5, 'Units per carton': 12, Cartons: 90, 'Unit weight (kg)': 0.5, 'Country of origin': 'United Kingdom' } as any)[h]);
const file = () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([PF.BH, row]), 'Bookings');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([PF.IH, item]), 'Items');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const f = new File([bytes], 'one.xlsx'); Object.defineProperty(f, 'arrayBuffer', { value: async () => bytes }); return f;
};

const open = async (bookingsReply: (body: any) => Promise<Response>) => {
  vi.stubGlobal('fetch', vi.fn((url: string, init?: any) => {
    if (url === '/api/bookings') return bookingsReply(JSON.parse(init.body));
    if (url === '/api/uploads') return json({ saved: false }, 503);
    return json({ enabled: false });
  }));
  Element.prototype.scrollIntoView = vi.fn(); window.scrollTo = vi.fn() as any;
  render(<App />);
  fireEvent.click(screen.getByRole('tab', { name: 'Upload a file' }));
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file()], configurable: true });
  await act(async () => { fireEvent.change(input); });
  fireEvent.click(await screen.findByRole('link', { name: 'Open BK-001' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Book shipment' })[0]);
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('booking in the app', () => {
  it('shows the stored confirmation, the simulated notice and a copyable secret link', async () => {
    await open(body => {
      const ev = PF.evaluate(body.booking);
      return json({ ok: true, saved: true, reference: 'GYST-20261026-ABC123', accessKey: 'SECRETKEYSECRETKEYSECRET1', confirmation: buildConfirmation(body.booking, ev, { reference: 'GYST-20261026-ABC123', bookedAt: '2026-10-26T10:00:00Z' }) });
    });
    expect(await screen.findByText('Booked. Reference GYST-20261026-ABC123')).toBeTruthy();
    expect(screen.getByText('Simulated confirmation: not yet transmitted to the carrier.')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Booking status timeline' }).querySelectorAll('li.active')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Download booking confirmation (PDF)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copy link to this confirmation/ })).toBeTruthy();
    expect(document.body.textContent).toContain('/booking/GYST-20261026-ABC123?k=SECRETKEYSECRETKEYSECRET1');
  });
  it('builds the same confirmation here when the server did not send one, with no link', async () => {
    await open(() => json({ ok: true, saved: true, reference: 'GYST-20261026-ABC123' }));
    expect(await screen.findByText('Booked. Reference GYST-20261026-ABC123')).toBeTruthy();
    expect(screen.getByText('£180 × 3 pallets = £540')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Copy link/ })).toBeNull();
  });
  it('a booking that was checked but not saved says so and has no link', async () => {
    await open(() => json({ ok: true, saved: false, reference: 'GYST-20261026-ABC123', accessKey: 'SHOULDNOTSHOWSHOULDNOT1' }));
    expect(await screen.findByText('Booked. Reference GYST-20261026-ABC123')).toBeTruthy();
    expect(screen.getByText(/could not be saved to the booking log, so it has no link/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Copy link/ })).toBeNull();
    expect(document.body.textContent).not.toContain('SHOULDNOTSHOW');
  });
});
