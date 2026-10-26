// Suggested fixes: offered only where they make sense, previewed on a copy, and each one makes its own rule pass.
import { describe, it, expect } from 'vitest';
import { PF } from '../lib/pf';
import { applyChange } from '../lib/fixes';
import { fixOptions, previewFix } from '../lib/autofix';

const all = () => PF.bookingsFromTables(...(Object.values(PF.sampleTables(PF.todayISO())) as [any, any])).bookings as any[];
const clean = () => JSON.parse(JSON.stringify(all().find((b: any) => b.id === 'BK-001')));
const ev = (b: any) => PF.evaluate(b);
const issuesOf = (b: any, rule: string) => ev(b).issues.filter((i: any) => i.rule === rule);
const optionsFor = (b: any, rule: string) => { const e = ev(b); return issuesOf(b, rule).flatMap((i: any) => fixOptions(b, e, i)); };
const pv = (b: any, o: any) => { const p = previewFix(b, o.specs); if (!p.ok) throw new Error(p.message); return p; };

describe('the starting booking is clean', () => {
  it('BK-001 has no issues', () => expect(ev(clean()).issues).toEqual([]));
});

describe('each fix makes its own rule pass', () => {
  it('R-02 declared value: sets it to what the items add up to', () => {
    const b = clean(); b.declaredValue = 6000;
    const o = optionsFor(b, 'R-02');
    expect(o).toHaveLength(1);
    const p = pv(b, o[0]);
    expect(p.rows).toHaveLength(1);
    expect([p.rows[0].field, String(p.rows[0].from), String(p.rows[0].to)]).toEqual(['Total declared value (£)', '6000', '5400']);
    expect(p.fixed).toEqual(['R-02']);
    expect(p.newProblems).toEqual([]);
    expect(p.after.status).toBe('clear');
  });
  it('R-03 carton maths: offers every consistent choice, and each one fixes R-03', () => {
    const b = clean(); b.items[0].cartons = 60; b.items[0].upc = 12; b.items[0].qty = 1080;      // 12 × 60 = 720, not 1,080
    const o = optionsFor(b, 'R-03');
    expect(o.map((x: any) => x.id).sort()).toEqual(['cartons-0', 'qty-0', 'upc-0']);               // 1080 ÷ 12 = 90, 12 × 60 = 720, 1080 ÷ 60 = 18
    for (const x of o) { const p = pv(b, x); expect(p.fixed, x.id).toContain('R-03'); }
  });
  it('R-03: an option that would break another rule says so, honestly', () => {
    const b = clean(); b.items[0].cartons = 60;
    const qtyOpt = optionsFor(b, 'R-03').find((x: any) => x.id === 'qty-0')!;
    const p = pv(b, qtyOpt);                                  // quantity 720 no longer matches the declared value of 5,400
    const really = (() => { const c = JSON.parse(JSON.stringify(b)); qtyOpt.specs.forEach((s: any) => applyChange(c, s)); return ev(c).issues.map((i: any) => i.rule); })();
    expect(p.after.open.sort()).toEqual(Array.from(new Set(really)).sort());
    expect(p.newProblems).toContain('R-02');
  });
  it('R-03: a division that is not whole is not offered', () => {
    const b = clean(); b.items[0].cartons = 80;                                   // 1,080 ÷ 80 = 13.5
    expect(optionsFor(b, 'R-03').map((x: any) => x.id).sort()).toEqual(['cartons-0', 'qty-0']);
  });
  it('R-04 booking cartons: sets the total to the item cartons', () => {
    const b = clean(); b.cartons = 100;
    const o = optionsFor(b, 'R-04'); expect(o).toHaveLength(1);
    const p = pv(b, o[0]); expect(p.fixed).toEqual(['R-04']); expect(p.newProblems).toEqual([]); expect(String(p.rows[0].to)).toBe('90');
  });
  it('R-05 weight per pallet: with one carrier too small, offers a switch or more pallets, with the price impact', () => {
    const b = clean(); b.pallets = 2; b.grossWeight = 1500; b.items[0].qty = 1080; b.priority = 'Cheapest'; b._carrier = 'Carrier A';      // 750 kg a pallet, over A's 500 kg
    expect(issuesOf(b, 'R-05')).toHaveLength(1);
    const o = optionsFor(b, 'R-05').map((x: any) => x.id);
    expect(o).toEqual(expect.arrayContaining(['switch-Carrier B', 'pallets-Carrier A']));
    const sw = pv(b, optionsFor(b, 'R-05').find((x: any) => x.id === 'switch-Carrier B')!);
    expect(sw.fixed).toContain('R-05'); expect(sw.price.before).toBe(360); expect(sw.price.after).toBe(440);
    const pl = pv(b, optionsFor(b, 'R-05').find((x: any) => x.id === 'pallets-Carrier A')!);
    expect(pl.fixed).toContain('R-05'); expect(pl.price.after).toBe(540);                                                            // 3 pallets at £180
  });
  it('R-05 when no carrier can take the load: each carrier with the pallets it needs and its price', () => {
    const b = clean(); b.destCity = 'Lyon'; b.destCountry = 'France'; b.pallets = 4; b.grossWeight = 4000;
    const o = optionsFor(b, 'R-05');
    expect(o.map((x: any) => x.label)).toEqual(expect.arrayContaining(['Use 6 pallets with Carrier B (£1,260)', 'Use 8 pallets with Carrier A (£1,360)', 'Use 10 pallets with Carrier C (£3,300)']));
    for (const x of o) expect(pv(b, x).fixed, x.id).toContain('R-05');
  });
  it('R-07 gross weight: raises it to the weight of the goods', () => {
    const b = clean(); b.grossWeight = 400;                                       // goods alone weigh 540 kg
    const o = optionsFor(b, 'R-07'); expect(o).toHaveLength(1);
    const p = pv(b, o[0]); expect(p.fixed).toEqual(['R-07']); expect(p.newProblems).toEqual([]); expect(String(p.rows[0].to)).toBe('540');
  });
  it('R-10 past date: offers today, which passes', () => {
    const b = clean(); b.readyDate = PF.addDays(PF.todayISO(), -3);
    const o = optionsFor(b, 'R-10'); expect(o).toHaveLength(1);
    const p = pv(b, o[0]); expect(p.fixed).toEqual(['R-10']); expect(String(p.rows[0].to)).toBe(PF.todayISO());
  });
  it('R-08 appointment: the user confirms a fact only they know, and it is previewed too', () => {
    const b = clean(); b.destType = 'Warehouse'; b.appointment = 'No';
    const o = optionsFor(b, 'R-08'); expect(o).toHaveLength(1);
    expect(pv(b, o[0]).fixed).toEqual(['R-08']);
  });
  it('R-06 restricted goods: the only fix is removing the item, previewed first', () => {
    const b = clean(); b.items.push({ ...b.items[0], sku: 'SPRAY-1', desc: 'Aerosol deodorant spray', qty: 10, price: 1, upc: 10, cartons: 1, unitWeight: 0.1 }); b.cartons = 91; b.declaredValue = 5410;
    const o = optionsFor(b, 'R-06'); expect(o).toHaveLength(1);
    expect(o[0].label).toContain('Remove SPRAY-1');
    const p = pv(b, o[0]); expect(p.fixed).toContain('R-06');
  });
  it('R-01 HS code and R-09 country of origin are never auto-fixed: only the user knows them', () => {
    const b = clean(); b.items[0].hs = null; b.items[0].coo = null;
    expect(issuesOf(b, 'R-01')).toHaveLength(1); expect(issuesOf(b, 'R-09')).toHaveLength(1);
    expect(optionsFor(b, 'R-01')).toEqual([]);
    expect(optionsFor(b, 'R-09')).toEqual([]);
  });
});

