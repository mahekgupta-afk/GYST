// HS code verification: the four states (verified, 6 digits only, not found, could not verify), with the tariff's responses mocked.
// R-01 is untouched; these tests also prove the lookup never changes a rule result.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { PF } from '../lib/pf';
import { classify, parseHeading, descriptionLooksOff, digitsOf, hsMessage, shortText } from '../lib/hs';
import { verifyCode, searchCodes, headingFor, clearTariffCache } from '../lib/server/tariff';
import { GET } from '../app/api/hs/route';

const fixture = (n: string) => JSON.parse(readFileSync('tests/fixtures/' + n, 'utf8'));
const HEADING = parseHeading(fixture('tariff-heading-6912.json'))!;
const json = (body: any, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
let calls: string[];
const stubTariff = (handler: (url: string) => Promise<Response> | null) => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn((url: string) => { calls.push(String(url)); const r = handler(String(url)); return r ?? json({ errors: [{ detail: 'not found' }] }, 404); }));
};
const normal = (url: string) => url.endsWith('/headings/6912') ? json(fixture('tariff-heading-6912.json')) : url.includes('/search?q=lamp') ? json(fixture('tariff-search-lamp.json')) : null;
beforeEach(() => clearTariffCache());
afterEach(() => vi.unstubAllGlobals());

describe('reading the tariff response', () => {
  it('parses the heading and its commodities, keeping which are declarable', () => {
    expect(HEADING.id).toBe('6912');
    expect(HEADING.description).toMatch(/Ceramic tableware/);
    expect(HEADING.commodities.length).toBe(24);
    expect(HEADING.commodities.find(c => c.code === '6912002111' && c.leaf)).toBeTruthy();
    expect(HEADING.commodities.find(c => c.code === '6912002100' && c.suffix === '10')!.leaf).toBe(false);
  });
  it('rejects a response that is not in the expected shape', () => { expect(parseHeading({})).toBeNull(); expect(parseHeading(null)).toBeNull(); expect(parseHeading({ data: { attributes: {} } })).toBeNull(); });
});

describe('a heading that is itself the commodity (such as 8206)', () => {
  const H = parseHeading(fixture('tariff-heading-8206.json'))!;
  it('is read as one declarable code', () => { expect(H.commodities).toEqual([expect.objectContaining({ code: '8206000000', leaf: true })]); });
  it('its 6-digit form is "6 digits only" with the full code to pick, and its full code verifies', () => {
    const six = classify('820600', H); expect(six.state).toBe('six-digits'); expect(six.children.map(c => c.code)).toEqual(['8206000000']);
    expect(classify('8206000000', H).state).toBe('verified');
    expect(classify('820699', H).state).toBe('not-found');
  });
});

describe('the verification states', () => {
  it('verified: a full declarable 10-digit code, with its official description', () => {
    const r = classify('6912002111', HEADING);
    expect(r.state).toBe('verified');
    expect(r.description).toMatch(/^Ceramic tableware.* › .*Of common pottery.* › .*Hand-made.* › .*Tableware and kitchenware/i);
    expect(hsMessage(r)).toBe('Found in the UK Tariff.');
  });
  it('accepts spaces and dots in a code', () => { expect(classify('6912.00 2111', HEADING).state).toBe('verified'); expect(digitsOf(' 6912.00 2111 ')).toBe('6912002111'); });
  it('6 digits only: real, but a full commodity code is usually needed, with suggestions to pick from', () => {
    const r = classify('691200', HEADING);
    expect(r.state).toBe('six-digits');
    expect(r.children.length).toBeGreaterThan(5);
    expect(r.children.every(c => /^6912\d{6}$/.test(c.code))).toBe(true);
    expect(hsMessage(r)).toContain('6-digit code');
    expect(hsMessage(r)).toContain('8 to 10 digit');
  });
  it('an 8-digit code that exists is partial; its suggestions are the full codes under it', () => {
    const r = classify('69120023', HEADING);
    expect(r.state).toBe('partial');
    expect(r.children.map(c => c.code)).toEqual(['6912002310', '6912002390']);
  });
  it('a 10-digit code that exists but is not declarable is partial', () => { expect(classify('6912002100', HEADING).state).toBe('partial'); });
  it('not found: the heading exists but the code does not, or the heading does not exist at all', () => {
    expect(classify('691299', HEADING).state).toBe('not-found');
    expect(classify('6912009999', HEADING).state).toBe('not-found');
    expect(classify('999999', null).state).toBe('not-found');
    expect(classify('123456789012', HEADING).state).toBe('not-found');
    expect(classify('69A200', HEADING).state).toBe('not-found');
  });
  it('could not verify: the tariff could not be reached', () => { const r = classify('691200', undefined); expect(r.state).toBe('unavailable'); expect(hsMessage(r)).toContain('does not affect your booking'); });
  it('a code that is too short is flagged as short, and a blank code is blank', () => { expect(classify('6912', HEADING).state).toBe('short'); expect(classify('69', null).state).toBe('short'); expect(classify('', null).state).toBe('blank'); });
});

