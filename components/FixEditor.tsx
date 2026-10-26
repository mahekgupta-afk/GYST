'use client';
import { useState, type ReactNode } from 'react';
import { PF } from '@/lib/pf';
import { suggestions, itemFlags, type Spec, type ApplyResult } from '@/lib/fixes';
import { fixOptions, previewFix, money, type FixOption } from '@/lib/autofix';
import { HsFinder } from './HsPanel';
import { checkNumber, checkHs, checkReadyDate, inlineError, type FieldKey } from '@/lib/validate';

type Fix = (s: Spec) => ApplyResult | void;
const gbp = (n: number) => PF.gbp(n);

/* ---------- small inputs ---------- */
function NumField({ field, label, hint, cta, step, onApply }: { field: FieldKey; label: string; hint?: string; cta: string; step?: string; onApply: (n: number) => void }) {
  const [v, setV] = useState('');
  const c = checkNumber(field, v);
  const err = v.trim() === '' ? null : inlineError(field, v);
  const ok = c.ok;
  return (
    <label className="fixfield">
      <span>{label}{hint ? <em>{hint}</em> : null}</span>
      <span className="fixrow">
        <input className={'inp' + (err ? ' flag' : '')} inputMode="decimal" value={v} step={step} aria-invalid={!!err || undefined} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && c.ok) { onApply(c.value); setV(''); } }} />
        <button type="button" className="btn small" disabled={!ok} onClick={() => { if (c.ok) { onApply(c.value); setV(''); } }}>{cta}</button>
      </span>
      {err ? <span className="fixerr" role="alert">{err}</span> : null}
    </label>
  );
}
function TextField({ label, hint, cta, error, onApply }: { label: string; hint?: string; cta: string; error: (s: string) => string | null; onApply: (s: string) => void }) {
  const [v, setV] = useState('');
  const err = v.trim() === '' ? null : error(v.trim());
  const ok = v.trim() !== '' && !err;
  return (
    <label className="fixfield">
      <span>{label}{hint ? <em>{hint}</em> : null}</span>
      <span className="fixrow">
        <input className={'inp' + (err ? ' flag' : '')} value={v} aria-invalid={!!err || undefined} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && ok) { onApply(v.trim()); setV(''); } }} />
        <button type="button" className="btn small" disabled={!ok} onClick={() => { onApply(v.trim()); setV(''); }}>{cta}</button>
      </span>
      {err ? <span className="fixerr" role="alert">{err}</span> : null}
    </label>
  );
}
function SelectField({ label, options, cta, onApply }: { label: string; options: string[]; cta: string; onApply: (s: string) => void }) {
  const [v, setV] = useState('');
  return (
    <label className="fixfield">
      <span>{label}</span>
      <span className="fixrow">
        <select className="inp" value={v} onChange={e => setV(e.target.value)}><option value="">Choose…</option>{options.map(o => <option key={o}>{o}</option>)}</select>
        <button type="button" className="btn small" disabled={!v} onClick={() => { onApply(v); setV(''); }}>{cta}</button>
      </span>
    </label>
  );
}
function DateField({ onApply }: { onApply: (iso: string) => void }) {
  const [v, setV] = useState('');
  const today = PF.todayISO();
  const chk = v ? checkReadyDate(v, today) : null;
  return (
    <label className="fixfield">
      <span>Or choose a collection date</span>
      <span className="fixrow">
        <input className={'inp' + (chk && !chk.ok ? ' flag' : '')} type="date" min={today} value={v} onChange={e => setV(e.target.value)} />
        <button type="button" className="btn small" disabled={!v || !!(chk && !chk.ok)} onClick={() => { onApply(v); setV(''); }}>Set date</button>
      </span>
      {chk && !chk.ok ? <span className="fixerr" role="alert">Choose today or a later date.</span> : null}
    </label>
  );
}
const hsError = (t: string): string | null => {
  const h = checkHs(t);
  if (!h.ok) return h.reason === 'zeros' ? 'All zeros isn’t a real HS code.' : h.reason === 'negative' ? 'An HS code can’t be negative.' : 'Digits only (spaces and dots are fine).';
  return h.value && h.value.length >= 6 ? null : 'At least 6 digits are needed.';
};
const Btn = ({ children, onClick, ghost }: { children: ReactNode; onClick: () => void; ghost?: boolean }) =>
  <button type="button" className={'btn small' + (ghost ? ' ghost' : '')} onClick={onClick}>{children}</button>;

