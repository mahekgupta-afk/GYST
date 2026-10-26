// The data behind the check report. Built only from what the rules engine already decided: this file judges nothing.
import { PF } from './pf';
import type { Change } from './fixes';

export type HsResultLite = { item: string; code: string; state: 'verified' | 'six-digits' | 'not-found' | 'unavailable' | 'blank'; description?: string | null; note?: string };

export type RuleRow = { id: string; text: string; sev: 'red' | 'amber'; result: 'Pass' | 'Amber' | 'Red' | 'Not checked'; problems: { title: string; what: string; fix: string; item: string | null }[] };
export type CarrierRowData = { carrier: string; service: string; pricePerPallet: number; total: number | null; transit: number; ontime: number; maxKg: number; fits: boolean | null; note: string; recommended: boolean };
export type BookingReport = {
  bookingId: string; reference: string | null; seller: string; route: string; readyDate: string | null;
  status: 'Ready' | 'Needs attention' | 'Blocked'; red: number; amber: number;
  rules: RuleRow[];
  otherProblems: { title: string; what: string; fix: string }[];       // input errors and missing data, which are not part of R-01..R-10
  hs: HsResultLite[];
  carrier: { priority: string; recommended: string | null; reason: string; rows: CarrierRowData[] };
  changes: { rule: string; scope: string; field: string; from: string; to: string }[];
};
export type FileReport = { fileName: string; bookings: BookingReport[]; counts: { total: number; ready: number; attention: number; blocked: number } };

export const REPORT_FOOTER = 'Checks run using GYST’s fixed rulebook. Guidance only, not legal or customs advice.';

const label = { clear: 'Ready', warning: 'Needs attention', blocked: 'Blocked' } as const;

export function buildBookingReport(b: any, ev: any, hs: HsResultLite[] = []): BookingReport {
  const rec = ev.rec;
  const rules: RuleRow[] = PF.RULES.map((r: any) => {
    const st = ev.ruleStatus[r.id];
    return {
      id: r.id, text: r.text, sev: r.sev,
      result: st === 'pass' ? 'Pass' : st === 'red' ? 'Red' : st === 'amber' ? 'Amber' : 'Not checked',
      problems: ev.issues.filter((i: any) => i.rule === r.id).map((i: any) => ({ title: i.title, what: i.what, fix: i.fix, item: i.item || null })),
    };
  });
  const total = (o: any) => (rec.pallets ? o.price * rec.pallets : null);
  const rows: CarrierRowData[] = (rec.options || []).map((o: any) => ({
    carrier: o.carrier, service: o.service, pricePerPallet: o.price, total: total(o), transit: o.transit, ontime: o.ontime, maxKg: o.maxKg,
    fits: rec.wpp === null ? null : o.eligible,
    note: rec.wpp === null ? '' : o.eligible ? 'Fits, ' + PF.nf(Math.round((o.maxKg - rec.wpp) * 100) / 100) + ' kg spare per pallet' : 'Over by ' + PF.nf(Math.round((rec.wpp - o.maxKg) * 100) / 100) + ' kg per pallet' + (o.minPallets ? '; ' + o.minPallets + ' pallets would fit at ' + PF.gbp(o.minCost) : ''),
    recommended: !!rec.recommended && rec.recommended.carrier === o.carrier,
  }));
  const rulePrefix = /^R-\d\d$/;
  return {
    bookingId: b.id || '(no ID)', reference: b._ref || null, seller: b.seller || 'unnamed seller',
    route: (b.originCity || 'UK') + ' to ' + (b.destCity || b.destCountry || '?'), readyDate: b.readyDate || null,
    status: label[ev.status as keyof typeof label], red: ev.counts.red, amber: ev.counts.amber,
    rules,
    otherProblems: ev.issues.filter((i: any) => !rulePrefix.test(i.rule)).map((i: any) => ({ title: i.title, what: i.what, fix: i.fix })),
    hs,
    carrier: { priority: rec.priority, recommended: rec.recommended ? rec.recommended.carrier + ' (' + rec.recommended.service + ')' : null, reason: rec.reason || '', rows },
    changes: ((b._changes || []) as Change[]).map(c => ({ rule: c.rule, scope: c.scope, field: c.field, from: String(c.from), to: String(c.to) })),
  };
}

export function buildFileReport(fileName: string, bookings: any[], hsFor: (b: any) => HsResultLite[] = () => []): FileReport {
  const reports = bookings.map(b => buildBookingReport(b, PF.evaluate(b), hsFor(b)));
  return {
    fileName, bookings: reports,
    counts: { total: reports.length, ready: reports.filter(r => r.status === 'Ready').length, attention: reports.filter(r => r.status === 'Needs attention').length, blocked: reports.filter(r => r.status === 'Blocked').length },
  };
}
