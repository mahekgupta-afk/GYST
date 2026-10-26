'use client';
import { useEffect, useState } from 'react';
import { PF } from '@/lib/pf';

// Short labels for the terminal mock. Whether each check passed, and the recommendation, come from the real rule engine run on
// the first sample booking (the same booking and engine as the rest of the app), not from fixed text.
const LABELS: Record<string, string> = {
  'R-01': 'HS codes present and valid', 'R-02': 'Declared value matches items', 'R-03': 'Carton counts correct', 'R-04': 'Total cartons match', 'R-05': 'Weight per pallet within limit',
  'R-06': 'No restricted goods', 'R-07': 'Gross weight sufficient', 'R-08': 'Delivery appointment booked', 'R-09': 'Country of origin present', 'R-10': 'Ready date not in past',
};
const MARK: Record<string, [string, string]> = { pass: ['✓', 't-green'], red: ['✗', 't-red'], amber: ['!', 't-amber'], na: ['–', 't-dim'] };

export default function LandingTerminal() {
  const [run, setRun] = useState<{ id: string; ev: any } | null>(null);
  useEffect(() => {
    const t = PF.sampleTables(PF.todayISO());
    const b = PF.bookingsFromTables(...(Object.values(t) as [any, any])).bookings[0];
    setRun({ id: b.id, ev: PF.evaluate(b) });
  }, []);
  const ev = run?.ev;
  const rec = ev?.rec?.recommended;
  const verdict = !ev ? '' : ev.status === 'blocked' ? ['BLOCKED', 't-red'] : ev.status === 'warning' ? ['ADVISORY', 't-amber'] : ['CLEAR TO SHIP', 't-green'];
  return (
    <div className="landing-terminal" aria-hidden="true">
      <div className="terminal-bar">
        <span className="t-dot red" /><span className="t-dot amber" /><span className="t-dot green" />
        <span className="t-title">gyst — pre-flight check</span>
      </div>
      <div className="terminal-body">
        {ev ? (
          <>
            <div className="t-line"><span className="t-dim">$</span> gyst check {run!.id}</div>
            <div className="t-line t-gap">Running {PF.RULES.length} checks…</div>
            {PF.RULES.map((r: any) => {
              const [mark, cls] = MARK[ev.ruleStatus[r.id]] || MARK.na;
              return (
                <div key={r.id} className="t-line t-check"><span className={cls}>{mark}</span><span className="t-id">{r.id}</span><span className="t-dim">{LABELS[r.id]}</span></div>
              );
            })}
            <div className="t-line t-gap">
              <span className={(verdict as string[])[1]}>{(verdict as string[])[0]}</span>
              {rec && ev.rec.pallets ? <span className="t-dim"> · {rec.carrier} · {rec.service} · {PF.gbp(rec.price * ev.rec.pallets)} · {rec.transit} days</span> : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
