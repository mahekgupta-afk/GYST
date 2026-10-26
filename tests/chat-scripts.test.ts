// The five chat scripts from the judging brief, run against the built-in parser only (no AI), with every reply printed.
// A reply must come back well under 2 s: the parser and the rulebook are synchronous and local.
import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { PF, C } from '../lib/pf';
import { composeReply, type Prev } from '../lib/chatReply';

const TODAY = '2026-10-26';
const transcript: string[] = [];

function session(title: string) {
  let c = C.newChat();
  let prev: Prev = null;
  transcript.push('', '=== ' + title + ' ===');
  const send = (text: string) => {
    const t0 = performance.now();
    const snap = C.cloneChat(c);
    const log = C.step(c, text, { todayISO: TODAY });
    const out = composeReply(c, log, snap, prev);
    prev = out.prev;
    const ms = performance.now() - t0;
    const shown = out.reply.text + (out.reply.needs ? '\n' + out.reply.needs.map((n: string, i: number) => (i + 1) + '. ' + n).join('\n') : '');
    transcript.push('YOU: ' + text, 'BOT: ' + shown.replace(/\n/g, '\n     '), '     [' + ms.toFixed(1) + ' ms]');
    expect(ms).toBeLessThan(2000);
    return { ...out, ev: c.asked ? null : PF.evaluate(c.b, { todayISO: TODAY }), asked: c.asked, c };
  };
  return { send, chat: () => c };
}

const NORTHFIELD = 'I’m Northfield Goods. Sending 1,080 ceramic mugs from Manchester to a warehouse in Frankfurt, 3 pallets, ready 20-11-2026. £5 each, 12 per carton, 0.5 kg each, HS 691200, made in the UK. Appointment is booked, cheapest please.';
const IRON = 'Iron Co, 200 skillets, Leeds to Berlin warehouse, slot booked, ready 30-11-2026, fastest please, £22 each, 4 per carton, 50 cartons, 2.6 kg each, HS 732391, made in UK, that’s all, 1 pallet, 620 kg, declared £4,400';
const BLOOM = 'We’re Bloom Beauty. 240 bottles of eau de parfum 50ml going from London to Paris, warehouse, no slot yet, ready tomorrow, most reliable. £22 each, 24 per carton, 0.25kg each, HS 330300, made in Germany. Only one product. 1 pallet, 10 cartons, 80kg, £5,280';

describe('chat scripts, built-in parser only', () => {
  it('1. Northfield → "that’s everything" → "90 cartons, 620 kg, £5,400" completes: clear, Carrier A £540', () => {
    const s = session('1. Northfield happy path');
    s.send(NORTHFIELD);
    s.send('that’s everything');
    const r = s.send('90 cartons, 620 kg, £5,400');
    expect(r.asked).toBeNull();
    expect(r.ev.status).toBe('clear');
    expect(r.ev.rec.selected.carrier).toBe('Carrier A');
    expect(r.ev.rec.selected.price * r.ev.rec.pallets).toBe(540);
    expect(r.c.b.declaredValue).toBe(5400);
    expect(r.reply.text).toContain('all ten rules pass');
  });

  it('2. then "add a pallet" → "change priority to fastest" → "confirm": 4 pallets, Carrier C, before/after at each step, confirm works', () => {
    const s = session('2. Changes after completion, then confirm');
    s.send(NORTHFIELD); s.send('that’s everything'); s.send('90 cartons, 620 kg, £5,400');
    const a = s.send('add a pallet');
    expect(s.chat().b.pallets).toBe(4);
    expect(a.reply.text).toMatch(/Checks re-run: 0 red, 0 amber \(was 0 and 0\)\. Carrier A and £720 are unchanged\.|Carrier A, £540 → £720/);
    const f = s.send('change priority to fastest');
    expect(s.chat().b.priority).toBe('Fastest');
    expect(f.reply.text).toContain('Carrier A → Carrier C, £720 → £1,360');
    const k = s.send('confirm');
    expect(k.book).toBe(true);
    expect(k.reply.text).toContain('Booking it with Carrier C');
  });

  it('3. Iron Co: R-05 red against Carrier C, with switch-to-B and re-palletise fixes', () => {
    const s = session('3. Iron Co, too heavy for the fastest carrier');
    const r = s.send(IRON);
    expect(r.asked).toBeNull();
    const i = r.ev.issues.find((x: any) => x.rule === 'R-05');
    expect(i.sev).toBe('red');
    expect(i.what).toContain('620 kg per pallet; Carrier C (fastest) takes max 400 kg.');
    expect(i.fix).toContain('Switch to Carrier B');
    expect(i.fix).toMatch(/over 2 pallets \(£680, 310 kg each\)/);
    expect(r.reply.text).toContain('R-05');
  });

  it('4. Bloom Beauty: R-06 red (perfume) and R-08 amber', () => {
    const s = session('4. Bloom Beauty, perfume and no appointment');
    const r = s.send(BLOOM);
    expect(r.asked).toBeNull();
    const rules = Object.fromEntries(r.ev.issues.map((i: any) => [i.rule, i.sev]));
    expect(rules['R-06']).toBe('red');
    expect(rules['R-08']).toBe('amber');
    expect(r.c.b.items[0].desc).toMatch(/eau de parfum 50\s?ml/i);
    expect(r.c.b.seller).toBe('Bloom Beauty');
  });

  it('5. "We are shipping from Glasgow to Madrid" names both as unsupported and asks again', () => {
    const s = session('5. Unsupported places');
    const r = s.send('We are shipping from Glasgow to Madrid');
    expect(r.reply.text).toContain('Glasgow');
    expect(r.reply.text).toContain('Madrid');
    expect(r.reply.text).toContain('Sorry, I can’t book Glasgow (we collect from London, Manchester, Birmingham and Leeds)');
    expect(r.reply.text).toContain('Sorry, I can’t book Madrid (we deliver to Germany');
    expect(r.reply.text).not.toMatch(/didn’t catch/);
    expect(r.asked).not.toBeNull();
  });
});

