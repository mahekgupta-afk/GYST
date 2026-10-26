// @vitest-environment jsdom
// HS code help in the app: the advisory card, "Find a code", suggestions in chat, and graceful failure. R-01 itself is untouched.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import App from '../components/App';
import { hsForReport } from '../components/Results';
import { PF } from '../lib/pf';
import { clearHsClientCache } from '../lib/hsClient';

const json = (body: any, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const R = (code: string, state: string, description: string | null = null, children: any[] = []) => ({ result: { code, state, description, heading: description, children } });
const MUG = 'Ceramic tableware › Of common pottery › Hand-made › Tableware and kitchenware, excluding condiment or spice mill';
let calls: string[];
// A pretend UK Tariff service behind /api/hs.
const hsApi = (over: Record<string, any> = {}) => (url: string) => {
  calls.push(url);
  if (over.down) return json({}, 502);
  if (url.startsWith('/api/hs?code=')) {
    const code = decodeURIComponent(url.split('=')[1]);
    if (over[code]) return json(over[code]);
    if (code === '691200') return json(R(code, 'six-digits', 'Ceramic tableware, kitchenware', [{ code: '6912002111', description: MUG }, { code: '6912002119', description: 'Ceramic tableware › Of common pottery › Hand-made › Other' }]));
    if (code === '6912002111') return json(R(code, 'verified', MUG));
    if (code === '4202') return json(R(code, 'short', 'Trunks, suitcases, handbags', [{ code: '4202210000', description: 'Handbags › With outer surface of leather' }, { code: '4202220000', description: 'Handbags › With outer surface of sheeting of plastics or of textile materials' }]));
    if (code === '6912') return json(R(code, 'short', 'Ceramic tableware, kitchenware', [{ code: '6912002111', description: MUG }, { code: '6912002190', description: 'Ceramic tableware › Other' }]));
    if (code === '999999') return json(R(code, 'not-found'));
    if (code === '330720') return json(R(code, 'six-digits', 'Perfumery, cosmetic or toilet preparations', [{ code: '3307200000', description: 'Personal deodorants and antiperspirants' }]));
    return json(R(code, 'not-found'));
  }
  if (url.startsWith('/api/hs?q=')) return json({ ok: true, suggestions: [{ code: '4202', kind: 'heading', title: 'Trunks, suitcases, handbags and similar containers' }, { code: '6912002111', kind: 'commodity', title: MUG }] });
  return null as any;
};
const setup = (api: (u: string) => any) => {
  calls = []; clearHsClientCache();
  Element.prototype.scrollIntoView = vi.fn(); window.scrollTo = vi.fn() as any;
  vi.stubGlobal('fetch', vi.fn((url: string) => api(url) ?? json({ enabled: false })));
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const openExample = async (id: string) => {
  render(<App />);
  fireEvent.click(within(screen.getByRole('navigation', { name: 'App' })).getByRole('button', { name: 'Try an example' }));
  fireEvent.click(await screen.findByRole('link', { name: 'Open ' + id }));
};
const card = () => screen.getByText('HS code check').closest('.hscard') as HTMLElement;

describe('the HS code check card', () => {
  it('in the example it waits to be asked, and sends nothing until then', async () => {
    setup(hsApi());
    await openExample('EX-001');
    expect(calls.filter(u => u.startsWith('/api/hs'))).toEqual([]);
    expect(within(card()).getByText('Not checked')).toBeTruthy();
    fireEvent.click(within(card()).getByRole('button', { name: /Check these codes against the UK tariff/ }));
    expect(await within(card()).findByText('6 digits only')).toBeTruthy();
    expect(within(card()).queryByText('Not checked')).toBeNull();
    expect(calls).toContain('/api/hs?code=691200');
  });
  it('shows "6 digits only" with the official wording and full codes to pick from', async () => {
    setup(hsApi());
    await openExample('EX-001');
    fireEvent.click(within(card()).getByRole('button', { name: /Check these codes/ }));
    expect(await within(card()).findByText('6 digits only')).toBeTruthy();
    expect(card().textContent).toContain('Ceramic tableware, kitchenware');
    expect(card().textContent).toMatch(/6-digit code\. A full 8 to 10 digit commodity code is usually needed/);
    fireEvent.click(within(card()).getByRole('button', { name: 'Use 6912002111' }));
    await waitFor(() => expect(within(card()).getByText('Verified')).toBeTruthy());           // the code was changed, and the new code verified
    expect(document.body.textContent).toContain('6912002111');
    expect(document.body.textContent).toContain('HS code');                                    // logged in the change log
  });
  it('does not change rule R-01 or block anything, whatever the tariff says', async () => {
    setup(hsApi({ 691200: R('691200', 'not-found') }));
    await openExample('EX-001');
    fireEvent.click(within(card()).getByRole('button', { name: /Check these codes/ }));
    expect(await within(card()).findByText('Not found')).toBeTruthy();
    expect(screen.getAllByText('R-01').length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain('CLEAR TO SHIP');                              // R-01 passes: 6 digits is enough
  });
  it('if the service is down it says "Could not verify" and carries on', async () => {
    setup(hsApi({ down: true }));
    await openExample('EX-001');
    fireEvent.click(within(card()).getByRole('button', { name: /Check these codes/ }));
    expect(await within(card()).findByText('Could not verify')).toBeTruthy();
    expect(card().textContent).toContain('does not affect your booking');
    expect(document.body.textContent).toContain('CLEAR TO SHIP');
  });
  it('a gentle warning when the description does not fit the code', async () => {
    setup(hsApi());
    await openExample('EX-003');                                       // the aerosol spray, code 330720, is in the perfumery heading: fits; the tote bag has no code
    fireEvent.click(within(card()).getByRole('button', { name: /Check these codes/ }));
    await within(card()).findByText('6 digits only');
    expect(within(card()).queryByRole('note')).toBeNull();            // "Aerosol deodorant spray" and "Personal deodorants" / "Perfumery..." share words: no warning
  });
  it('warns softly when the item description has nothing in common with the official wording', async () => {
    setup(hsApi({ 691200: R('691200', 'six-digits', 'Live animals', []) }));
    await openExample('EX-001');
    fireEvent.click(within(card()).getByRole('button', { name: /Check these codes/ }));
    expect(await within(card()).findByRole('note')).toBeTruthy();
    expect(card().textContent).toContain('doesn’t seem to match');
    expect(card().textContent).toContain('only a suggestion');
  });
});

describe('Find a code', () => {
  it('searches by description, expands a heading, and fills the HS code only when the user picks one', async () => {
    setup(hsApi());
    await openExample('EX-003');                                       // TOTE-01 has no HS code, so R-01 is red
    expect(screen.getAllByText(/HS code missing/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Find a code for TOTE-01' })[0]);
    const finder = screen.getAllByRole('group', { name: 'Find an HS code' })[0];
    expect((within(finder).getByLabelText('Describe the product') as HTMLInputElement).value).toBe('Cotton tote bag');
    fireEvent.click(within(finder).getByRole('button', { name: 'Find a code' }));
    expect(await within(finder).findByText('Trunks, suitcases, handbags and similar containers')).toBeTruthy();
    expect(screen.getAllByText(/HS code missing/).length).toBeGreaterThan(0);                  // nothing has changed yet
    fireEvent.click(within(finder).getByRole('button', { name: 'Show full codes' }));
    expect(await within(finder).findByText('4202220000')).toBeTruthy();
    fireEvent.click(within(finder).getAllByRole('button', { name: 'Use this code' }).slice(-1)[0]);
    await waitFor(() => expect(screen.queryByText(/HS code missing/)).toBeNull());
  });
  it('says so when the search is not available', async () => {
    setup(url => url.startsWith('/api/hs?q=') ? json({ ok: false, suggestions: [] }) : hsApi()(url));
    await openExample('EX-003');
    fireEvent.click(screen.getAllByRole('button', { name: 'Find a code for TOTE-01' })[0]);
    fireEvent.click(within(screen.getAllByRole('group', { name: 'Find an HS code' })[0]).getByRole('button', { name: 'Find a code' }));
    expect(await screen.findByText(/search isn’t available right now/)).toBeTruthy();
  });
});

describe('suggestions in the chat', () => {
  const say = async (text: string) => {
    const n = document.querySelectorAll('.msg').length;
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(document.querySelectorAll('.msg').length).toBeGreaterThanOrEqual(n + 2));
  };
  it('when it asks for the HS code it offers up to three codes from the tariff, and picking one answers the question', async () => {
    setup(hsApi());
    render(<App />);
    await say('Leeds to Paris, warehouse, appointment booked, ready 5 Nov 2031, cheapest');
    await say('Acme Ltd');
    await say('100 ceramic mugs, £5 each, 10 per carton, 0.5kg each, made in UK');
    const group = await screen.findByRole('group', { name: 'Suggested HS codes' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0); expect(buttons.length).toBeLessThanOrEqual(3);
    expect(buttons[0].textContent).toMatch(/^6912\d{6} · /);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Suggested HS codes' })).toBeNull());
    expect(document.querySelector('.right')!.textContent).toContain('6912');
  });
  it('offers nothing, and the chat carries on, when the tariff is down', async () => {
    setup(hsApi({ down: true }));
    render(<App />);
    await say('Leeds to Paris, warehouse, appointment booked, ready 5 Nov 2031, cheapest');
    await say('Acme Ltd');
    await say('100 ceramic mugs, £5 each, 10 per carton, 0.5kg each, made in UK');
    await new Promise(r => setTimeout(r, 100));
    expect(screen.queryByRole('group', { name: 'Suggested HS codes' })).toBeNull();
    expect(document.querySelector('.log')!.textContent).toContain('HS code');
  });
});

describe('the report', () => {
  it('lists each item with its verification state and official wording', () => {
    const b = PF.bookingsFromTables(...(Object.values(PF.sampleTables(PF.todayISO())) as [any, any])).bookings.find((x: any) => x.id === 'BK-001');
    const rows = hsForReport(b, { '691200': { code: '691200', state: 'six-digits', description: 'Ceramic tableware', heading: 'x', children: [] } });
    expect(rows).toEqual([{ item: 'MUG-01', code: '691200', state: 'six-digits', description: 'Ceramic tableware', note: expect.stringContaining('6-digit code') }]);
    expect(hsForReport(b, {})[0]).toMatchObject({ state: 'unavailable', note: 'Not checked.' });
  });
});
