// @vitest-environment jsdom
// Carrier options: the rate card, the comparison tool, and that it uses the very same recommendation as the booking flow.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import App from '../components/App';
import CarrierOptions from '../components/CarrierOptions';
import { PF } from '../lib/pf';
import { compare, DEST_LIST, PRIORITY_LIST } from '../lib/compare';

afterEach(() => cleanup());

const set = (label: RegExp | string, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
const fill = (dest: string, pallets: string, weight: string, priority: string) => {
  set('Destination country', dest); set('Pallets', pallets); set(/Total gross weight/, weight); set('Seller priority', priority);
};
const row = (carrier: string) => within(screen.getAllByRole('table')[1]).getByText(carrier, { selector: 'b' }).closest('tr') as HTMLElement;   // table 0 is the rate card
const text = (e: HTMLElement) => (e.textContent || '').replace(/\s+/g, ' ');

describe('rate card', () => {
  it('shows every carrier, service, route, price, days, on-time and weight limit, straight from the engine data', () => {
    render(<CarrierOptions onUse={() => {}} />);
    const first = screen.getAllByRole('table')[0];
    const body = within(first).getAllByRole('row').slice(1);
    expect(body).toHaveLength(PF.CARRIERS.length);
    PF.CARRIERS.forEach((c: any, i: number) => {
      const t = text(body[i]);
      for (const part of [c.carrier, c.service, 'UK to ' + c.dest, String(c.price), String(c.transit), c.ontime + '%', String(c.maxKg)]) expect(t).toContain(part);
    });
    expect(new Set(PF.CARRIERS.map((c: any) => c.dest))).toEqual(new Set(['Germany', 'France', 'Netherlands']));
  });
  it('is not a second copy of the data: the component has no rate figures of its own', () => {
    for (const f of ['components/CarrierOptions.tsx', 'lib/compare.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/Road economy|Road express|maxKg:\s*\d/);
    }
  });
});

describe('compare carriers', () => {
  it('Germany, 2 pallets, 1,500 kg, Cheapest: Carrier B £440; A over by 250 kg (3 pallets, £540); C over by 350 kg (4 pallets, £1,360)', () => {
    render(<CarrierOptions onUse={() => {}} />);
    fill('Germany', '2', '1500', 'Cheapest');
    expect(text(row('Carrier B'))).toContain('Recommended');
    expect(text(row('Carrier B'))).toContain('£440');
    expect(text(row('Carrier B'))).toContain('Fits, 0 kg spare');
    expect(text(row('Carrier A'))).toContain('Over by 250 kg');
    expect(text(row('Carrier A'))).toContain('3 pallets would fit, at £540');
    expect(text(row('Carrier C'))).toContain('Over by 350 kg');
    expect(text(row('Carrier C'))).toContain('4 pallets would fit, at £1,360');
    expect(text(row('Carrier A'))).not.toContain('Recommended');
    expect(screen.getByText(/Lowest total price/)).toBeTruthy();
  });
  it('Germany, 4 pallets, 1,500 kg, Balanced: all fit, scores B 0.65, C 0.60, A 0.40, B is recommended', () => {
    render(<CarrierOptions onUse={() => {}} />);
    fill('Germany', '4', '1500', 'Balanced');
    for (const c of ['Carrier A', 'Carrier B', 'Carrier C']) expect(text(row(c))).toMatch(/Fits, \d+ kg spare/);
    expect(text(row('Carrier B'))).toContain('Recommended');
    expect(screen.getByText(/Balanced scores/).textContent).toContain('B 0.65, C 0.60, A 0.40');
  });
  it('shows the winner for every priority', () => {
    render(<CarrierOptions onUse={() => {}} />);
    fill('Germany', '4', '1500', 'Cheapest');
    const w = text(screen.getByText('Winner by priority').parentElement as HTMLElement);
    expect(w).toContain('Cheapest Carrier A');
    expect(w).toContain('Fastest Carrier C');
    expect(w).toContain('Most reliable Carrier C');
    expect(w).toContain('Balanced Carrier B');
  });
  it('France, 4 pallets, 4,000 kg: none fit; B needs 6 pallets (£1,260), A 8 (£1,360), C 10 (£3,300)', () => {
    render(<CarrierOptions onUse={() => {}} />);
    fill('France', '4', '4000', 'Cheapest');
    expect(screen.getByText(/No carrier on this route can take 1,000 kg per pallet/)).toBeTruthy();
    expect(text(row('Carrier B'))).toContain('6 pallets would fit, at £1,260');
    expect(text(row('Carrier A'))).toContain('8 pallets would fit, at £1,360');
    expect(text(row('Carrier C'))).toContain('10 pallets would fit, at £3,300');
    expect(screen.queryByText('Recommended')).toBeNull();
    expect(screen.queryByText('Winner by priority')).toBeNull();
  });
  it.each([
    ['0', '500', /Pallets is 0\. Enter a whole number greater than 0\./],
    ['-2', '500', /Pallets is -2\. Enter a whole number greater than 0\./],
    ['2.5', '500', /Pallets is 2\.5, but it must be a whole number\. Enter a whole number greater than 0\./],
    ['2', '0', /Total gross weight is 0\. Enter a number greater than 0\./],
    ['2', '-30', /Total gross weight is -30\. Enter a number greater than 0\./],
    ['abc', '500', /Pallets is “abc”, which isn’t a number\./],
  ])('rejects pallets %s / weight %s with the standard message and shows no numbers', (p, w, msg) => {
    const { container } = render(<CarrierOptions onUse={() => {}} />);
    fill('Germany', p, w, 'Cheapest');
    expect(screen.getByRole('alert').textContent).toMatch(msg);
    expect(screen.queryByText('Use these details in a booking')).toBeNull();
    expect(screen.queryByText('Recommended')).toBeNull();
    expect(container.textContent).not.toMatch(/NaN|Infinity|undefined/);
  });
  it('says nothing is wrong, and shows no result, while the fields are still blank', () => {
    const { container } = render(<CarrierOptions onUse={() => {}} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.textContent).toContain('Enter pallets and total gross weight');
  });
  it('the fields carry the same wording as the booking validators', () => {
    expect(compare({ dest: 'Germany', pallets: '0', weight: '500', priority: 'Cheapest' }).errors.pallets).toBe('Pallets is 0. Enter a whole number greater than 0.');
  });
});

describe('one source of truth', () => {
  it('the tool and the booking flow recommend the same carrier at the same price for every country and priority', () => {
    const loads: [number, number][] = [[1, 300], [2, 1500], [4, 1500], [3, 2100], [2, 800], [6, 2400], [4, 4000]];
    let checked = 0;
    for (const dest of DEST_LIST) for (const priority of PRIORITY_LIST) for (const [pallets, weight] of loads) {
      const tool = compare({ dest, pallets: String(pallets), weight: String(weight), priority }).comparison!;
      const rec = PF.evaluate({ id: 'T', seller: 's', originCity: 'London', destCity: 'X', destCountry: dest, destType: 'Business address', readyDate: '2031-01-01', priority, pallets, cartons: 1, declaredValue: 1, grossWeight: weight, appointment: 'Yes',
        items: [{ sku: 'A', desc: 'Mug', hs: '691200', qty: 1, price: 1, upc: 1, cartons: 1, unitWeight: 0.1, coo: 'China' }] }).rec;
      expect(tool.winner?.carrier ?? null, `${dest} ${priority} ${pallets}p ${weight}kg`).toBe(rec.recommended ? rec.recommended.carrier : null);
      if (rec.recommended) expect(tool.winner!.total).toBe(rec.recommended.price * pallets);
      checked++;
    }
    expect(checked).toBe(3 * 4 * 7);
  });
  it('the tool does not rank carriers itself', () => {
    expect(readFileSync('lib/compare.ts', 'utf8')).toMatch(/PF\.recommend\(/);
    expect(readFileSync('lib/compare.ts', 'utf8')).not.toMatch(/\.sort\(\(a, b\) => a\.(price|transit|ontime)/);
  });
});

describe('in the app', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn(); window.scrollTo = vi.fn() as any;
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ enabled: false }), { status: 200, headers: { 'content-type': 'application/json' } }))));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Carrier options in the header scrolls to the section and focuses its first field', () => {
    render(<App />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'App' })).getByRole('button', { name: 'Carrier options' }));
    expect(document.activeElement).toBe(document.getElementById('co-dest'));
    expect((Element.prototype.scrollIntoView as any).mock.contexts.at(-1).id).toBe('carriers');
  });
  it('the section sits between the app and the Rulebook', () => {
    render(<App />);
    const order = ['start', 'carriers', 'rulebook'].map(id => document.getElementById(id)!);
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('"Use these details in a booking" starts a chat booking with country, pallets, weight and priority, and the chat asks for the rest', async () => {
    render(<App />);
    fill('Germany', '4', '1500', 'Fastest');
    fireEvent.click(screen.getByRole('button', { name: 'Use these details in a booking' }));
    await waitFor(() => expect(document.querySelectorAll('.msg').length).toBe(3));
    const log = document.querySelector('.log')!.textContent!;
    expect(log).toContain('4 pallets weighing 1500 kg to Germany. Priority Fastest.');
    const card = document.querySelector('.right')!.textContent!;
    expect(card).toContain('Germany');
    expect(card).toContain('Fastest');
    expect(card).toContain('Pallets4');
    expect(card).toContain('1,500 kg');
    expect(screen.getByRole('tab', { name: 'Chat to book' }).getAttribute('aria-selected')).toBe('true');
    expect(document.querySelectorAll('.msg.bot').length).toBe(2);        // the greeting and a question for what is missing
  });
});
