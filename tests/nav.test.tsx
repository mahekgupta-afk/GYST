// @vitest-environment jsdom
// Header navigation: every item does its job, About is last, the mobile menu behaves, tab switches keep the booking.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import App from '../components/App';

const css = readFileSync('app/globals.css', 'utf8');
const scrolled: string[] = [];

beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) { scrolled.push(this.id); });
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ enabled: false }), { status: 200, headers: { 'content-type': 'application/json' } }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const nav = () => screen.getByRole('navigation', { name: 'App' });
const inNav = (name: string) => within(nav()).getByRole('button', { name });
const tabbable = () => [...nav().querySelectorAll<HTMLElement>('button, a[href]')];
const label = (e: HTMLElement) => (e.textContent || '').trim();
const sendChat = async (text: string) => {
  const n = document.querySelectorAll('.msg').length;
  fireEvent.change(screen.getByLabelText('Your message'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(document.querySelectorAll('.msg').length).toBe(n + 2));      // our message and the bot's reply
};

describe('header navigation', () => {
  it('keeps the existing label and the Light/Dark switch', () => {
    render(<App />);
    expect(within(nav()).getByText('UK to EU shipments')).toBeTruthy();
    expect(within(nav()).getByRole('button', { name: /Light/ })).toBeTruthy();
    expect(within(nav()).getByRole('button', { name: /Dark/ })).toBeTruthy();
  });

  it('left group is in the specified order, the right cluster is New booking, switch, About, with no Template item', () => {
    render(<App />);
    const labels = tabbable().map(label).filter(t => t !== 'Menu');
    expect(labels).toEqual(['Chat to book', 'Upload a file', 'Try an example', 'Rulebook', 'Carrier options', 'New booking', 'About', 'Light', 'Dark']);
    expect(labels.some(l => /template/i.test(l))).toBe(false);
  });

  it('About sits immediately left of the Light/Dark switch, styled as a plain text link rather than a button', () => {
    render(<App />);
    const all = tabbable().filter(e => label(e) !== 'Menu');
    const about = all[all.length - 3];
    expect(label(about)).toBe('About');
    expect(label(all[all.length - 2])).toBe('Light');
    expect(about.tagName).toBe('A');
    expect(about.className).not.toMatch(/\bbtn\b/);
    expect(css).toMatch(/\.navabout \{[^}]*text-decoration: underline/);
  });

  it('tab order follows the visual order: brand, left group, then the right cluster', () => {
    render(<App />);
    const order = tabbable();
    const pos = (t: string) => order.findIndex(e => label(e) === t);
    expect(pos('Chat to book')).toBeLessThan(pos('Upload a file'));
    expect(pos('Carrier options')).toBeLessThan(pos('New booking'));
    expect(pos('New booking')).toBeLessThan(pos('About'));
    expect(pos('About')).toBeLessThan(pos('Light'));
  });

  it('Chat to book: switches to the Chat tab, focuses the message box, scrolls to the app', async () => {
    render(<App />);
    fireEvent.click(inNav('Upload a file'));
    expect(screen.getByRole('tab', { name: 'Upload a file' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(inNav('Chat to book'));
    expect(screen.getByRole('tab', { name: 'Chat to book' }).getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Your message')));
    expect(scrolled.at(-1)).toBe('start');
  });

  it('Upload a file: switches to the Upload tab and scrolls it into view', () => {
    render(<App />);
    fireEvent.click(inNav('Upload a file'));
    expect(screen.getByRole('tab', { name: 'Upload a file' }).getAttribute('aria-selected')).toBe('true');
    expect(scrolled.at(-1)).toBe('start');
  });

  it('Rulebook: scrolls to the section and expands it', () => {
    render(<App />);
    const d = document.getElementById('rulebook') as HTMLDetailsElement;
    expect(d.tagName).toBe('DETAILS');
    expect(d.open).toBe(false);
    expect(d.textContent).toContain('How the carrier is chosen');
    fireEvent.click(inNav('Rulebook'));
    expect(d.open).toBe(true);
    expect(scrolled.at(-1)).toBe('rulebook');
  });

  it('marks the current view with aria-current', () => {
    render(<App />);
    expect(inNav('Chat to book').getAttribute('aria-current')).toBe('true');
    expect(inNav('Upload a file').getAttribute('aria-current')).toBeNull();
    fireEvent.click(inNav('Upload a file'));
    expect(inNav('Upload a file').getAttribute('aria-current')).toBe('true');
    expect(inNav('Chat to book').getAttribute('aria-current')).toBeNull();
    fireEvent.click(inNav('Rulebook'));
    expect(inNav('Rulebook').getAttribute('aria-current')).toBe('true');
  });

  it('switching tabs keeps the booking; New booking resets chat, results and the file', async () => {
    render(<App />);
    await sendChat('2 pallets to Germany');
    const before = document.querySelector('.log')!.textContent;
    expect(before).toContain('2 pallets to Germany');
    expect(document.querySelectorAll('.msg').length).toBe(3);
    fireEvent.click(inNav('Upload a file'));
    fireEvent.click(inNav('Chat to book'));
    expect(document.querySelector('.log')!.textContent).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'New booking' }));
    await waitFor(() => expect(screen.queryByText('2 pallets to Germany')).toBeNull());
    expect(screen.getByText(/Let’s get your shipment sorted/)).toBeTruthy();
    expect(document.querySelectorAll('.msg').length).toBe(1);
    expect(screen.getByRole('tab', { name: 'Chat to book' }).getAttribute('aria-selected')).toBe('true');
  });

  it('typing "start over" does the same as New booking', async () => {
    render(<App />);
    await sendChat('2 pallets to Germany');
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'start over' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.queryByText('2 pallets to Germany')).toBeNull());
    expect(screen.getByText(/Let’s get your shipment sorted/)).toBeTruthy();
  });
});

