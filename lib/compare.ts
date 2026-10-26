// "Compare carriers for a shipment". Presentation of the SAME recommend() the booking and upload flows use:
// nothing here ranks, filters or prices a carrier itself. Inputs are checked by the shared validators (lib/validate.ts).
import { PF } from './pf';
import { checkNumber, inputErrorText } from './validate';

export const PRIORITY_LIST: string[] = PF.PRIORITIES;
// The routes come from the rate card itself, so a route can never be offered that has no carriers.
export const DEST_LIST: string[] = Array.from(new Set<string>(PF.CARRIERS.map((c: any) => c.dest)));

export type CompareInput = { dest: string; pallets: string; weight: string; priority: string };
export type CarrierRow = {
  carrier: string; service: string; price: number; transit: number; ontime: number; maxKg: number;
  total: number; wpp: number; fits: boolean; spare: number; over: number; minPallets: number; minCost: number; recommended: boolean; score: number | null;
};
export type Comparison = {
  rows: CarrierRow[];
  none: boolean;                                       // no carrier on the route can take the load
  winner: CarrierRow | null;
  reason: string;
  winners: { priority: string; carrier: string | null }[];
  scores: { carrier: string; score: number }[];        // Balanced, across the carriers that fit
  pallets: number; weight: number; wpp: number; priority: string; dest: string;
};
export type CompareResult = { errors: { pallets?: string; weight?: string }; comparison: Comparison | null };

export function compare(i: CompareInput): CompareResult {
  const errors: { pallets?: string; weight?: string } = {};
  const p = checkNumber('pallets', i.pallets), w = checkNumber('grossWeight', i.weight);
  if (!p.ok && p.reason !== 'blank') errors.pallets = inputErrorText('pallets', p);
  if (!w.ok && w.reason !== 'blank') errors.weight = inputErrorText('grossWeight', w);
  if (!p.ok || !w.ok) return { errors, comparison: null };

  const book = (priority: string) => ({ destCountry: i.dest, pallets: p.value, grossWeight: w.value, priority });
  const rec = PF.recommend(book(i.priority));
  const bal = PF.recommend(book('Balanced'));
  const scoreOf = (carrier: string) => { const o = bal.options.find((x: any) => x.carrier === carrier); return o && o.eligible && typeof o.score === 'number' ? o.score : null; };
  const rows: CarrierRow[] = rec.options.map((o: any) => ({
    carrier: o.carrier, service: o.service, price: o.price, transit: o.transit, ontime: o.ontime, maxKg: o.maxKg,
    total: o.cost, wpp: rec.wpp, fits: o.eligible, spare: o.maxKg - rec.wpp, over: rec.wpp - o.maxKg,
    minPallets: o.minPallets, minCost: o.minCost, recommended: !!rec.recommended && rec.recommended.carrier === o.carrier, score: scoreOf(o.carrier),
  }));
  const winner = rows.find(r => r.recommended) || null;
  const winners = PRIORITY_LIST.map(pr => { const r = PF.recommend(book(pr)).recommended; return { priority: pr, carrier: r ? r.carrier : null }; });
  const scores = rows.filter(r => r.score !== null).map(r => ({ carrier: r.carrier, score: r.score as number })).sort((a, b) => b.score - a.score);
  return { errors, comparison: { rows, none: !rec.recommended, winner, reason: winner ? reasonLine(i.priority, winner, rows, scores) : '', winners, scores, pallets: p.value, weight: w.value, wpp: rec.wpp, priority: i.priority, dest: i.dest } };
}

function reasonLine(priority: string, w: CarrierRow, rows: CarrierRow[], scores: { carrier: string; score: number }[]): string {
  const fit = rows.filter(r => r.fits).length;
  const only = fit === 1 ? ' It is the only carrier that can take this load.' : '';
  if (priority === 'Cheapest') return `Lowest total price of the carriers that can take this load: ${PF.gbp(w.total)} (${PF.gbp(w.price)} a pallet).${only}`;
  if (priority === 'Fastest') return `Fewest days in transit of the carriers that can take this load: ${w.transit} days.${only}`;
  if (priority === 'Most reliable') return `Best on-time record of the carriers that can take this load: ${w.ontime}%.${only}`;
  const s = scores.find(x => x.carrier === w.carrier);
  return `Highest Balanced score of the carriers that can take this load${s ? ': ' + s.score.toFixed(2) : ''}.${only}`;
}
