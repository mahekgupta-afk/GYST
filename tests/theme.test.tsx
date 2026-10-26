// @vitest-environment jsdom
// Light and dark themes: contrast of every text/background pair in the real stylesheet, and the switch itself.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ThemeToggle from '../components/ThemeToggle';
import { applyTheme, readTheme, themeInitScript, THEME_KEY } from '../lib/theme';

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
    for (const k of ['ink', 'ink2', 'ink3', 'canvas', 'paper', 'paper2', 'line', 'brand', 'brand-hover', 'brand-ink', 'brand-soft', 'red', 'red-bg', 'amber', 'amber-bg', 'green', 'green-bg', 'glow']) expect(t[k], k).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it.each(PAIRS)('%s on %s has at least 4.5:1 contrast (WCAG AA)', (fg, bg) => {
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
  it('has a visible border against the page', () => {
    expect(ratio(t.line, t.paper)).toBeGreaterThanOrEqual(1.1);
  });
});

describe('the two dark blocks cannot drift apart', () => {
  it('"system dark" and "chosen dark" use identical colours', () => expect(darkMedia).toEqual(darkAttr));
  it('light and dark are genuinely different', () => { expect(light.canvas).not.toBe(darkAttr.canvas); expect(lum(light.canvas)).toBeGreaterThan(lum(darkAttr.canvas)); });
});

describe('the theme switch', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('Dark sets data-theme="dark" and remembers it; Light sets "light"; System removes it and forgets', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(readTheme()).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(readTheme()).toBe('light');
    applyTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(readTheme()).toBe('system');
  });
  it('ignores a corrupted saved value', () => {
    localStorage.setItem(THEME_KEY, 'purple');
    expect(readTheme()).toBe('system');
  });
  it('still applies the theme when browser storage is blocked, and never throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => applyTheme('dark')).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(readTheme()).toBe('system');
    expect(() => new Function(themeInitScript)()).not.toThrow();      // the no-flash script is safe too
  });
  it('the head script applies the saved theme before the page renders, and ignores anything else', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    new Function(themeInitScript)();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem(THEME_KEY, 'bogus');
    new Function(themeInitScript)();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
  it('the buttons switch the page and show which one is selected', () => {
    render(<ThemeToggle />);
    const pressed = () => screen.getAllByRole('button').filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent);
    expect(pressed()).toEqual(['System']);
    fireEvent.click(screen.getByRole('button', { name: /Dark/ }));
    expect(pressed()).toEqual(['Dark']);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: /Light/ }));
    expect(pressed()).toEqual(['Light']);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: /System/ }));
    expect(pressed()).toEqual(['System']);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
  it('remembers the choice on the next visit', () => {
    const first = render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /Dark/ }));
    first.unmount();
    render(<ThemeToggle />);
    expect(screen.getAllByRole('button').filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent)).toEqual(['Dark']);
  });
  it('is a labelled group of three buttons that can be used from the keyboard', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('group', { name: 'Colour theme' })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });
});
