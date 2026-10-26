// Suggested fixes for a failed rule, and a safe way to preview them.
// Nothing here judges a booking: a fix is a list of ordinary corrections (the same `Spec`s the editor already applies),
// and the unchanged rules engine decides the result. Fixes are offered only where the right answer is unambiguous, or as
// a short list of choices the user picks from; R-01 (apart from a lost leading zero), R-06 (beyond removing the item), R-08 and R-09 need facts only the user has.
import { PF } from './pf';
import { applyChange, suggestions, itemFlags, type Spec, type Change } from './fixes';

export type FixOption = {
  id: string;
  label: string;
  specs: Spec[];
  ghost?: boolean;        // an alternative to the main suggestion
};

const name = (it: any) => it.sku || it.desc || 'this item';
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The one-click suggestions for an issue. Each is only a proposal: the UI previews it and asks before applying. */
export function fixOptions(b: any, ev: any, issue: any): FixOption[] {
  const s = suggestions(b), rec = ev.rec, rule = issue.rule as string;
  const items: any[] = b.items || [];
  const rows = (pred: (it: any) => boolean) => items.map((_, i) => i).filter(i => (issue.item ? items[i].sku === issue.item : !items[i].sku) && pred(items[i]));
  const out: FixOption[] = [];

  if (rule === 'R-02' || (rule === 'DATA' && /Declared value missing/.test(issue.title))) {
    if (s.itemsValue > 0) out.push({ id: 'value-from-items', label: 'Set declared value to ' + PF.gbp(s.itemsValue) + ' (what the items add up to)', specs: [{ kind: 'set', field: 'declaredValue', value: s.itemsValue, rule }] });
  } else if (rule === 'R-03') {
    rows(it => itemFlags(it).cartonMath).forEach(i => {
      const it = items[i], who = rows(() => true).length > 1 ? ' for ' + name(it) : '';
      if (it.upc > 0 && Number.isInteger(it.qty / it.upc)) out.push({ id: 'cartons-' + i, label: 'Set cartons to ' + it.qty / it.upc + ' (quantity ÷ per carton)' + who, specs: [{ kind: 'set', field: 'cartons', value: it.qty / it.upc, itemIndex: i, rule }] });
      if (it.upc * it.cartons > 0) out.push({ id: 'qty-' + i, label: 'Set quantity to ' + (it.upc * it.cartons).toLocaleString('en-GB') + ' (per carton × cartons)' + who, ghost: true, specs: [{ kind: 'set', field: 'qty', value: it.upc * it.cartons, itemIndex: i, rule }] });
      if (it.cartons > 0 && Number.isInteger(it.qty / it.cartons)) out.push({ id: 'upc-' + i, label: 'Set units per carton to ' + it.qty / it.cartons + ' (quantity ÷ cartons)' + who, ghost: true, specs: [{ kind: 'set', field: 'upc', value: it.qty / it.cartons, itemIndex: i, rule }] });
    });
  } else if (rule === 'R-04') {
    if (s.itemsCartons > 0 && s.itemsCartons !== b.cartons) out.push({ id: 'cartons-sum', label: 'Set total cartons to ' + s.itemsCartons + ' (what the items add up to)', specs: [{ kind: 'set', field: 'cartons', value: s.itemsCartons, rule }] });
  } else if (rule === 'R-05') {
    const sel = rec.selected;
    if (!rec.recommended) {
      // No carrier can take the load as it is: more pallets, with any carrier, each shown with its price.
      const byCost = rec.options.slice().sort((x: any, y: any) => x.minCost - y.minCost);
      byCost.forEach((o: any, n: number) => {
        if (o.minPallets) out.push({ id: 'pallets-' + o.carrier, ghost: n > 0, label: 'Use ' + o.minPallets + ' pallets with ' + o.carrier + ' (' + PF.gbp(o.minCost) + ')',
          specs: [{ kind: 'carrier', carrier: o.carrier, rule }, { kind: 'set', field: 'pallets', value: o.minPallets, rule }] });
      });
    } else {
      if (rec.recommended.carrier !== sel.carrier) out.push({ id: 'switch-' + rec.recommended.carrier, label: 'Switch to ' + rec.recommended.carrier + ' (' + PF.gbp(rec.recommended.price * rec.pallets) + ')', specs: [{ kind: 'carrier', carrier: rec.recommended.carrier, rule }] });
      if (sel.minPallets && sel.minPallets !== b.pallets) out.push({ id: 'pallets-' + sel.carrier, ghost: true, label: 'Use ' + sel.minPallets + ' pallets with ' + sel.carrier + ' (' + PF.gbp(sel.minPallets * sel.price) + ')', specs: [{ kind: 'set', field: 'pallets', value: sel.minPallets, rule }] });
    }
  } else if (rule === 'R-01') {
    // A code such as 90240 that lost its leading zero (a spreadsheet read it as a number): offer 090240 in one click.
    const z = issue.autofix;
    if (z && z.item != null && items[z.item]) out.push({ id: 'hs-zero-' + z.item, label: z.label, specs: [{ kind: 'set', field: 'hs', value: z.set.hs, itemIndex: z.item, rule }] });
  } else if (rule === 'R-06') {
    rows(it => !!PF.hazardOf(it)).forEach(i => out.push({ id: 'remove-' + i, label: 'Remove ' + name(items[i]) + ' from this shipment', specs: [{ kind: 'remove', itemIndex: i, rule }] }));
  } else if (rule === 'R-07') {
    if (s.itemsWeight > 0 && (typeof b.grossWeight !== 'number' || b.grossWeight < s.itemsWeight)) out.push({ id: 'weight-min', label: 'Raise gross weight to ' + s.itemsWeight + ' kg (the goods alone; add packaging and pallets if you can)', specs: [{ kind: 'set', field: 'grossWeight', value: s.itemsWeight, rule }] });
  } else if (rule === 'R-08') {
    out.push({ id: 'appointment', label: 'A delivery appointment is booked', specs: [{ kind: 'set', field: 'appointment', value: 'Yes', rule }] });
  } else if (rule === 'R-10') {
    out.push({ id: 'date-today', label: 'Collect today (' + PF.dmy(PF.todayISO()) + ')', specs: [{ kind: 'set', field: 'readyDate', value: PF.todayISO(), rule }] });
  }
  return out;
}

