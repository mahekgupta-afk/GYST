// Builds the chat's reply to one message from what the parser did (the log) and the rulebook's verdict on the booking.
// Kept out of the component so the same text is produced in the app and in the chat-script tests.
import { PF, C } from './pf';
import { unacknowledged } from './fixes';

export type Reply = { text: string; chips: string[] | null; needs?: string[]; example?: string };
/** What the last verdict looked like, so the next one can say what changed. */
export type Prev = { red: number; amber: number; carrier: string | null; cost: number | null; pallets: number | null } | null;

const plural = (n: number, w: string, p?: string) => n + ' ' + (n === 1 ? w : p || w + 's');
export const sig = (c: any) => JSON.stringify(Object.assign({}, c.b, { _confirmed: undefined }));

export const completeChips = (c: any, ev: any) => {
  if (c.b._confirmed) return ['Start a new booking'];
  const out = ['Add a pallet', 'Change priority to Fastest'];
  if (ev && ev.status !== 'blocked') out.unshift('Book it');
  return out;
};

export const snapshotOf = (ev: any): NonNullable<Prev> => {
  const sel = ev.rec && ev.rec.selected;
  return { red: ev.counts.red, amber: ev.counts.amber, carrier: sel ? sel.carrier : null, cost: sel && ev.rec.pallets ? sel.price * ev.rec.pallets : null, pallets: ev.rec ? ev.rec.pallets || null : null };
};

/** “Checks re-run: 1 red, 0 amber (was 0 and 0). Carrier A → Carrier C, £540 → £680.” */
export function beforeAfter(was: NonNullable<Prev>, now: NonNullable<Prev>): string {
  let s = 'Checks re-run: ' + now.red + ' red, ' + now.amber + ' amber (was ' + was.red + ' and ' + was.amber + ').';
  if (now.carrier && was.carrier) {
    const cost = (v: number | null) => (v === null ? '—' : PF.gbp(v));
    if (was.carrier !== now.carrier) s += ' ' + was.carrier + ' → ' + now.carrier + ', ' + cost(was.cost) + ' → ' + cost(now.cost) + '.';
    else if (was.cost !== now.cost) s += ' ' + now.carrier + ', ' + cost(was.cost) + ' → ' + cost(now.cost) + '.';
    else s += ' ' + now.carrier + ' and ' + cost(now.cost) + ' are unchanged.';
  }
  return s;
}

/**
 * @param c     the chat after the message was applied
 * @param log   what the parser did with it
 * @param snap  the chat before it (a clone)
 * @param prev  the verdict last shown (null before the first one)
 * @returns the reply, the verdict to remember, and whether the seller asked to book a clear booking
 */
