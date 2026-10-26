// The one dark palette ("freight terminal"): contrast of every text/background pair in the real stylesheet, the locked status colours,
// and the checks that the old light mode, theme switch and decorative frame are gone.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const css = readFileSync('app/globals.css', 'utf8');
const layout = readFileSync('app/layout.tsx', 'utf8');
const block = (start: string) => { const i = css.indexOf(start); const j = css.indexOf('\n}', i); return css.slice(i, j); };

// Read every custom property in :root, following var(--other) references, so tokens defined as aliases resolve to a colour.
const raw = Object.fromEntries([...block(':root {').matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
const resolve = (name: string, depth = 0): string => {
  const v = raw[name];
  if (v === undefined || depth > 6) throw new Error('unknown token ' + name);
  const ref = /^var\(--([a-z0-9-]+)\)$/.exec(v);
  return ref ? resolve(ref[1], depth + 1) : v;
};
const t = new Proxy({} as Record<string, string>, { get: (_o, k: string) => { try { return resolve(k); } catch { return undefined as any; } } });

const lum = (h: string) => { const c = h.replace('#', ''); const [r, g, b] = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Every foreground/background pairing the stylesheet actually uses for text.
const PAIRS: [string, string][] = [
  ['ink', 'canvas'], ['ink', 'paper'], ['ink', 'paper2'], ['ink2', 'canvas'], ['ink2', 'paper'], ['ink2', 'paper2'], ['ink3', 'canvas'], ['ink3', 'paper'], ['ink3', 'paper2'],
  ['brand-ink', 'brand'], ['brand-ink', 'brand-hover'], ['link', 'canvas'], ['link', 'paper'], ['link', 'paper2'], ['link', 'brand-soft'], ['ink', 'brand-soft'], ['ink2', 'brand-soft'],
  ['red', 'red-bg'], ['amber', 'amber-bg'], ['green', 'green-bg'], ['red', 'paper'], ['amber', 'paper'], ['green', 'paper'], ['red', 'paper2'], ['red', 'canvas'], ['amber', 'canvas'], ['green', 'canvas'],
  ['ink', 'red-bg'], ['ink', 'amber-bg'], ['ink', 'green-bg'],
];

describe('the dark palette', () => {
  it('defines every token as a colour', () => {
    for (const k of ['ink', 'ink2', 'ink3', 'canvas', 'paper', 'paper2', 'line', 'frame', 'edge', 'brand', 'brand-hover', 'brand-ink', 'brand-soft', 'link', 'ring',
      'red', 'red-bg', 'amber', 'amber-bg', 'green', 'green-bg', 'tile-all', 'tile-red', 'tile-amber', 'tile-green', 'tile-booked', 'bg', 'surface', 'surface-2', 'border', 'border-active', 'accent']) expect(t[k], k).toMatch(/^#[0-9a-f]{6}$/i);
  });
  it('uses the specified surfaces', () => {
    expect(t.bg).toBe('#080c14'); expect(t.surface).toBe('#0f1929'); expect(t['surface-2']).toBe('#162236');
    expect(t.border).toBe('#1e3048'); expect(t['border-active']).toBe('#2a4570'); expect(t.accent).toBe('#f6c744'); expect(t.ink).toBe('#f0f4f8');
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
  it('control borders and the focus ring are visible against the cards and the page (3:1)', () => {
    for (const k of ['edge', 'ring']) { expect(ratio(t[k], t.paper), k + ' on paper').toBeGreaterThanOrEqual(3); expect(ratio(t[k], t.canvas), k + ' on canvas').toBeGreaterThanOrEqual(3); }
    expect(ratio(t.edge, t.paper2)).toBeGreaterThanOrEqual(3);
  });
  it('has a visible hairline against the page and cards', () => {
    expect(ratio(t.line, t.canvas)).toBeGreaterThanOrEqual(1.1);
    expect(ratio(t.line, t.paper)).toBeGreaterThanOrEqual(1.05);
  });
});

// The status colours are part of the product's meaning, so a restyle must not move them.
describe('red, amber and green are unchanged by the redesign', () => {
  const LOCKED = { red: '#ff8f86', 'red-bg': '#3b181b', amber: '#f7bd55', 'amber-bg': '#3a2b0c', green: '#5fd69a', 'green-bg': '#0e3323',
    'tile-red': '#ff8277', 'tile-red-text': '#000000', 'tile-amber': '#f7bd55', 'tile-amber-text': '#000000', 'tile-green': '#52d08e', 'tile-green-text': '#000000' };
  it.each(Object.entries(LOCKED))('%s', (k, v) => expect(t[k]).toBe(v));
});

describe('dark only: no light mode, no theme switch', () => {
  it('has a single palette: no prefers-color-scheme or data-theme blocks, and the browser is told it is dark', () => {
    expect(css).not.toMatch(/prefers-color-scheme/);
    expect(css).not.toMatch(/data-theme/);
    expect(css).not.toMatch(/:root(\[|:not)/);
    expect(css.match(/--canvas:/g)).toHaveLength(1);
    expect(block(':root {')).toMatch(/\bcolor-scheme: dark;/);
  });
  it('the theme files, the switch and the no-flash script are gone', () => {
    expect(existsSync('components/ThemeToggle.tsx')).toBe(false);
    expect(existsSync('lib/theme.ts')).toBe(false);
    expect(layout).not.toMatch(/themeInitScript|data-theme|suppressHydrationWarning/);
    expect(readFileSync('components/Nav.tsx', 'utf8')).not.toMatch(/ThemeToggle/);
  });
});

describe('shape and decoration', () => {
  it('buttons are pills, cards and the chat panel are rounded, inputs are softly rounded', () => {
    expect(css).toMatch(/\.btn \{[^}]*border-radius: 999px/);
    expect(css).toMatch(/\.navlink \{[^}]*border-radius: 999px/);
    expect(css).toMatch(/\.card \{[^}]*border-radius: 14px/);
    expect(css).toMatch(/\.left \{[^}]*border-radius: 18px/);
    expect(css).toMatch(/\.inp \{[^}]*border-radius: 10px/);
    expect(css).toMatch(/\.nav \{[^}]*border-radius: 999px/);          // the floating pill navbar
  });
  it('the primary button is the golden yellow with dark text', () => {
    expect(t.brand).toBe('#f6c744');
    expect(t['brand-ink']).toBe('#111827');
  });
  it('the old frame, corner marks, hero strip and rubber stamp are removed', () => {
    for (const sel of ['\\.frame', '\\.plus', '\\.hero', '\\.stamp', '\\.eyebrow']) expect(css, sel).not.toMatch(new RegExp(sel + '[ .{:,]'));
    const app = readFileSync('components/App.tsx', 'utf8'), res = readFileSync('components/Results.tsx', 'utf8');
    expect(app).not.toMatch(/className="frame"|className="plus|className="hero/);
    expect(res).not.toMatch(/stamp/);
  });
  it('a verdict bar shows the status, and the nav carries the date in monospace', () => {
    for (const c of ['verdict-red', 'verdict-amber', 'verdict-green', 'verdict-dot', 'verdict-label']) expect(css).toContain('.' + c);
    expect(css).toMatch(/\.nav-today \{[^}]*var\(--mono\)/);
    expect(css).toMatch(/td\.num, th\.num[^{]*\{ font-family: var\(--mono\)/);
  });
  it('uses DM Sans, Inter and JetBrains Mono', () => {
    expect(layout).toMatch(/DM_Sans/); expect(layout).toMatch(/JetBrains_Mono/); expect(layout).toMatch(/Inter/);
    expect(layout).not.toMatch(/Cal_Sans/);
  });
});