/* ---------- per-issue fix controls ---------- */
/** A suggested fix is previewed (before → after, and what the checks say afterwards) and only applied when the user confirms. */
function FixPreviewBox({ b, option, fix, onDone }: { b: any; option: FixOption; fix: Fix; onDone: () => void }) {
  const [err, setErr] = useState('');
  const pv = previewFix(b, option.specs);
  const rules = (xs: string[]) => (xs.length ? xs.join(', ') : 'none');
  const apply = () => {
    for (const sp of option.specs) { const r = fix(sp); if (r && !r.ok) { setErr(r.message); return; } }
    onDone();
  };
  return (
    <div className="fixpreview" role="group" aria-label={'Preview: ' + option.label}>
      <div className="fixhead">Preview. Nothing has changed yet</div>
      {pv.ok ? (
        <>
          <table className="previewtable">
            <thead><tr><th>What</th><th>Before</th><th>After</th></tr></thead>
            <tbody>{pv.rows.map((r, i) => <tr key={i}><td>{r.scope + ' · ' + r.field}</td><td className="was">{String(r.from)}</td><td className="now">{String(r.to)}</td></tr>)}</tbody>
          </table>
          <p className="note">{'Checks after this change: ' + pv.after.red + ' red, ' + pv.after.amber + ' amber (now ' + pv.before.red + ' red, ' + pv.before.amber + ' amber). ' + (pv.fixed.length ? 'Fixed: ' + rules(pv.fixed) + '.' : 'No rule would be fixed by this.')}</p>
          {pv.price.before !== pv.price.after ? <p className="note">{'Price: ' + money(pv.price.before) + ' → ' + money(pv.price.after) + '.'}</p> : null}
          {pv.newProblems.length ? <p className="fixerr" role="alert">{'This would also open: ' + rules(pv.newProblems) + '. You can fix that afterwards, or choose another option.'}</p> : null}
        </>
      ) : <p className="fixerr" role="alert">{pv.message}</p>}
      {err ? <p className="fixerr" role="alert">{err}</p> : null}
      <div className="fixrow">
        <button type="button" className="btn small" disabled={!pv.ok} onClick={apply}>Apply fix</button>
        <button type="button" className="btn small ghost" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

export function QuickFix({ issue, b, ev, fix }: { issue: any; b: any; ev: any; fix: Fix }) {
  const s = suggestions(b), rec = ev.rec, rule = issue.rule as string;
  const items: any[] = b.items || [];
  const [pend, setPend] = useState<FixOption | null>(null);
  const [finder, setFinder] = useState<number | null>(null);
  const options = fixOptions(b, ev, issue);
  // Rows this issue is about. Item-level issues carry the SKU; fall back to rows with no SKU.
  const rows = (pred: (it: any) => boolean) => items.map((_, i) => i).filter(i => (issue.item ? items[i].sku === issue.item : !items[i].sku) && pred(items[i]));
  const name = (it: any) => it.sku || it.desc || 'this item';
  let body: ReactNode = null;

  if (rule === 'R-01') {
    body = rows(it => itemFlags(it).hs).map(i => (
      <div key={i} className="hsfix">
        <TextField label={'HS code for ' + name(items[i])} hint="at least 6 digits" cta="Set HS code" error={hsError}
          onApply={t => fix({ kind: 'set', field: 'hs', value: t.replace(/[\s.]/g, ''), itemIndex: i, rule })} />
        {finder === i
          ? <HsFinder initial={items[i].desc || ''} onPick={c => { fix({ kind: 'set', field: 'hs', value: c, itemIndex: i, rule }); setFinder(null); }} onClose={() => setFinder(null)} />
          : <button type="button" className="btn small ghost" onClick={() => setFinder(i)}>{'Find a code for ' + name(items[i])}</button>}
      </div>
    ));
  } else if (rule === 'R-02') {
    body = <NumField field="declaredValue" label="Or enter the correct declared value (£)" cta="Set value" step="0.01" onApply={n => fix({ kind: 'set', field: 'declaredValue', value: n, rule })} />;
  } else if (rule === 'R-05') {
    body = <NumField field="pallets" label="Or set the number of pallets" cta="Set pallets" step="1" onApply={n => fix({ kind: 'set', field: 'pallets', value: Math.round(n), rule })} />;
  } else if (rule === 'R-06') {
    body = <p className="note">Restricted goods can’t travel on this service. Removing the item is the only fix here. If a description is wrong, correct it in your own system and upload the file again.</p>;
  } else if (rule === 'R-07') {
    body = <NumField field="grossWeight" label="Or enter the correct total gross weight (kg)" hint={'at least ' + s.itemsWeight + ' kg, plus packaging and pallets'} cta="Set weight" step="0.1" onApply={n => fix({ kind: 'set', field: 'grossWeight', value: n, rule })} />;
  } else if (rule === 'R-08') {
    body = <p className="note">Only you know whether an appointment is booked. Book it with the warehouse first, then confirm it here.</p>;
  } else if (rule === 'R-09') {
    body = rows(it => itemFlags(it).coo).map(i => (
      <SelectField key={i} label={'Where was ' + name(items[i]) + ' made?'} options={PF.COUNTRIES} cta="Set country" onApply={v => fix({ kind: 'set', field: 'coo', value: v, itemIndex: i, rule })} />
    ));
  } else if (rule === 'R-10') {
    body = <DateField onApply={d => fix({ kind: 'set', field: 'readyDate', value: d, rule })} />;
  } else if (rule === 'INPUT' && !issue.field) {
    body = <p className="note">Add the Booking ID in your file and upload it again. This row can’t be booked without one.</p>;
  } else if (rule === 'INPUT') {
    const fk = issue.field as FieldKey;
    const key = fk === 'itemCartons' ? 'cartons' : fk;
    const labels: Record<string, string> = { pallets: 'Number of pallets', cartons: 'Total cartons', declaredValue: 'Total declared value (£)', grossWeight: 'Total gross weight (kg)', qty: 'Quantity (units)', price: 'Unit price (£)', upc: 'Units per carton', itemCartons: 'Cartons', unitWeight: 'Unit weight (kg)' };
    body = <NumField field={fk} label={(labels[fk] || 'Value') + (issue.item ? ' for ' + issue.item : '')} cta="Set value" step={fk === 'price' || fk === 'declaredValue' ? '0.01' : undefined}
      onApply={n => fix({ kind: 'set', field: key, value: n, itemIndex: issue.itemIndex ?? undefined, rule: 'INPUT' })} />;
  } else if (rule === 'DATA') {
    const t = issue.title as string;
    if (/Route not supported/.test(t)) body = <SelectField label="Destination city" options={Object.keys(PF.DESTS)} cta="Set destination" onApply={c => fix({ kind: 'route', city: c, rule: 'DATA' })} />;
    else if (/Pallet count/.test(t)) body = <NumField field="pallets" label="Number of pallets" cta="Set pallets" step="1" onApply={n => fix({ kind: 'set', field: 'pallets', value: Math.round(n), rule: 'DATA' })} />;
    else if (/Gross weight missing/.test(t)) body = <NumField field="grossWeight" label="Total gross weight (kg)" hint={'at least ' + s.itemsWeight + ' kg'} cta="Set weight" step="0.1" onApply={n => fix({ kind: 'set', field: 'grossWeight', value: n, rule: 'DATA' })} />;
    else if (/Declared value missing/.test(t)) body = <NumField field="declaredValue" label="Or enter it (£)" cta="Set value" step="0.01" onApply={n => fix({ kind: 'set', field: 'declaredValue', value: n, rule: 'DATA' })} />;
    else if (/Ready date/.test(t)) body = <DateField onApply={d => fix({ kind: 'set', field: 'readyDate', value: d, rule: 'DATA' })} />;
    else if (/No items found/.test(t)) body = <p className="note">This booking has no product lines. Add them in your own system and upload the file again.</p>;
    else if (/^Missing /.test(t)) body = <p className="note">Fill this in the product table further down this page.</p>;
  }
  const has = options.length > 0 || (Array.isArray(body) ? body.length > 0 : !!body);
  if (!has) return null;
  return (
    <div className="fixbox">
      <div className="fixhead">Fix it here</div>
      <div className="fixbody">
        {options.length ? (
          <div className="fixrow" role="group" aria-label="Suggested fixes">
            {options.map(o => <Btn key={o.id} ghost={o.ghost} onClick={() => setPend(o)}>{o.label}</Btn>)}
          </div>
        ) : null}
        {pend ? <FixPreviewBox b={b} option={pend} fix={fix} onDone={() => setPend(null)} /> : null}
        {body}
      </div>
    </div>
  );
}

/* ---------- editable shipment details and product lines ---------- */
const NUM_ITEM: [string, string][] = [['qty', 'Units'], ['price', '£ per unit'], ['upc', 'Per carton'], ['cartons', 'Cartons'], ['unitWeight', 'kg each']];

/** A table cell that checks its value before applying it. An invalid value is not applied and the reason shows under the cell. */
function Cell({ value, flag, wide, onCommit, inputMode }: { value: unknown; flag?: boolean; wide?: boolean; inputMode?: 'decimal' | 'text'; onCommit: (raw: string) => string | null }) {
  const text = value === null || value === undefined ? '' : String(value);
  const [err, setErr] = useState('');
  const bad = flag || !!err;
  return (
    <span className="cellwrap">
      <input key={text} className={'inp cell' + (bad ? ' flag' : '') + (wide ? ' wide' : '')} defaultValue={text} inputMode={inputMode || 'decimal'} aria-invalid={bad || undefined}
        onBlur={e => { if (e.target.value.trim() !== text) setErr(onCommit(e.target.value.trim()) || ''); else setErr(''); }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      {err ? <span className="cellerr" role="alert">{err}</span> : null}
    </span>
  );
}

export function EditableSheet({ b, ev, fix, title }: { b: any; ev: any; fix: Fix; title: string }) {
  const open = new Set(ev.issues.map((i: any) => i.rule));
  const [dateErr, setDateErr] = useState('');
  // Every numeric edit goes through the shared validator first; a refused value is never applied.
  const setNum = (field: string, itemIndex: number | undefined, raw: string): string | null => {
    const fk: FieldKey = itemIndex !== undefined ? (field === 'cartons' ? 'itemCartons' : (field as FieldKey)) : (field as FieldKey);
    const err = inlineError(fk, raw);
    if (err) return err;
    const r = fix({ kind: 'set', field, value: checkNumber(fk, raw).ok ? (checkNumber(fk, raw) as { value: number }).value : raw, itemIndex, rule: 'Manual edit' });
    return r && !r.ok ? r.message : null;
  };
  const top: [string, string, string][] = [['pallets', 'Pallets', 'R-05'], ['cartons', 'Cartons', 'R-04'], ['declaredValue', 'Declared value (£)', 'R-02'], ['grossWeight', 'Gross weight (kg)', 'R-05']];
  return (
    <div className="card section">
      <h3>{title}</h3>
      <p className="note" style={{ marginTop: -6 }}>Correct any value here. The ten rules re-check straight away.</p>
      <div className="editgrid">
        {top.map(([f, l, r]) => (
          <label key={f} className="fixfield"><span>{l}</span><Cell value={b[f]} flag={b[f] == null || (open.has(r) && (f === 'cartons' || f === 'declaredValue'))} onCommit={raw => setNum(f, undefined, raw)} /></label>
        ))}
        <label className="fixfield"><span>Ready to ship</span>
          <input className={'inp cell wide' + (dateErr ? ' flag' : '')} type="date" min={PF.todayISO()} value={b.readyDate || ''} aria-invalid={!!dateErr || undefined}
            onChange={e => {
              if (!e.target.value) return;
              const r = fix({ kind: 'set', field: 'readyDate', value: e.target.value, rule: 'Manual edit' });
              setDateErr(r && !r.ok ? 'Choose today or a later date.' : '');
            }} />
          {dateErr ? <span className="cellerr" role="alert">{dateErr}</span> : null}
        </label>
        <label className="fixfield"><span>Delivery appointment</span>
          <select className="inp cell wide" value={b.appointment || 'No'} onChange={e => fix({ kind: 'set', field: 'appointment', value: e.target.value, rule: 'Manual edit' })}><option>Yes</option><option>No</option></select>
        </label>
        <label className="fixfield"><span>Priority</span>
          <select className="inp cell wide" value={b.priority || ''} onChange={e => fix({ kind: 'set', field: 'priority', value: e.target.value || null, rule: 'Manual edit' })}><option value="">Not set (Balanced)</option>{PF.PRIORITIES.map((p: string) => <option key={p}>{p}</option>)}</select>
        </label>
      </div>
      <div className="scroll" style={{ marginTop: 14 }}>
        <table className="edit">
          <thead><tr><th>Product</th><th>HS code</th>{NUM_ITEM.map(([, l]) => <th key={l} className="num">{l}</th>)}<th>Made in</th></tr></thead>
          <tbody>
            {(b.items || []).map((it: any, i: number) => {
              const f = itemFlags(it);
              return (
                <tr key={i}>
                  <td>{it.desc || '—'}<div className="note">{'SKU ' + (it.sku || '—')}</div></td>
                  <td><Cell value={it.hs} flag={f.hs} inputMode="text" onCommit={raw => {
                    if (raw === '') { const r = fix({ kind: 'set', field: 'hs', value: null, itemIndex: i, rule: 'Manual edit' }); return r && !r.ok ? r.message : null; }
                    const h = checkHs(raw);
                    if (!h.ok) return h.reason === 'zeros' ? 'All zeros isn’t a real HS code.' : h.reason === 'negative' ? 'An HS code can’t be negative.' : 'Digits only (spaces and dots are fine).';
                    const r = fix({ kind: 'set', field: 'hs', value: h.value, itemIndex: i, rule: 'Manual edit' });
                    return r && !r.ok ? r.message : null;
                  }} /></td>
                  {NUM_ITEM.map(([k]) => <td key={k}><Cell value={it[k]} flag={typeof it[k] !== 'number' || (f.cartonMath && (k === 'qty' || k === 'upc' || k === 'cartons'))} onCommit={raw => setNum(k, i, raw)} /></td>)}
                  <td>
                    <select className={'inp cell wide' + (f.coo ? ' flag' : '')} value={it.coo || ''} onChange={e => fix({ kind: 'set', field: 'coo', value: e.target.value || null, itemIndex: i, rule: 'Manual edit' })}>
                      <option value="">Not stated</option>{PF.COUNTRIES.map((c: string) => <option key={c}>{c}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