describe('mobile menu', () => {
  const menu = () => screen.queryByRole('list', { name: 'Menu' });
  it('lists the five main items, then New booking, then About last', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Menu/ }));
    const items = within(menu() as HTMLElement).getAllByRole('listitem').map(li => label(li as HTMLElement));
    expect(items).toEqual(['Chat to book', 'Upload a file', 'Try an example', 'Rulebook', 'Carrier options', 'New booking', 'About']);
  });
  it('is closed to begin with, opens with aria-expanded, and closes after a choice', () => {
    render(<App />);
    const btn = screen.getByRole('button', { name: /Menu/ });
    expect(menu()).toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(within(menu() as HTMLElement).getByRole('button', { name: 'Upload a file' }));
    expect(menu()).toBeNull();
    expect(screen.getByRole('tab', { name: 'Upload a file' }).getAttribute('aria-selected')).toBe('true');
  });
  it('closes on Escape and returns focus to the Menu button', () => {
    render(<App />);
    const btn = screen.getByRole('button', { name: /Menu/ });
    fireEvent.click(btn);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
  it('About in the menu scrolls to the About section', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Menu/ }));
    fireEvent.click(within(menu() as HTMLElement).getByRole('link', { name: 'About' }));
    expect(menu()).toBeNull();
  });
});

describe('layout rules in the stylesheet', () => {
  it('the header is sticky and every scroll target leaves room for it', () => {
    expect(css).toMatch(/\.topnav \{[^}]*position: sticky;[^}]*top: 0/);
    const m = /#start, #carriers, #rulebook, #about \{([^}]*)\}/.exec(css);
    expect(m, 'scroll-margin rule').toBeTruthy();
    expect(m![1]).toMatch(/scroll-margin-top: calc\(var\(--nav-h, \d+px\) \+ \d+px\)/);
  });
  it('the sticky chat panel also sits below the header', () => {
    expect(css).toMatch(/\.left \{[^}]*top: calc\(var\(--nav-h, \d+px\) \+ 16px\)/);
  });
  it('respects the safe-area insets', () => {
    expect(css).toMatch(/\.topnav \{[^}]*env\(safe-area-inset-top/);
    expect(css).toMatch(/\.nav \{[^}]*env\(safe-area-inset-left/);
  });
  it('under 700px the left links, New booking and About are hidden and Menu is shown', () => {
    const m = /@media \(max-width: 700px\) \{([\s\S]*?)\n\}/.exec(css);
    expect(m).toBeTruthy();
    expect(m![1]).toMatch(/\.navlinks, \.navnew, \.navabout \{ display: none; \}/);
    expect(m![1]).toMatch(/\.navmenu-btn \{ display: inline-flex; \}/);
    expect(css).toMatch(/\.navmenu-btn \{ display: none;/);
  });
  it('nav items have a visible focus state and an active state', () => {
    expect(css).toMatch(/\.navlink:focus-visible/);
    expect(css).toMatch(/\.navlink\[aria-current="true"\]/);
  });
});
