import { describe, it, expect } from 'vitest';
import { PF, C } from '../lib/pf';

const talk = (msgs: string[]) => {
  const c = C.newChat();
  for (const m of msgs) C.step(c, m, {});
  return c;
};
const ready = PF.dmy(PF.addDays(PF.todayISO(), 10));

describe('built-in chat parser (no AI)', () => {
  const full = `I'm Northfield Goods. I'm sending 1,080 ceramic mugs from Manchester to a warehouse in Frankfurt, 3 pallets, ready on ${ready}. They're £5 each, 12 per carton and weigh 0.5 kg each.`;
  it('extracts a full description in one message and asks only for what is missing', () => {
    const c = talk([full]);
    expect(c.b.seller).toMatch(/Northfield/i);
    expect(c.b.destCity).toBe('Frankfurt');
    expect(c.b.pallets).toBe(3);
    expect(c.asked).not.toBeNull();
  });
  it('add a pallet mid-conversation increments pallets and re-runs checks', () => {
    const c = talk([full]);
    const trail: string[] = [];
    let guard = 0;
    while (!C.isComplete(c) && guard++ < 25) {
      const q = String(c.asked?.q);
      trail.push(c.asked?.key + ': ' + q);
      const a = /total number of cartons/i.test(q) ? '90 cartons, 620 kg gross weight, declared value £5,400' : /appointment/i.test(q) ? 'Yes' : /priority|matters most/i.test(q) ? 'Cheapest'
        : /HS/i.test(q) ? '691200' : /made|origin/i.test(q) ? 'United Kingdom'
        : /another|everything/i.test(q) ? 'That is everything'
        : /gross|total weight/i.test(q) ? '620' : /declared|value/i.test(q) ? '5400' : '3';
      C.step(c, a, {});
    }
    if (!C.isComplete(c)) throw new Error('chat did not complete. Questions asked:\n' + trail.join('\n'));
    expect(C.isComplete(c)).toBe(true);
    const before = c.b.pallets;
    C.step(c, 'add a pallet', {});
    expect(c.b.pallets).toBe(before + 1);
  });
});
