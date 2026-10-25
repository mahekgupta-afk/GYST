'use client';
import { useState, type ReactNode } from 'react';
import { PF, C } from '@/lib/pf';
import { hasChanges, type Spec, type Change } from '@/lib/fixes';
import { QuickFix, EditableSheet } from './FixEditor';

export const plural = (n: number, w: string, p?: string) => n + ' ' + (n === 1 ? w : p || w + 's');
export type Opts = { fix: (s: Spec) => void; book: () => void; reset: () => void; booking: boolean };

/* ---------- shared pieces ---------- */
function RuleStrip({ ev }: { ev: any }) {
  const t: Record<string, string> = { pass: 'Pass', red: 'Fail', amber: 'Warn', na: 'n/a' };
  return (
    <div className="rules" role="list" aria-label="Rulebook results">
      {PF.RULES.map((r: any) => {
        const st = ev.ruleStatus[r.id];
        return (
          <div key={r.id} className={'rule ' + st} role="listitem" title={r.id + ': ' + r.text} aria-label={r.id + ' ' + t[st] + '. ' + r.text}>
            <b>{r.id}</b>{t[st]}
          </div>
        );
      })}
    </div>
  );
}

function Verdict({ b, ev, thumpKey }: { b: any; ev: any; thumpKey: number }) {
  const map = ({ blocked: ['HOLD', 'red'], warning: ['CHECK', 'amber'], clear: ['CLEAR', 'green'] } as any)[ev.status];
  const title = ev.status === 'blocked' ? plural(ev.counts.red, 'problem') + ' to fix before this ships'
    : ev.status === 'warning' ? 'Can ship, but ' + plural(ev.counts.amber, 'thing') + ' need a look' : 'No problems found';
  return (
    <div className="card verdict">
      <span key={thumpKey} className={'stamp ' + map[1] + ' thump'} aria-hidden="true">{map[0]}</span>
      <div>
        <h2>{title}</h2>
        <p className="sub">{b.id + ' for ' + (b.seller || 'unnamed seller') + ', ' + (b.originCity || '?') + ' to ' + (b.destCity || b.destCountry || '?') + (ev.counts.red || ev.counts.amber ? '. ' + ev.counts.red + ' red, ' + ev.counts.amber + ' amber.' : '.')}</p>
      </div>
      <RuleStrip ev={ev} />
    </div>
  );
}

function Issues({ b, ev, opts }: { b: any; ev: any; opts: Opts }) {
  return (
    <div className="card section">
      <h3>{ev.issues.length ? 'What’s wrong and how to fix it' : 'Rulebook check'}</h3>
      {!ev.issues.length && (
        <div className="allgood"><span className="pill green">All clear</span><p>All ten rules pass for this booking. Nothing needs fixing.</p></div>
      )}
      {ev.issues.map((i: any, n: number) => (
        <article key={i.rule + n + (i.item || '') + i.title} className={'issue ' + i.sev}>
          <header>
            <span className={'pill ' + i.sev}>{i.sev === 'red' ? 'Red: must fix' : 'Amber: should fix'}</span>
            <span className="pill grey">{i.rule === 'DATA' ? 'Missing data' : i.rule}</span>
            {i.item ? <span className="pill grey">{i.item}</span> : null}
            <h4>{i.title}</h4>
          </header>
          <dl><dt>What’s wrong</dt><dd>{i.what}</dd><dt>How to fix</dt><dd>{i.fix}</dd></dl>
          <QuickFix issue={i} b={b} ev={ev} fix={opts.fix} />
        </article>
      ))}
    </div>
  );
}

const Stat = ({ v, l }: { v: string; l: string }) => <div className="stat"><b>{v}</b><span>{l}</span></div>;

