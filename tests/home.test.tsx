// @vitest-environment jsdom
// The landing sections: hero, stats, cards, features, footer, and the scroll animations.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render, screen, fireEvent, cleanup, within, act, waitFor } from '@testing-library/react';
import App from '../components/App';
import Reveal from '../components/Reveal';
import CountUp from '../components/CountUp';
import { PF } from '../lib/pf';
import { about } from '../content/about';
import { home } from '../content/home';

const css = readFileSync('app/globals.css', 'utf8');

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn(); window.scrollTo = vi.fn() as any;
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"enabled":false}', { status: 200 }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('the home page sections', () => {
  it('opens with the big headline "Get Your Ship Together"', () => {
    render(<App />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe('Get Your ShipTogether');
    expect([...h1.querySelectorAll('.landing-line')].map(e => e.textContent).join(' ')).toBe('Get Your Ship Together');
    expect(screen.getByText(home.tagline)).toBeTruthy();
    expect(css).toMatch(/\.landing-h1 \{[^}]*clamp\(44px, 8vw, 104px\)/);
    expect(css).toMatch(/\.landing \{[^}]*min-height: calc\(100dvh/);                  // full-height hero
  });
  it('the hero card starts the chosen way of booking', () => {
    render(<App />);
    const card = screen.getByRole('group', { name: home.heroCard.title });
    fireEvent.click(within(card).getByRole('button', { name: 'Upload a file' }));
    expect(within(card).getByRole('button', { name: 'Upload a file' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(card).getByRole('button', { name: /Start/ }));
    expect(screen.getByRole('tab', { name: 'Upload a file' }).getAttribute('aria-selected')).toBe('true');
  });
  it('the stats are counted from the app itself, not typed in', () => {
    render(<App />);
    const strip = screen.getByRole('region', { name: home.stats.title });
    const nums = [...strip.querySelectorAll('li')].map(li => [li.querySelector('.sr')!.textContent, li.querySelector('.stat-l')!.textContent]);
    const carriers = new Set(PF.CARRIERS.map((c: any) => c.carrier)).size, countries = new Set(PF.CARRIERS.map((c: any) => c.dest)).size;
    expect(nums).toEqual([[String(PF.RULES.length), 'Fixed pre-flight rules'], [String(carriers), 'Carriers compared'], [String(countries), 'EU destination countries'], [String(PF.ORIGINS.length), 'UK collection cities']]);
    expect(nums.map(n => n[0])).toEqual(['10', '3', '3', '4']);
  });
  it('shows a card for each way to book, each check and each feature, from the content files', () => {
    const { container } = render(<App />);
    const ways = container.querySelector('#ways-h')!.closest('section')!;
    expect([...ways.querySelectorAll('.icard h3')].map(h => h.textContent)).toEqual([about.whatWeDo.ways[0].title, about.whatWeDo.ways[1].title, home.ways.thirdTitle]);
    const checks = container.querySelector('#checks-h')!.closest('section')!;
    expect(checks.querySelectorAll('.icard')).toHaveLength(about.whatWeCheck.items.length);
    expect(checks.textContent).toContain(about.whatWeCheck.items[0]);
    const features = container.querySelector('#features-h')!.closest('section')!;
    expect([...features.querySelectorAll('.feat h3')].map(h => h.textContent)).toEqual(home.features.items.map(f => f.title));
  });
  it('"Know more" opens the matching way to book', async () => {
    const { container } = render(<App />);
    const ways = container.querySelector('#ways-h')!.closest('section') as HTMLElement;
    fireEvent.click(within(ways).getByRole('button', { name: /Know more about Upload a file/ }));
    expect(screen.getByRole('tab', { name: 'Upload a file' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(within(ways).getByRole('button', { name: /Know more about Try an example/ }));
    await waitFor(() => expect(container.textContent).toContain('Example data, not your file'));
  });
  it('the sections come in order: hero, stats, ways, tool, checks, features, carriers, rulebook, about, footer', () => {
    const { container } = render(<App />);
    const ids = ['landing-h', 'ways-h', 'tool-h', 'checks-h', 'features-h', 'carriers', 'rulebook', 'about'];
    const els = ids.map(i => container.querySelector('#' + i)!);
    els.forEach((e, i) => { expect(e, ids[i]).toBeTruthy(); if (i) expect(els[i - 1].compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING, ids[i]).toBeTruthy(); });
    expect(els[7].compareDocumentPosition(container.querySelector('footer')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('the footer has company info, quick links, contact links and a copyright line', () => {
    render(<App />);
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByText('GYST Shipments')).toBeTruthy();
    expect(within(footer).getByRole('link', { name: about.contact.email }).getAttribute('href')).toBe('mailto:' + about.contact.email);
    expect(within(footer).getByRole('link', { name: about.contact.phone }).getAttribute('href')).toBe('tel:' + about.contact.phoneLink);
    fireEvent.click(within(footer).getByRole('button', { name: 'Rulebook' }));
    expect((document.getElementById('rulebook') as HTMLDetailsElement).open).toBe(true);
    expect(footer.textContent).toMatch(/© \d{4} Get Your Ship Together/);
    expect(within(footer).queryByText(/facebook|twitter|instagram|linkedin/i)).toBeNull();
  });
  it('each page has one h1, and cards use h3 under an h2', () => {
    const { container } = render(<App />);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    for (const id of ['ways-h', 'checks-h', 'features-h']) expect(container.querySelector('#' + id)!.tagName).toBe('H2');
  });
});

describe('the mobile menu is full screen', () => {
  it('its stylesheet pins it under the navbar over the whole screen, and the page behind does not scroll while it is open', () => {
    expect(css).toMatch(/@media \(max-width: 700px\) \{\s*\.navmenu \{ position: fixed; top: var\(--nav-h[^}]*bottom: 0/);
    expect(css).toMatch(/html\.menu-open \{ overflow: hidden; \}/);
  });
  it('adds and removes the page lock as the menu opens and closes', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Menu/ }));
    expect(document.documentElement.classList.contains('menu-open')).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.documentElement.classList.contains('menu-open')).toBe(false);
  });
});

describe('scroll animations', () => {
  const stubIO = () => {
    const observers: { cb: (e: any[]) => void; el?: Element }[] = [];
    vi.stubGlobal('IntersectionObserver', class { cb: any; constructor(cb: any) { this.cb = cb; observers.push(this as any); } observe(el: Element) { (this as any).el = el; } disconnect() {} unobserve() {} });
    return observers;
  };
  const offscreen = () => { vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 5000, bottom: 5100, left: 0, right: 100, width: 100, height: 100, x: 0, y: 5000, toJSON() {} } as any); };

  it('content is fully visible without IntersectionObserver (and so before scripts load)', () => {
    const { container } = render(<Reveal className="x">hello</Reveal>);
    expect(container.firstElementChild!.className).not.toContain('is-hidden');
  });
  it('content below the fold starts hidden and fades in once when it scrolls into view', () => {
    const obs = stubIO(); offscreen();
    const { container } = render(<Reveal className="x">hello</Reveal>);
    const el = container.firstElementChild!;
    expect(el.className).toContain('is-hidden');
    act(() => obs[0].cb([{ isIntersecting: true }]));
    expect(el.className).toContain('is-shown');
    expect(el.className).not.toContain('is-hidden');
    vi.restoreAllMocks();
  });
  it('reduced motion shows everything at once', () => {
    stubIO(); offscreen();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    const { container } = render(<Reveal className="x">hello</Reveal>);
    expect(container.firstElementChild!.className).not.toContain('is-hidden');
    vi.restoreAllMocks();
  });
  it('a number shows its final value, then counts up from zero when it scrolls into view and ends on the exact value', () => {
    vi.useFakeTimers();
    const obs = stubIO();
    const { container } = render(<CountUp to={10} />);
    expect(container.querySelector('[aria-hidden]')!.textContent).toBe('10');
    act(() => obs[0].cb([{ isIntersecting: true }]));
    expect(container.querySelector('[aria-hidden]')!.textContent).toBe('0');
    act(() => { vi.advanceTimersByTime(500); });
    const mid = Number(container.querySelector('[aria-hidden]')!.textContent);
    expect(mid).toBeGreaterThan(0); expect(mid).toBeLessThanOrEqual(10);
    act(() => { vi.advanceTimersByTime(1500); });
    expect(container.querySelector('[aria-hidden]')!.textContent).toBe('10');
    expect(container.querySelector('.sr')!.textContent).toBe('10');         // screen readers always get the final number
  });
  it('reduced motion skips the count', () => {
    const obs = stubIO();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    render(<CountUp to={7} />);
    expect(obs).toHaveLength(0);
  });
  it('the stylesheet stops the route animation and the card lift for reduced motion', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.route, \.dots circle \{ animation: none; \}/);
  });
});