describe('previews never change the booking', () => {
  it('the original booking and its change log are untouched until a fix is really applied', () => {
    const b = clean(); b.declaredValue = 6000;
    const snapshot = JSON.stringify(b);
    const o = optionsFor(b, 'R-02')[0];
    previewFix(b, o.specs);
    expect(JSON.stringify(b)).toBe(snapshot);
    expect(b._changes).toBeUndefined();
  });
  it('applying the fix for real gives exactly the previewed result, and logs before and after', () => {
    const b = clean(); b.declaredValue = 6000;
    const o = optionsFor(b, 'R-02')[0];
    const p = pv(b, o);
    o.specs.forEach((s: any) => applyChange(b, s));
    expect(ev(b).issues.map((i: any) => i.rule)).toEqual(p.after.open);
    expect(b._changes).toHaveLength(1);
    expect([b._changes[0].rule, String(b._changes[0].from), String(b._changes[0].to)]).toEqual(['R-02', '6000', '5400']);
  });
  it('an invalid value is refused in the preview, not applied', () => {
    const b = clean();
    const p = previewFix(b, [{ kind: 'set', field: 'pallets', value: 0, rule: 'R-05' }]);
    expect(p.ok).toBe(false);
  });
});

describe('over every sample and example booking', () => {
  it('each offered fix previews exactly what applying it really does, and fixes the rule it targets unless it says otherwise', () => {
    const examples = PF.bookingsFromTables(...(Object.values(PF.sampleTables(PF.todayISO())) as [any, any])).bookings as any[];
    let checked = 0;
    for (const b of examples) {
      const e = ev(b);
      for (const issue of e.issues) {
        for (const o of fixOptions(b, e, issue)) {
          const p = previewFix(b, o.specs);
          if (!p.ok) continue;
          const c = JSON.parse(JSON.stringify(b)); o.specs.forEach((s: any) => applyChange(c, s));
          expect(p.after.open.sort(), b.id + ' ' + o.id).toEqual(Array.from(new Set<string>(ev(c).issues.map((i: any) => i.rule))).sort());
          if (['R-02', 'R-04', 'R-07', 'R-10'].includes(issue.rule)) expect(p.fixed, b.id + ' ' + o.id).toContain(issue.rule);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(8);
  });
});