function CarrierSection({ b, ev, opts }: { b: any; ev: any; opts: Opts }) {
  const rec = ev.rec;
  if (rec.error) return <div className="card section reco"><h3>Recommended carrier</h3><p>No rate card for this destination. Use Germany, France or the Netherlands.</p></div>;
  const r = rec.recommended;
  const alt = !r ? rec.options.slice().sort((x: any, y: any) => x.minCost - y.minCost)[0] : null;
  return (
    <div className="card section reco">
      <h3>Recommended carrier</h3>
      {r ? (
        <>
          <div className="reco-top"><span className="reco-name">{r.carrier + ' · ' + r.service}</span><span className="pill grey">{'for “' + rec.priority + '”' + (rec.assumedPriority ? ' (assumed)' : '')}</span></div>
          <p>{rec.reason}</p>
          <div className="stats">
            <Stat v={PF.gbp(r.price * rec.pallets)} l={'total, ' + plural(rec.pallets, 'pallet')} /><Stat v={r.transit + ' days'} l="transit" /><Stat v={r.ontime + '%'} l="on time" /><Stat v={PF.nf(rec.wpp) + ' kg'} l={'per pallet (limit ' + r.maxKg + ')'} />
          </div>
        </>
      ) : (
        <>
          <p>{rec.reason}</p>
          {alt && alt.minPallets ? <p>{'Cheapest way to make it fit: ' + alt.carrier + ' with ' + plural(alt.minPallets, 'pallet') + ' (' + PF.gbp(alt.minCost) + ', ' + PF.nf(rec.gw / alt.minPallets) + ' kg each).'}</p> : null}
        </>
      )}
      <div className="scroll">
        <table>
          <thead><tr>{['Carrier', '£ per pallet', 'Total', 'Days', 'On time', 'Max kg per pallet', 'This load', ''].map((t, i) => <th key={i} className={i >= 1 && i <= 5 ? 'num' : ''}>{t}</th>)}</tr></thead>
          <tbody>
            {rec.options.map((o: any) => {
              const isRec = r && o.carrier === r.carrier, isSel = o.carrier === rec.selected.carrier;
              const fit = o.eligible ? (rec.wpp === null ? '—' : 'Fits, ' + PF.nf(o.maxKg - rec.wpp) + ' kg spare') : 'Over by ' + PF.nf(rec.wpp - o.maxKg) + ' kg';
              return (
                <tr key={o.carrier} className={isSel ? 'pick' : ''}>
                  <td><b>{o.carrier}</b> {o.service}
                    {isRec ? <div><span className="pill green">Recommended</span></div> : null}
                    {o === rec.preferred && !isRec ? <div><span className="pill grey">Your first pick</span></div> : null}</td>
                  <td className="num">{PF.gbp(o.price)}</td><td className="num">{o.cost != null ? PF.gbp(o.cost) : '—'}</td><td className="num">{o.transit}</td><td className="num">{o.ontime + '%'}</td><td className="num">{o.maxKg}</td>
                  <td><span className={'pill ' + (o.eligible ? 'green' : 'red')}>{fit}</span></td>
                  <td>{isSel ? <span className="pill grey">Selected</span> : <button className="btn small ghost" onClick={() => opts.fix({ kind: 'carrier', carrier: o.carrier, rule: 'Carrier choice' })}>Use</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rec.priority === 'Balanced' ? <p className="note">Balanced weighs cost 40%, speed 30% and reliability 30%.</p> : null}
    </div>
  );
}

function Confirmation({ b, ev, opts }: { b: any; ev: any; opts: Opts }) {
  const s = PF.summarise(b, ev);
  const booked = !!b._ref;
  return (
    <div className="card section confirm">
      <h3>{booked ? 'Booked' : 'Book this shipment'}</h3>
      <p><b>{s.headline + '. '}</b></p>
      {s.lines.map((l: string, i: number) => <p key={i}>{l}</p>)}
      <p className="muted" style={{ marginTop: 10 }}><b>What happens next</b></p>
      <ol>{s.next.map((n: string, i: number) => <li key={i}>{n}</li>)}</ol>
      {booked ? (
        <div className="confirmed" role="status">
          <b>{'Booked with ' + ev.rec.selected.carrier + '. Reference ' + b._ref + '. '}</b>
          {b._saved === false ? 'This booking was checked but could not be saved to the booking log. ' : 'The booking is recorded under this reference. '}
          It has not been transmitted to a carrier.
        </div>
      ) : (
        <div className="row-actions" style={{ margin: '14px 0 0' }}>
          <button className="btn" disabled={ev.status === 'blocked' || opts.booking} onClick={opts.book}>{ev.status === 'blocked' ? 'Fix red items to book' : opts.booking ? 'Booking…' : 'Book shipment'}</button>
          {ev.status === 'warning' ? <span className="note">You can book with warnings, but fixing them avoids delays.</span> : null}
        </div>
      )}
      {b._bookError ? <div className="bookerr" role="alert">{b._bookError}</div> : null}
    </div>
  );
}

function FixProgress({ b, ev, opts }: { b: any; ev: any; opts: Opts }) {
  const start = PF.evaluate(b._orig ? JSON.parse(JSON.stringify(b._orig)) : b);
  const startN = start.issues.length, nowN = ev.issues.length;
  const pct = startN === 0 ? 100 : Math.max(0, Math.min(100, Math.round((1 - nowN / startN) * 100)));
  const booked = !!b._ref;
  const blocked = ev.status === 'blocked';
  const text = booked ? 'This booking has been booked.'
    : blocked ? 'Fix the ' + plural(ev.counts.red, 'red problem') + ' below, then you can book this shipment.'
    : ev.status === 'warning' ? 'No red problems left. You can book now, or fix the ' + plural(ev.counts.amber, 'warning') + ' first to avoid delays.'
    : 'All ten rules pass. This shipment is ready to book.';
  return (
    <div className="card section fixprog">
      <h3>{booked ? 'Booked' : blocked ? 'Fix, then book' : 'Ready to book'}</h3>
      <p style={{ margin: 0 }}>{text}</p>
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Problems resolved"><i style={{ width: pct + '%' }} /></div>
      <p className="note" style={{ margin: 0 }}>{'Started with ' + plural(start.counts.red, 'red problem') + ' and ' + plural(start.counts.amber, 'amber warning') + '. Now ' + ev.counts.red + ' red and ' + ev.counts.amber + ' amber.'}</p>
      <div className="row-actions">
        {!booked ? <button className="btn" disabled={blocked || opts.booking} onClick={opts.book}>{opts.booking ? 'Booking…' : 'Book shipment'}</button> : null}
        {hasChanges(b) && !booked ? <button className="btn ghost small" onClick={opts.reset}>Reset to original</button> : null}
      </div>
    </div>
  );
}

function ChangeLog({ b }: { b: any }) {
  if (!hasChanges(b)) return null;
  return (
    <details className="card section changes">
      <summary>{'Corrections made (' + b._changes.length + ')'}</summary>
      <div className="scroll">
        <table>
          <thead><tr><th>Fixes</th><th>Applies to</th><th>Field</th><th>Was</th><th>Now</th></tr></thead>
          <tbody>{b._changes.map((c: Change, i: number) => <tr key={i}><td>{c.rule}</td><td>{c.scope}</td><td>{c.field}</td><td>{String(c.from)}</td><td>{String(c.to)}</td></tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

export function SheetCard({ b, title, showProgress }: { b: any; title: string; showProgress?: boolean }) {
  const f = C.sheetFields(b), done = f.filter((x: any) => x.value !== null).length;
  const itemsOk = b.items.length > 0 && b.items.every((it: any) => it.desc && it.qty != null && it.price != null && it.upc != null && it.cartons != null && it.unitWeight != null && (it.hs != null || it.skipHS) && (it.coo || it.skipCOO));
  const total = f.length + 1, d = done + (itemsOk ? 1 : 0);
  return (
    <div className="card section">
      <h3>{title}</h3>
      {showProgress && <div className="progress" role="progressbar" aria-valuenow={d} aria-valuemin={0} aria-valuemax={total} aria-label="Booking details filled in"><i style={{ width: Math.round(d / total * 100) + '%' }} /></div>}
      <dl className="sheet">{f.map((x: any) => <div key={x.label}><dt>{x.label}</dt><dd className={x.value === null ? 'miss' : ''}>{x.value === null ? 'Not yet' : String(x.value)}</dd></div>)}</dl>
      {b.items && b.items.length ? (
        <div className="scroll" style={{ marginTop: 14 }}>
          <table>
            <thead><tr>{['Product', 'Units', '£ per unit', 'Per carton', 'Cartons', 'kg each', 'HS code', 'Made in'].map((t, i) => <th key={t} className={i >= 1 && i <= 5 ? 'num' : ''}>{t}</th>)}</tr></thead>
            <tbody>{b.items.map((i: any, n: number) => (
              <tr key={n}>
                <td>{i.desc || '—'}{i.sku ? <div className="note">{i.sku}</div> : null}</td>
                <td className="num">{i.qty != null ? i.qty.toLocaleString('en-GB') : '—'}</td><td className="num">{i.price != null ? PF.gbp(i.price) : '—'}</td>
                <td className="num">{i.upc != null ? i.upc : '—'}</td><td className="num">{i.cartons != null ? i.cartons : '—'}</td><td className="num">{i.unitWeight != null ? i.unitWeight : '—'}</td>
                <td>{i.hs != null && i.hs !== '' ? String(i.hs) : (i.skipHS ? 'blank' : '—')}</td><td>{i.coo || (i.skipCOO ? 'blank' : '—')}</td>
              </tr>))}</tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function Advisory({ b }: { b: any }) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<null | { flagged?: { sku: string; concern: string }[]; error?: boolean }>(null);
  if (!b.items.length) return null;
  const ask = async () => {
    setBusy(true); setOut(null);
    try {
      const res = await fetch('/api/second-opinion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: b.items.map((i: any) => ({ sku: i.sku, description: i.desc })) }) });
      if (!res.ok) throw new Error(String(res.status));
      setOut(await res.json());
    } catch { setOut({ error: true }); }
    setBusy(false);
  };
  return (
    <div className="card section">
      <h3>Extra screening of item descriptions</h3>
      <div className="note">The rulebook check looks for known words. Extra screening reads the descriptions for restricted goods that don’t use those words, such as devices with built-in batteries.</div>
      <button className="btn small ghost" style={{ marginTop: 10 }} disabled={busy} onClick={ask}>{busy ? 'Screening…' : out ? 'Screen again' : 'Run extra screening'}</button>
      {out && (
        <div className="adv">
          {out.error ? <p>Extra screening isn’t available right now. The ten rulebook checks above are unaffected.</p>
            : !out.flagged?.length ? <p>Nothing else looks restricted.</p>
            : <>{out.flagged.map((x, i) => <p key={i}><b>{x.sku + ': '}</b>{x.concern}</p>)}<p className="note">These are advisory and not part of the ten rules.</p></>}
        </div>
      )}
    </div>
  );
}

export function Detail({ b, opts, thumpKey, aiOn }: { b: any; opts: Opts; thumpKey: number; aiOn: boolean }) {
  const ev = PF.evaluate(b);
  const locked = !!b._ref; // a booked shipment is final: its fields can't be edited any more
  return (
    <fieldset className="lock" disabled={locked}>
      <Verdict b={b} ev={ev} thumpKey={thumpKey} />
      <FixProgress b={b} ev={ev} opts={opts} />
      <Issues b={b} ev={ev} opts={opts} />
      <CarrierSection b={b} ev={ev} opts={opts} />
      <Confirmation b={b} ev={ev} opts={opts} />
      <EditableSheet b={b} ev={ev} fix={opts.fix} title="Booking details" />
      <ChangeLog b={b} />
      {aiOn ? <Advisory b={b} /> : null}
    </fieldset>
  );
}

/* ---------- upload results ---------- */
function StatusPills({ b, ev }: { b: any; ev: any }) {
  if (b._ref) return <span className="pill green">Booked</span>;
  if (ev.status === 'blocked') return <span><span className="pill red">{'Needs fixing: ' + ev.counts.red + ' red'}</span>{ev.counts.amber ? <> <span className="pill amber">{ev.counts.amber + ' amber'}</span></> : null}</span>;
  if (ev.status === 'warning') return <span className="pill amber">{'Ready, ' + plural(ev.counts.amber, 'warning')}</span>;
  return <span className="pill green">Ready to book</span>;
}

export function exportCSV(bookings: any[]) {
  const q = (v: any) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const out = [['Booking ID', 'Seller', 'Status', 'Rule', 'Severity', 'Item', 'Problem', 'What is wrong', 'How to fix', 'Recommended carrier', 'Total cost GBP'].map(q).join(',')];
  bookings.forEach(b => {
    const ev = PF.evaluate(b), c = ev.rec.recommended, cost = c && ev.rec.pallets ? c.price * ev.rec.pallets : '';
    const base = [b.id, b.seller, ev.status];
    const tail = [c ? c.carrier + ' ' + c.service : 'None fits', cost];
    if (!ev.issues.length) out.push(base.concat(['', '', '', 'No issues', '', ''], tail).map(q).join(','));
    ev.issues.forEach((i: any) => out.push(base.concat([i.rule, i.sev, i.item || '', i.title, i.what, i.fix], tail).map(q).join(',')));
  });
  const url = URL.createObjectURL(new Blob([out.join('\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'preflight-results.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type UploadHandlers = {
  fix: (b: any, s: Spec) => void;
  book: (b: any) => void;
  reset: (b: any) => void;
  bookAllClear: () => void;
  download: () => void;
  busy: boolean;
  bulk: { done: number; total: number } | null;
};

export function UploadResults({ upload, sel, setSel, thumpKey, aiOn, h }: { upload: any; sel: string | null; setSel: (id: string | null) => void; thumpKey: number; aiOn: boolean; h: UploadHandlers }) {
  if (!upload) {
    return (
      <div className="card empty">
        <h2>Check your bookings</h2>
        <p>Upload your Bookings and Items sheets. Every booking is checked against the ten rules. Fix what’s flagged right here, then book each shipment once it’s ready.</p>
        <p>Need the format? Download the blank template on the left.</p>
      </div>
    );
  }
  if (upload.error) return <div className="card section"><h3>I couldn’t read that file</h3><p>{upload.error}</p></div>;
  const evs = upload.bookings.map((b: any) => ({ b, ev: PF.evaluate(b) }));
  const cur = sel ? evs.find((x: any) => x.b.id === sel) : null;
  if (cur) {
    const idx = evs.indexOf(cur);
    return (
      <>
        <div className="row-actions">
          <button className="btn small ghost" onClick={() => setSel(null)}>Back to all bookings</button>
          <span className="note">{'Booking ' + (idx + 1) + ' of ' + evs.length}</span>
          <span>
            <button className="btn small ghost" disabled={idx === 0} onClick={() => setSel(evs[idx - 1].b.id)}>Previous</button>{' '}
            <button className="btn small ghost" disabled={idx === evs.length - 1} onClick={() => setSel(evs[idx + 1].b.id)}>Next</button>
          </span>
        </div>
        <Detail b={cur.b} aiOn={aiOn} thumpKey={thumpKey}
          opts={{ fix: s => h.fix(cur.b, s), book: () => h.book(cur.b), reset: () => h.reset(cur.b), booking: h.busy }} />
      </>
    );
  }
  const booked = evs.filter((x: any) => x.b._ref).length;
  const needs = evs.filter((x: any) => !x.b._ref && x.ev.status === 'blocked').length;
  const ready = evs.length - booked - needs;
  const clearToBook = evs.filter((x: any) => !x.b._ref && x.ev.status === 'clear').length;
  const anyChanges = evs.some((x: any) => hasChanges(x.b));
  return (
    <div className="card section">
      <div className="row-actions"><h3 style={{ margin: 0 }}>{upload.fileName}</h3></div>
      <div className="tiles">
        <div className="tile"><b>{evs.length}</b><span>bookings in this file</span></div>
        <div className="tile red"><b>{needs}</b><span>need fixing</span></div>
        <div className="tile amber"><b>{ready}</b><span>ready to book</span></div>
        <div className="tile green"><b>{booked}</b><span>booked</span></div>
      </div>
      <div className="row-actions" style={{ margin: '4px 0 14px' }}>
        <button className="btn" disabled={!clearToBook || h.busy} onClick={h.bookAllClear}>
          {h.bulk ? 'Booking ' + (h.bulk.done + 1) + ' of ' + h.bulk.total + '…' : 'Book all clear (' + clearToBook + ')'}
        </button>
        <button className="btn small ghost" onClick={h.download}>{anyChanges ? 'Download corrected file (.xlsx)' : 'Download results (.xlsx)'}</button>
        <button className="btn small ghost" onClick={() => exportCSV(upload.bookings)}>Download issue list (CSV)</button>
      </div>
      <p className="note" style={{ marginTop: -6 }}>Bookings with warnings only are booked one at a time, so you can read the warnings first.</p>
      {(upload.warnings || []).map((w: string, i: number) => <div key={i} className="warnbox">{w}</div>)}
      <div className="scroll">
        <table>
          <thead><tr>{['Booking', 'Seller', 'Route', 'Pallets', 'Recommended carrier', 'Status'].map((t, i) => <th key={t} className={i === 3 ? 'num' : ''}>{t}</th>)}</tr></thead>
          <tbody>
            {evs.map(({ b, ev }: any) => {
              const r = ev.rec, c = r.recommended;
              const go = () => { setSel(b.id); window.scrollTo({ top: 0 }); };
              return (
                <tr key={b.id} className="click" tabIndex={0} role="link" aria-label={'Open ' + b.id} onClick={go} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }}>
                  <td><b>{b.id}</b>{b._ref ? <div className="note">{b._ref}</div> : null}</td><td>{b.seller || '—'}</td><td>{(b.originCity || '?') + ' to ' + (b.destCity || '?')}</td>
                  <td className="num">{b.pallets != null ? b.pallets : '—'}</td>
                  <td>{c ? c.carrier + ', ' + PF.gbp(c.price * (r.pallets || 0)) : (r.error ? '—' : 'None fits')}</td>
                  <td><StatusPills b={b} ev={ev} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note" style={{ marginTop: 10 }}>Select a booking to see what’s wrong, fix it, and book it.</p>
    </div>
  );
}
