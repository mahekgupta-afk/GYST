// @vitest-environment jsdom
// Light and dark themes: contrast of every text/background pair in the real stylesheet, and the switch itself.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ThemeToggle from '../components/ThemeToggle';
import { applyTheme, readTheme, effectiveTheme, themeInitScript, THEME_KEY } from '../lib/theme';

const css = readFileSync('app/globals.css', 'utf8');
const block = (start: string) => { const i = css.indexOf(start); const j = css.indexOf('}', i); return css.slice(i, j); };
const tokens = (b: string) => Object.fromEntries([...b.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map(m => [m[1], m[2]]));

const light = tokens(block(':root {'));
const darkMedia = tokens(block(':root:not([data-theme="light"]) {'));
const darkAttr = tokens(block(':root[data-theme="dark"] {'));

const lum = (h: string) => { const c = h.replace('#', ''); const [r, g, b] = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Every foreground/background pairing the stylesheet actually uses for text.
const PAIRS: [string, string][] = [
  ['ink', 'canvas'], ['ink', 'paper'], ['ink', 'paper2'], ['ink2', 'canvas'], ['ink2', 'paper'], ['ink2', 'paper2'], ['ink3', 'canvas'], ['ink3', 'paper'], ['ink3', 'paper2'],
  ['brand-ink', 'brand'], ['brand-ink', 'brand-hover'], ['brand', 'paper'], ['brand', 'paper2'], ['brand', 'brand-soft'], ['ink', 'brand-soft'],
  ['red', 'red-bg'], ['amber', 'amber-bg'], ['green', 'green-bg'], ['red', 'paper'], ['amber', 'paper'], ['green', 'paper'], ['red', 'paper2'], ['ink', 'red-bg'], ['ink', 'amber-bg'], ['ink', 'green-bg'],
];

describe.each([['light', light], ['dark (system setting)', darkMedia], ['dark (chosen)', darkAttr]] as const)('%s theme', (_name, t) => {
  it('defines every token', () => {
    for (const k of ['ink', 'ink2', 'ink3', 'canvas', 'paper', 'paper2', 'line', 'brand', 'brand-hover', 'brand-ink', 'brand-soft', 'red', 'red-bg', 'amber', 'amber-bg', 'green', 'green-bg', 'glow', 'tile-all', 'tile-red', 'tile-amber', 'tile-green', 'tile-booked']) expect(t[k], k).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it.each(PAIRS)('%s on %s has at least 4.5:1 contrast (WCAG AA)', (fg, bg) => {
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['all', 'red', 'amber', 'green', 'booked'])('the %s status tile has black or white text with at least 4.5:1 contrast on its fill', name => {
    const fg = t['tile-' + name + '-text'] ?? t['tile-all-text'];
    const bg = t['tile-' + name];
    expect(['#000000', '#ffffff']).toContain(fg.toLowerCase());
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('every filled tile stands out from the card it sits on (at least 3:1 on its edge or fill)', () => {
    for (const name of ['red', 'amber', 'green', 'booked']) {
      const edge = name === 'amber' ? t['tile-amber-edge'] : t['tile-' + name];
      expect(ratio(edge, t.paper), name).toBeGreaterThanOrEqual(3);
    }
  });
  it('has a visible border against the page', () => {
    expect(ratio(t.line, t.paper)).toBeGreaterThanOrEqual(1.1);
  });
});

describe('the two dark blocks cannot drift apart', () => {
  it('"system dark" and "chosen dark" use identical colours', () => expect(darkMedia).toEqual(darkAttr));
  it('light and dark are genuinely different', () => { expect(light.canvas).not.toBe(darkAttr.canvas); expect(lum(light.canvas)).toBeGreaterThan(lum(darkAttr.canvas)); });
});

describe('the theme switch (Light and Dark only)', () => {
  const matchMedia = (dark: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: dark && q.includes('dark'), media: q, addEventListener() {}, removeEventListener() {} }));
  beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); matchMedia(false); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const pressed = () => screen.getAllByRole('button').filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent);

  it('has exactly two buttons, Light and Dark, and no System option', () => {
    render(<ThemeToggle />);
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Light', 'Dark']);
    expect(screen.queryByText(/System/)).toBeNull();
    expect(screen.getByRole('group', { name: 'Colour theme' })).toBeTruthy();
  });
  it('Dark sets data-theme="dark" and remembers it; Light sets "light"', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(readTheme()).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(readTheme()).toBe('light');
  });
  it('before anything is saved the page follows the device, and the matching button is marked', () => {
    matchMedia(true);
    expect(readTheme()).toBeNull();
    expect(effectiveTheme()).toBe('dark');
    render(<ThemeToggle />);
    expect(pressed()).toEqual(['Dark']);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);   // CSS follows the device until a choice is made
    cleanup();
    matchMedia(false);
    render(<ThemeToggle />);
    expect(pressed()).toEqual(['Light']);
  });
  it('a saved choice beats the device setting', () => {
    matchMedia(true);
    localStorage.setItem(THEME_KEY, 'light');
    expect(effectiveTheme()).toBe('light');
    render(<ThemeToggle />);
    expect(pressed()).toEqual(['Light']);
  });
  it('ignores a corrupted saved value, including the old "system" value', () => {
    for (const bad of ['purple', 'system', '']) { localStorage.setItem(THEME_KEY, bad); expect(readTheme()).toBeNull(); }
  });
  it('still applies the theme when browser storage is blocked, and never throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => applyTheme('dark')).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(readTheme()).toBeNull();
    expect(effectiveTheme()).toBe('light');
    expect(() => new Function(themeInitScript)()).not.toThrow();      // the no-flash script is safe too
  });
  it('the head script applies a saved theme before the page renders, and ignores anything else', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    new Function(themeInitScript)();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    document.documentElement.removeAttribute('data-theme');
    for (const bad of ['bogus', 'system']) { localStorage.setItem(THEME_KEY, bad); new Function(themeInitScript)(); expect(document.documentElement.hasAttribute('data-theme')).toBe(false); }
  });
  it('clicking a button switches the page and moves the highlight', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /Dark/ }));
    expect(pressed()).toEqual(['Dark']);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: /Light/ }));
    expect(pressed()).toEqual(['Light']);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
  it('remembers the choice on the next visit', () => {
    const first = render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /Dark/ }));
    first.unmount();
    render(<ThemeToggle />);
    expect(pressed()).toEqual(['Dark']);
  });
});
