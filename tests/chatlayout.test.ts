// The chat box is large enough to read a conversation in, with small text, and keeps its input pinned.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('app/globals.css', 'utf8');
const rule = (sel: string) => { const m = new RegExp('(?:^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}').exec(css); expect(m, sel).toBeTruthy(); return m![1]; };

describe('chat box size and text', () => {
  it('uses 14px (0.875rem) text for messages and the input, with a comfortable line height', () => {
    expect(rule('.log')).toMatch(/font-size: 0\.875rem; line-height: 1\.45/);
    expect(rule('.composer textarea')).toMatch(/font: 400 0\.875rem\/1\.45/);
  });
  it('has tighter bubbles and spacing than before', () => {
    expect(rule('.msg')).toMatch(/padding: 7px 11px/);
    expect(rule('.log')).toMatch(/gap: 8px/);
  });
  it('is wider (a share of the page, not a fixed width) and taller (viewport based, with a minimum and a cap)', () => {
    expect(rule('.grid')).toMatch(/grid-template-columns: minmax\(360px, 40%\) minmax\(0, 1fr\)/);
    const left = rule('.left');
    expect(left).toMatch(/height: calc\(100dvh - var\(--chrome/);
    expect(left).toMatch(/min-height: 520px/);
    expect(left).toMatch(/max-height: min\(860px, calc\(100dvh - var\(--nav-h/);
  });
  it('scrolls inside the box with the input below it, and stacks full width on small screens', () => {
    expect(rule('.log')).toMatch(/flex: 1; min-height: 0; overflow-y: auto/);
    expect(rule('.left')).toMatch(/display: flex; flex-direction: column/);
    expect(css).toMatch(/@media \(max-width: 960px\) \{\s*\.grid \{ grid-template-columns: 1fr; \}/);
  });
});