export type FixPreview =
  | { ok: false; message: string }
  | {
    ok: true;
    rows: Change[];                                         // exactly what will be logged: scope, field, was, now
    before: { status: string; red: number; amber: number; open: string[] };
    after: { status: string; red: number; amber: number; open: string[] };
    fixed: string[];                                        // rules that were open and are not any more
    newProblems: string[];                                  // rules that were not open and are now
    price: { before: number | null; after: number | null };
  };

const open = (ev: any): string[] => Array.from(new Set<string>(ev.issues.map((i: any) => i.rule)));
const total = (ev: any): number | null => (ev.rec.blocked || !ev.rec.selected || !ev.rec.pallets ? null : ev.rec.selected.price * ev.rec.pallets);

/** Applies the fix to a COPY of the booking and reports what would change. The real booking is never touched. */
export function previewFix(b: any, specs: Spec[]): FixPreview {
  const before = PF.evaluate(b);
  const copy = JSON.parse(JSON.stringify(b));
  const had = (copy._changes || []).length;
  for (const sp of specs) { const r = applyChange(copy, sp); if (!r.ok) return { ok: false, message: r.message }; }
  const after = PF.evaluate(copy);
  const o1 = open(before), o2 = open(after);
  return {
    ok: true,
    rows: (copy._changes || []).slice(had),
    before: { status: before.status, red: before.counts.red, amber: before.counts.amber, open: o1 },
    after: { status: after.status, red: after.counts.red, amber: after.counts.amber, open: o2 },
    fixed: o1.filter(r => !o2.includes(r)),
    newProblems: o2.filter(r => !o1.includes(r)),
    price: { before: total(before), after: total(after) },
  };
}

export const money = (n: number | null) => (n === null ? '—' : PF.gbp(round2(n)));
