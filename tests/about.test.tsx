// @vitest-environment jsdom
// About section: renders only from content/about.ts, and the placeholder check works.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import About from '../components/About';
import { about, type AboutContent } from '../content/about';

afterEach(() => cleanup());
const strings = (c: AboutContent) => [c.tagline, c.what, c.why, ...c.steps, ...c.checks, ...c.scope, c.contact, ...c.team.flatMap(m => [m.name, m.role])];

describe('About renders every item from the content file', () => {
  it('shows each string, in the specified section order', () => {
    const { container } = render(<About />);
    for (const s of strings(about)) expect(container.textContent, s).toContain(s);
    const heads = [...container.querySelectorAll('h2, h3')].map(h => h.textContent);
    expect(heads).toEqual(['About', 'What it does', 'Why we built it', 'How it works', 'What it checks', 'Scope and limits', 'The team', 'Contact']);
  });
  it('has one h2 and h3 for the subsections', () => {
    const { container } = render(<About />);
    expect(container.querySelectorAll('h2')).toHaveLength(1);
    expect(container.querySelectorAll('h3')).toHaveLength(7);
    expect(container.querySelectorAll('h1, h4')).toHaveLength(0);
  });
  it('How it works is three numbered steps; the team is three cards with initials and no photos; contact is plain text', () => {
    const { container } = render(<About />);
    expect(container.querySelectorAll('ol.about-steps > li')).toHaveLength(3);
    expect(container.querySelectorAll('.about-person')).toHaveLength(3);
    expect([...container.querySelectorAll('.about-avatar')].map(e => e.textContent)).toEqual(['T1', 'T2', 'T3']);
    expect(container.querySelectorAll('img, form, input, a[href^="mailto"]')).toHaveLength(0);
  });
  it('lists the eight checks and the four limits', () => {
    const { container } = render(<About />);
    const t = container.textContent!;
    for (const w of ['HS codes', 'Declared value', 'Carton counts', 'Weight per pallet', 'Restricted goods', 'Delivery appointment', 'Country of origin', 'Ready date']) expect(t).toContain(w);
    for (const w of ['Germany, France and the Netherlands only', 'GBP only', 'estimates', 'not transmitted to a carrier']) expect(t).toContain(w);
  });
  it('uses the dummy wording given', () => {
    expect(about.tagline).toBe('[Placeholder] Catch shipping mistakes before the shipment leaves.');
    expect(about.team.map(m => m.name + ', ' + m.role.replace('[Placeholder] ', ''))).toEqual(['[Placeholder] Team Member One, Product', '[Placeholder] Team Member Two, Engineering', '[Placeholder] Team Member Three, Operations']);
    expect(about.contact).toBe('[Placeholder] hello@example.com');
  });
  it('every dummy string starts with [Placeholder]', () => {
    for (const s of strings(about)) expect(s.startsWith('[Placeholder] '), s).toBe(true);
  });
  it('editing the content changes the output with no code change', () => {
    const edited: AboutContent = { ...about, tagline: 'Real tagline.', steps: ['One real step.'], team: [{ name: 'Asha Rao', role: 'Founder' }], contact: 'ask@shipco.example' };
    const { container } = render(<About content={edited} />);
    const t = container.textContent!;
    expect(t).toContain('Real tagline.');
    expect(t).toContain('ask@shipco.example');
    expect(t).not.toContain('Catch shipping mistakes');
    expect(container.querySelectorAll('ol.about-steps > li')).toHaveLength(1);
    expect(container.querySelector('.about-avatar')!.textContent).toBe('AR');       // initials taken from the name
  });
  it('the page picks up an edited content file (module replaced, component untouched)', async () => {
    vi.resetModules();
    vi.doMock('../content/about', () => ({ about: { ...about, tagline: 'Edited in the content file only.' } }));
    const Fresh = (await import('../components/About')).default;
    const { container } = render(<Fresh />);
    expect(container.textContent).toContain('Edited in the content file only.');
    vi.doUnmock('../content/about'); vi.resetModules();
  });
});

describe('the About link', () => {
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); window.scrollTo = vi.fn() as any; vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"enabled":false}', { status: 200 })))); });
  afterEach(() => vi.unstubAllGlobals());
  it('scrolls to the section at the bottom of the page and marks it current', async () => {
    const App = (await import('../components/App')).default;
    render(<App />);
    const target = document.getElementById('about')!;
    expect(target.tagName).toBe('SECTION');
    expect(target.parentElement!.lastElementChild).toBe(target);                  // last thing on the page
    fireEvent.click(within(screen.getByRole('navigation', { name: 'App' })).getByRole('link', { name: 'About' }));
    expect((Element.prototype.scrollIntoView as any).mock.contexts.at(-1)).toBe(target);
    expect(within(screen.getByRole('navigation', { name: 'App' })).getByRole('link', { name: 'About' }).getAttribute('aria-current')).toBe('true');
  });
});

describe('npm run check:placeholders', () => {
  const run = (...files: string[]) => spawnSync('node', ['scripts/check-placeholders.mjs', ...files], { encoding: 'utf8' });
  const tmp = (name: string, body: string) => { const d = mkdtempSync(join(tmpdir(), 'ph-')); const f = join(d, name); writeFileSync(f, body); return f; };

  it('is wired up in package.json', () => {
    expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts['check:placeholders']).toBe('node scripts/check-placeholders.mjs');
  });
  it('fails and lists every remaining placeholder in the real content file', () => {
    const r = run();
    expect(r.status).toBe(1);
    const listed = r.stdout.trim().split('\n').filter(l => l.startsWith('content/about.ts:'));
    expect(listed).toHaveLength(strings(about).length);
    expect(r.stderr).toContain(strings(about).length + ' [Placeholder] strings left');
  });
  it('passes when no placeholders remain', () => {
    const r = run(tmp('about.ts', "export const a = { tagline: 'Real words.' };\n"));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('No [Placeholder] strings left');
  });
  it('fails on a file that still has one, naming the line, and ignores comment lines', () => {
    const f = tmp('about.ts', "// remove the [Placeholder] tags when done\nexport const a = {\n  x: '[Placeholder] still here',\n  y: 'done',\n};\n");
    const r = run(f);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(':3: [Placeholder] still here');
    expect(r.stdout).not.toContain(':1:');
  });
});