describe('parser details from the brief', () => {
  const run = (...msgs: string[]) => { const s = session('details: ' + msgs[0].slice(0, 40)); let r: any; for (const m of msgs) r = s.send(m); return { r, b: s.chat().b }; };
  it.each([['£5,400', 5400], ['5400 pounds', 5400], ['£5.4k', 5400], ['5,400 GBP', 5400]])('a bare amount “%s” is the declared value when totals are asked', (money, v) => {
    const { b } = run(NORTHFIELD, 'that’s everything', '90 cartons, 620 kg, ' + money);
    expect(b.declaredValue).toBe(v);
    expect(b.items[0].price).toBe(5);
  });
  it('a unit price needs “each” or “per”: “£6 each” changes the price, not the declared value', () => {
    const { b } = run(NORTHFIELD, 'that’s everything', '90 cartons, 620 kg, £5,400', 'actually the mugs are £6 each');
    expect(b.items[0].price).toBe(6);
    expect(b.declaredValue).toBe(5400);
  });
  it('“each one weighs 350 g” is 0.35 kg', () => {
    const s = session('grams'); s.send('Acme Ltd, 100 candles from Leeds to Paris warehouse, appointment booked, ready 05-11-2026, cheapest, £4 each, 10 per carton');
    s.send('each one weighs 350 g');
    expect(s.chat().b.items[0].unitWeight).toBe(0.35);
  });
  it('“350 g” as a short answer to the weight question is 0.35 kg', () => {
    const s = session('grams, short'); s.send('Acme Ltd, 100 candles from Leeds to Paris warehouse, appointment booked, ready 05-11-2026, cheapest, £4 each, 10 per carton, HS 340600, made in UK');
    expect(s.chat().asked.key).toBe('item.weight');
    s.send('350 g');
    expect(s.chat().b.items[0].unitWeight).toBe(0.35);
  });
  it('“HS 8518” is captured and then flagged by R-01', () => {
    const s = session('hs 8518'); s.send('Acme Ltd, 100 speakers from Leeds to Paris warehouse, appointment booked, ready 05-11-2026, cheapest, £4 each, 10 per carton, 0.5 kg each, HS 8518, made in China');
    expect(s.chat().b.items[0].hs).toBe('8518');
    s.send('that’s everything');
    const r = s.send('1 pallet, 10 cartons, 60 kg, £400');
    expect(r.ev.issues.some((i: any) => i.rule === 'R-01' && i.sev === 'red')).toBe(true);
  });
  it.each([['Hexa Gadgets here, 300 phone chargers from London to Berlin warehouse', 'Hexa Gadgets'], ['Tiny Co, 100 candles from Leeds to Paris', 'Tiny Co']])('an opener sets the seller: %s', (msg, name) => {
    const { b } = run(msg);
    expect(b.seller).toBe(name);
  });
  it('“confirm” while details are missing says what is still needed', () => {
    const s = session('confirm too early'); s.send(NORTHFIELD);
    const r = s.send('confirm');
    expect(r.reply.text).toMatch(/can’t book it yet/);
    expect(r.book).toBe(false);
  });
  it('a short reply answers the question just asked', () => {
    const s = session('short replies'); s.send('hi I need to ship some stuff to germany');
    s.send('Acme Ltd'); expect(s.chat().b.seller).toBe('Acme Ltd');
  });
});

afterAll(() => { writeFileSync(process.env.CHAT_TRANSCRIPT || 'chat-transcript.txt', transcript.join('\n') + '\n'); });
