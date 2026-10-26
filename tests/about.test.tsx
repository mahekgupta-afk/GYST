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
const strings = (c: AboutContent) => [c.tagline, c.whatWeDo.intro, ...c.whatWeDo.ways.flatMap(w => [w.title, w.text]), c.why.text, ...c.howItWorks.steps, ...c.whatWeCheck.items, ...c.scope.items,
  c.contact.email, c.contact.phone];
const css = readFileSync('app/globals.css', 'utf8');

describe('About renders every item from the content file', () => {
  it('shows each string, and the section titles in the specified order', () => {
    const { container } = render(<About />);
    for (const s of strings(about)) expect(container.textContent, s).toContain(s);
    const heads = [...container.querySelectorAll('h2, h3')].map(h => h.textContent);
    expect(heads).toEqual(['About', 'What we do', 'Why we built it', 'How it works', 'What we check', 'Scope and limits', 'Contact']);
  });
  it('has one h2, h3 for the subsections and h4 only for the two ways', () => {
    const { container } = render(<About />);
    expect(container.querySelectorAll('h2')).toHaveLength(1);
    expect(container.querySelectorAll('h3')).toHaveLength(6);
    expect([...container.querySelectorAll('h4')].map(h => h.textContent)).toEqual(['Chat to book', 'Upload a file']);
    expect(container.querySelectorAll('h1')).toHaveLength(0);
  });
  it('What we do is two cards, side by side on desktop and stacked on a phone', () => {
    const { container } = render(<About />);
    expect(container.querySelectorAll('.about-way')).toHaveLength(2);
    expect(css).toMatch(/\.about \.about-ways \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/@media \(max-width: 700px\) \{ \.about \.about-ways \{ grid-template-columns: minmax\(0, 1fr\); \} \}/);
  });
  it('How it works is three numbered steps; the check and scope lists have 8 and 4 items', () => {
    const { container } = render(<About />);
    expect(container.querySelectorAll('ol.about-steps > li')).toHaveLength(3);
    expect(about.whatWeCheck.items).toHaveLength(8);
    expect(about.scope.items).toHaveLength(6);
    expect(about.scope.items.join(' ')).toMatch(/simulated/i);
    expect(about.scope.items.join(' ')).toMatch(/not.*sent to a carrier|nothing is sent to a carrier/i);
    expect(about.scope.items.join(' ')).toMatch(/UK Trade Tariff/);
  });
  it('has no team or partners section', () => {
    const { container } = render(<About />);
    expect(container.querySelectorAll('.about-person, .about-avatar, .about-team')).toHaveLength(0);
    expect(container.textContent).not.toMatch(/partner|The team|Mahek|Nirali/i);
    expect('team' in about).toBe(false);
  });
  it('contact has a mailto link and a tap-to-call link, and no form', () => {
    const { container } = render(<About />);
    const mail = screen.getByRole('link', { name: 'Getyouship2gether@hotmail.in' });
    expect(mail.getAttribute('href')).toBe('mailto:Getyouship2gether@hotmail.in');
    const tel = screen.getByRole('link', { name: '+44 987-654-3210' });
    expect(tel.getAttribute('href')).toBe('tel:+449876543210');
    expect(container.querySelectorAll('form, input, textarea')).toHaveLength(0);
  });
  it('contact is laid out as labelled rows (Email, Telephone)', () => {
    const { container } = render(<About />);
    expect([...container.querySelectorAll('.about-contact dt')].map(e => e.textContent)).toEqual(['Email', 'Telephone']);
  });
  it('no placeholder text is left', () => {
    const { container } = render(<About />);
    expect(container.textContent).not.toMatch(/\[placeholder\]/i);
    expect(JSON.stringify(about)).not.toMatch(/\[placeholder\]/i);
  });
  it('editing the content changes the output with no code change', () => {
    const edited: AboutContent = { ...about, tagline: 'Real tagline.', howItWorks: { ...about.howItWorks, steps: ['One real step.'] },
      contact: { ...about.contact, email: 'ask@shipco.example', phoneLink: '+441234' } };
    const { container } = render(<About content={edited} />);
    const t = container.textContent!;
    expect(t).toContain('Real tagline.');
    expect(t).not.toContain('Catch shipping mistakes');
    expect(container.querySelectorAll('ol.about-steps > li')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'ask@shipco.example' }).getAttribute('href')).toBe('mailto:ask@shipco.example');
    expect(screen.getByRole('link', { name: '+44 987-654-3210' }).getAttribute('href')).toBe('tel:+441234');
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
  it('passes on the real content file now that the dummy text is gone', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('No [Placeholder] strings left');
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