describe('through the tariff (mocked)', () => {
  it('verifies, with caching by heading', async () => {
    stubTariff(normal);
    expect((await verifyCode('6912002111')).state).toBe('verified');
    expect((await verifyCode('691200')).state).toBe('six-digits');
    expect(calls.filter(u => u.endsWith('/headings/6912'))).toHaveLength(1);       // the second answer came from the cache
  });
  it('a heading the tariff does not have is "not found" (a 404 is remembered too)', async () => {
    stubTariff(normal);
    expect((await verifyCode('999999')).state).toBe('not-found');
    expect((await verifyCode('999912')).state).toBe('not-found');
    expect(calls.filter(u => u.endsWith('/headings/9999'))).toHaveLength(1);
  });
  it('the tariff being down, slow or odd gives "could not verify", never an error', async () => {
    stubTariff(() => Promise.reject(new TypeError('fetch failed')));
    expect((await verifyCode('691200')).state).toBe('unavailable');
    stubTariff(() => json({ errors: [] }, 503)); clearTariffCache();
    expect((await verifyCode('691200')).state).toBe('unavailable');
    stubTariff(() => json({ nonsense: true })); clearTariffCache();
    expect((await verifyCode('691200')).state).toBe('unavailable');
    // a failure is not cached: the next call tries again
    stubTariff(normal);
    expect((await verifyCode('691200')).state).toBe('six-digits');
  });
  it('gives up after a short time when the tariff is slow', async () => {
    vi.useFakeTimers();
    stubTariff(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', vi.fn((_u: string, init: any) => new Promise((_res, rej) => { init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); })));
    const p = verifyCode('691200');
    await vi.advanceTimersByTimeAsync(5100);
    expect((await p).state).toBe('unavailable');
    vi.useRealTimers();
  });
  it('suggests codes from a description, headings and commodities, without duplicates', async () => {
    stubTariff(normal);
    const r = await searchCodes('lamp');
    expect(r.ok).toBe(true);
    expect(r.suggestions.length).toBeGreaterThan(2); expect(r.suggestions.length).toBeLessThanOrEqual(6);
    expect(new Set(r.suggestions.map(s => s.code)).size).toBe(r.suggestions.length);
    expect(r.suggestions.some(s => s.kind === 'heading' && s.code === '8539')).toBe(true);
    expect(r.suggestions.every(s => s.title.length > 0)).toBe(true);
  });
  it('an exact match on a heading is resolved to that heading with its official description', async () => {
    stubTariff(url => url.includes('/search?q=mug') ? json({ data: { attributes: { type: 'exact_match', entry: { endpoint: 'headings', id: '6912' } } } }) : normal(url));
    const r = await searchCodes('mug');
    expect(r.suggestions).toEqual([{ code: '6912', kind: 'heading', title: HEADING.description }]);
  });
  it('a description that finds nothing is retried with its last words', async () => {
    stubTariff(url => url.includes('q=cotton%20tote%20bag') || url.includes('q=tote%20bag') ? json({ data: { attributes: { type: 'fuzzy_match', reference_match: { headings: [], commodities: [] }, goods_nomenclature_match: { headings: [], commodities: [] } } } })
      : url.includes('q=bag') ? json({ data: { attributes: { type: 'fuzzy_match', reference_match: { headings: [{ _source: { title: 'handbags', reference: { goods_nomenclature_item_id: '4202000000' } } }], commodities: [] }, goods_nomenclature_match: { headings: [], commodities: [] } } } }) : normal(url));
    const r = await searchCodes('cotton tote bag');
    expect(r.suggestions).toEqual([{ code: '4202', kind: 'heading', title: 'handbags' }]);
    expect(calls.map(u => decodeURIComponent(u.split('q=')[1]))).toEqual(['cotton tote bag', 'tote bag', 'bag']);
  });
  it('cuts long official wording at a word for display', () => {
    const long = 'Tableware and kitchenware, excluding condiment or spice mills and their ceramic grinding parts, coffee mills, knife sharpeners, sharpeners, kitchen tools to be used for cutting, grinding';
    const t = shortText(long, 80);
    expect(t.length).toBeLessThanOrEqual(81); expect(t.endsWith('…')).toBe(true); expect(long.startsWith(t.slice(0, -1))).toBe(true);
    expect(shortText('short', 80)).toBe('short');
  });
  it('a failed search says so rather than throwing', async () => {
    stubTariff(() => Promise.reject(new Error('down')));
    expect(await searchCodes('anything')).toEqual({ ok: false, suggestions: [] });
  });
});

describe('the /api/hs route', () => {
  const ask = (qs: string) => GET(new Request('http://x/api/hs?' + qs));
  it('verifies a code and caches the answer', async () => {
    stubTariff(normal);
    const res = await ask('code=6912002111'); const j = await res.json();
    expect(res.status).toBe(200); expect(j.result.state).toBe('verified'); expect(res.headers.get('Cache-Control')).toMatch(/max-age/);
  });
  it('still answers 200 with "unavailable" when the tariff is down', async () => {
    stubTariff(() => Promise.reject(new Error('down')));
    const res = await ask('code=691200'); expect(res.status).toBe(200); expect((await res.json()).result.state).toBe('unavailable');
  });
  it('searches, and refuses bad input', async () => {
    stubTariff(normal);
    expect((await (await ask('q=lamp')).json()).suggestions.length).toBeGreaterThan(0);
    for (const qs of ['', 'q=a', 'q=' + 'x'.repeat(81), 'code=abc', 'code=' + '1'.repeat(15)]) expect((await ask(qs)).status, qs).toBe(400);
  });
  it('sends only the code or the words on to the tariff', async () => {
    stubTariff(normal);
    await ask('code=6912002111&seller=Secret&booking=1');
    expect(calls).toEqual(['https://www.trade-tariff.service.gov.uk/api/v2/headings/6912']);
  });
});

describe('the soft description check', () => {
  it('stays quiet when the description and the official wording share something', () => {
    expect(descriptionLooksOff('Ceramic coffee mug, 350 ml', 'Ceramic tableware, kitchenware, other household articles')).toBe(false);
    expect(descriptionLooksOff('Soy wax candle', 'Candles, tapers and the like')).toBe(false);
    expect(descriptionLooksOff('Cotton tote bag', 'Trunks, suitcases, handbags and similar containers')).toBe(false);
  });
  it('warns, softly, when they have nothing in common', () => {
    expect(descriptionLooksOff('Lithium power bank', 'Ceramic tableware, kitchenware, other household articles')).toBe(true);
    expect(descriptionLooksOff('Garden lamp', 'Live animals')).toBe(true);
  });
  it('never warns without both texts', () => { expect(descriptionLooksOff('', 'Anything')).toBe(false); expect(descriptionLooksOff('Mug', null)).toBe(false); });
});

describe('R-01 is untouched', () => {
  it('a 6-digit code still passes R-01 and a 5-digit code still fails it, whatever the tariff says', () => {
    const b = PF.bookingsFromTables(...(Object.values(PF.sampleTables(PF.todayISO())) as [any, any])).bookings.find((x: any) => x.id === 'BK-001');
    b.items[0].hs = '999999';                                            // a code that is not in the tariff
    expect(PF.evaluate(b).issues.filter((i: any) => i.rule === 'R-01')).toEqual([]);
    b.items[0].hs = '69120';
    expect(PF.evaluate(b).issues.filter((i: any) => i.rule === 'R-01')).toHaveLength(1);
  });
});
