// @vitest-environment jsdom
// When several details are missing, the bot lists them as a short numbered list in red, not one long sentence.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import App from '../components/App';
import { C } from '../lib/pf';

const css = readFileSync('app/globals.css', 'utf8');
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); window.scrollTo = vi.fn() as any; vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"enabled":false}', { status: 200 })))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const say = async (text: string) => {
  const n = document.querySelectorAll('.msg').length;
  fireEvent.change(screen.getByLabelText('Your message'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(document.querySelectorAll('.msg').length).toBe(n + 2));
};
const lastBot = () => [...document.querySelectorAll('.msg.bot')].at(-1) as HTMLElement;

describe('the asks carry a list of what is needed', () => {
  it('several booking details missing: one entry per detail, capitalised', () => {
    const c = C.newChat(); C.step(c, 'hello', {});
    expect(c.asked.key).toBe('basics');
    expect(c.asked.needs.length).toBeGreaterThanOrEqual(2);
    expect(c.asked.needs.every((t: string) => /^[A-Z]/.test(t))).toBe(true);
    expect(c.asked.example).toMatch(/Acme Ltd/);
    expect(c.asked.q).toContain('I still need');                                  // the original sentence is still there for anything that uses it
  });
  it('a single missing detail is a plain question, not a list', () => {
    const c = C.newChat(); C.step(c, 'Leeds to Paris, warehouse, appointment booked, ready 5 Nov 2031, cheapest', {});
    expect(c.asked.key).toBe('seller'); expect(c.asked.needs).toBeUndefined();
  });
});

describe('the confirmation line', () => {
  it('names a destination country in words, not as a field name', () => {
    const log: any = { set: [{ field: 'destCountry', label: 'destCountry', to: 'Netherlands', item: null }], changed: [], notes: [] };
    expect(C.ackText(log)).toBe('Got it: delivering to Netherlands.');
  });
});

describe('in the chat', () => {
  it('shows the missing details as a red numbered list with a short example', async () => {
    render(<App />);
    await say('I want to ship 100 lamps to Netherlands');
    const bot = lastBot();
    const list = bot.querySelector('ol.needs')!;
    expect(list).toBeTruthy();
    expect(list.getAttribute('aria-label')).toBe('Details I still need');
    expect(list.querySelectorAll('li').length).toBeGreaterThanOrEqual(2);
    expect(bot.textContent).toContain('I still need:');
    expect(bot.textContent).not.toContain('You can answer in one message, for example “Acme Ltd, Leeds to Paris, warehouse, appointment booked, ready 5 Nov, cheapest”. You can');
    expect(bot.querySelector('.needs-eg')!.textContent).toBe('You can answer in one message, for example “Acme Ltd, Leeds to Paris, warehouse, appointment booked, ready 5 Nov, cheapest”.');
    expect(bot.querySelectorAll('p').length).toBeLessThanOrEqual(4);
  });
  it('the list is red, bold and numbered, and readable on the bubble', () => {
    expect(css).toMatch(/\.msg \.needs \{[^}]*color: var\(--red\)[^}]*font-weight: 600/);
    expect(css).not.toMatch(/\.msg \.needs \{[^}]*list-style: none/);                 // an <ol> keeps its numbers
  });
  it('a single question stays a plain sentence', async () => {
    render(<App />);
    await say('Leeds to Paris, warehouse, appointment booked, ready 5 Nov 2031, cheapest');
    expect(lastBot().querySelector('ol.needs')).toBeNull();
    expect(lastBot().textContent).toContain('What’s your business name?');
  });
});