export function composeReply(c: any, log: any, snap: any, prev: Prev): { reply: Reply; prev: Prev; book: boolean } {
  const a = c.asked;
  const keep = (reply: Reply) => ({ reply, prev, book: false });
  const qOf = (x: any) => (x && x.needs ? 'I still need:' : x?.q);
  const listOf = (x: any) => (x && x.needs ? { needs: x.needs as string[], example: x.example as string } : {});
  const ack = C.ackText(log);
  const dp = log.dateProblem;
  const dateText = dp ? (dp.invalid ? '“' + dp.invalid + '” isn’t a real date. ' : '“' + dp.ambiguous + '” isn’t an exact date, so I haven’t saved one. ') + 'Please give me the day, for example 05-11-2026 or 5 Nov.' : '';
  const extra = [(log.scope || []).join('\n'), dateText].filter(Boolean).join('\n');
  const askAgain = a && !(dp && a.key === 'readyDate');
  // A refused value: say which field and why, keep the old value, ask again. Valid values in the same message were still stored.
  const refusals = (log.rejected || []).map((r: any) => r.message);
  if (refusals.length) return keep({ text: [ack, extra, ...refusals].filter(Boolean).join('\n'), chips: null });
  if (!log.understood) {
    if (extra) return keep({ text: extra + (askAgain ? '\n' + qOf(a) : ''), chips: a && askAgain ? a.chips : null, ...(askAgain ? listOf(a) : {}) });
    return keep({ text: 'Sorry, I didn’t catch that. ' + (a ? (a.hint || '') + qOf(a) : 'You can say things like “add a pallet”, “change the priority to Fastest”, “use Carrier B” or “book it”.'), chips: a ? a.chips : completeChips(c, null), ...listOf(a) });
  }
  let head = ack || (a ? '' : 'Noted.');
  if (extra) head = (head ? head + '\n' : '') + extra;
  if (log.intent === 'confirm' && a) {
    return keep({ text: (head ? head + '\n' : '') + 'I can’t book it yet, there’s still something I need. ' + qOf(a), chips: a.chips, ...listOf(a) });
  }
  if (a && !askAgain) return keep({ text: head, chips: null });
  if (a) return keep({ text: (head ? head + '\n' : '') + qOf(a), chips: a.chips, ...listOf(a) });
  const b = c.b;
  if (JSON.stringify(Object.assign({}, snap.b, { _confirmed: undefined })) !== sig(c)) b._confirmed = false;
  const ev = PF.evaluate(b);
  const now = snapshotOf(ev);
  if (log.intent === 'confirm') {
    if (ev.status === 'blocked') return keep({ text: 'I can’t book this yet: ' + plural(ev.counts.red, 'red problem') + ' still need fixing. ' + ev.issues.filter((i: any) => i.sev === 'red').slice(0, 4).map((i: any) => i.title).join('; ') + '.', chips: completeChips(c, ev) });
    const open = unacknowledged(b, ev);
    if (open.length) return keep({ text: 'I can book this once you’ve acknowledged ' + (open.length === 1 ? 'the warning' : 'the ' + open.length + ' warnings') + ': ' + open.slice(0, 4).map((i: any) => i.title).join('; ') + '. Tick “I understand” in the Book this shipment panel, or say “I acknowledge the warnings”.', chips: ['I acknowledge the warnings'] });
    return { reply: { text: 'Booking it with ' + ev.rec.selected.carrier + '…', chips: null }, prev: now, book: true };
  }
  const first = !prev;
  const lines = ev.issues.slice(0, 6).map((i: any) => '• ' + (i.rule === 'DATA' ? 'Missing detail' : i.rule === 'INPUT' ? 'Input error' : i.rule) + ': ' + i.title + (i.item ? ' (' + i.item + ')' : ''));
  if (ev.issues.length > 6) lines.push('• …and ' + (ev.issues.length - 6) + ' more');
  const verdict = ev.status === 'blocked' ? 'Pre-flight result: ' + plural(ev.counts.red, 'red problem') + (ev.counts.amber ? ' and ' + plural(ev.counts.amber, 'amber warning') : '') + '. Don’t ship yet.'
    : ev.status === 'warning' ? 'Pre-flight result: no red problems, but ' + plural(ev.counts.amber, 'amber warning') + '.'
    : 'Pre-flight result: all ten rules pass.';
  let text = head + '\n' + (first ? 'That’s everything I need. ' + verdict : (prev ? beforeAfter(prev, now) : verdict));
  if (!first && ev.status === 'blocked') text += ' Don’t ship yet.';
  if (lines.length) text += '\n' + lines.join('\n');
  const r = ev.rec;
  if (r.recommended) text += '\nRecommended carrier: ' + r.recommended.carrier + ' (' + r.recommended.service + '), ' + PF.gbp(r.recommended.price * r.pallets) + '.';
  else if (r.blocked) text += '\nFix the input errors above to get a carrier recommendation.';
  else text += '\nNo carrier can take this weight per pallet. See the fix on the right.';
  const r5 = ev.issues.find((i: any) => i.rule === 'R-05' && i.sev === 'red');
  if (r5) text += '\n' + r5.what.split(', so the carrier')[0] + '. ' + r5.fix;
  text += '\nYou can change any detail, for example “add a pallet”.';
  return { reply: { text, chips: completeChips(c, ev) }, prev: now, book: false };
}
