'use client';
import { useEffect, useState } from 'react';
import { digitsOf, hsMessage, descriptionLooksOff, shortText, type HsResult, type HsSuggestion, type HsChild } from '@/lib/hs';
import { verifyHs, suggestHs } from '@/lib/hsClient';

export type HsMap = Record<string, HsResult | 'loading'>;

/** Looks up every item's HS code against the UK Tariff, a few at a time. Advisory only: nothing here changes a rule or blocks a booking. */
export function useHsResults(items: any[], enabled: boolean): HsMap {
  const [map, setMap] = useState<HsMap>({});
  const key = (items || []).map(i => digitsOf(i && i.hs)).join('|');
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const codes = Array.from(new Set(key.split('|').filter(Boolean)));
    if (!codes.length) return;
    setMap(m => { const n = { ...m }; codes.forEach(c => { if (!n[c]) n[c] = 'loading'; }); return n; });
    (async () => {
      const queue = codes.slice();
      const worker = async () => { for (let c = queue.shift(); c !== undefined; c = queue.shift()) { const r = await verifyHs(c); if (live) setMap(m => ({ ...m, [c]: r })); } };
      await Promise.all([worker(), worker(), worker()]);
    })();
    return () => { live = false; };
  }, [key, enabled]);
  return map;
}

const BADGE: Record<string, [string, string]> = {
  verified: ['green', 'Verified'], 'six-digits': ['amber', '6 digits only'], partial: ['amber', 'Not a full code'], 'not-found': ['amber', 'Not found'],
  unavailable: ['grey', 'Could not verify'], short: ['grey', 'Too short to check'], blank: ['grey', 'No code'],
};

/** Description search: type words, pick a suggestion, pick a full code. Choosing a full code calls onPick; nothing else changes anything. */
export function HsFinder({ initial, onPick, onClose }: { initial?: string; onPick: (code: string) => void; onClose: () => void }) {
  const [q, setQ] = useState(initial || '');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const [list, setList] = useState<HsSuggestion[]>([]);
  const [open, setOpen] = useState<Record<string, HsChild[] | 'loading'>>({});
  const search = async () => {
    setState('busy'); setOpen({});
    const r = await suggestHs(q);
    setList(r.suggestions); setState(r.ok ? 'done' : 'failed');
  };
  const expand = async (code: string) => {
    setOpen(o => ({ ...o, [code]: 'loading' }));
    const r = await verifyHs(code);
    setOpen(o => ({ ...o, [code]: r.children }));
  };
  return (
    <div className="hsfinder" role="group" aria-label="Find an HS code">
      <label className="fixfield">
        <span>Describe the product</span>
        <span className="fixrow">
          <input className="inp" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }} placeholder="for example ceramic mug" />
          <button type="button" className="btn small" disabled={q.trim().length < 3 || state === 'busy'} onClick={() => void search()}>{state === 'busy' ? 'Searching…' : 'Find a code'}</button>
          <button type="button" className="btn small ghost" onClick={onClose}>Close</button>
        </span>
      </label>
      {state === 'failed' ? <p className="note" role="status">The UK Tariff search isn’t available right now. You can still type a code yourself.</p> : null}
      {state === 'done' && !list.length ? <p className="note" role="status">No suggestions. Try different words, such as the material or what it is used for.</p> : null}
      {list.length ? (
        <ul className="hslist">
          {list.map(s => (
            <li key={s.code}>
              <div className="hsrow">
                <span className="mono hscode">{s.code}</span>
                <span className="hstitle" title={s.title}>{shortText(s.title)}</span>
                {s.kind === 'commodity'
                  ? <button type="button" className="btn small" onClick={() => onPick(s.code)}>Use this code</button>
                  : <button type="button" className="btn small ghost" aria-expanded={!!open[s.code]} onClick={() => void expand(s.code)}>Show full codes</button>}
              </div>
              {open[s.code] === 'loading' ? <p className="note" role="status">Loading…</p> : null}
              {Array.isArray(open[s.code]) ? (
                <ul className="hschildren">
                  {(open[s.code] as HsChild[]).length ? (open[s.code] as HsChild[]).map(c => (
                    <li key={c.code} className="hsrow"><span className="mono hscode">{c.code}</span><span className="hstitle" title={c.description}>{shortText(c.description)}</span><button type="button" className="btn small" onClick={() => onPick(c.code)}>Use this code</button></li>
                  )) : <li className="note">No full codes to show for this heading.</li>}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The advisory card: each item's code, whether the UK Tariff has it, its official wording, and help to find a better code. */
export function HsCard({ b, hs, enabled, onEnable, onPick, locked }: { b: any; hs: HsMap; enabled: boolean; onEnable: () => void; onPick: (itemIndex: number, code: string) => void; locked?: boolean }) {
  const [finder, setFinder] = useState<number | null>(null);
  const items: any[] = b.items || [];
  if (!items.length) return null;
  return (
    <div className="card section hscard">
      <h3>HS code check <span className="pill grey">advisory</span></h3>
      <p className="note" style={{ marginTop: -6 }}>Checked against the UK Trade Tariff. This is guidance only: rule R-01 (at least 6 digits) is what decides, and nothing here stops you booking.</p>
      {!enabled ? <div className="row-actions" style={{ justifyContent: 'flex-start' }}><button type="button" className="btn small ghost" onClick={onEnable}>Check these codes against the UK tariff</button><span className="note">The codes (nothing else) are sent to the UK Tariff service.</span></div> : null}
      <ul className="hsitems">
        {items.map((it, i) => {
          const code = digitsOf(it.hs);
          const r = enabled ? hs[code] : undefined;
          const res: HsResult | null = r && r !== 'loading' ? r : null;
          const state = !code ? 'blank' : res ? res.state : null;
          const [tone, label] = state ? BADGE[state] : ['grey', enabled ? 'Checking…' : 'Not checked'];
          const official = res && res.description && (res.state === 'verified' || res.state === 'six-digits' || res.state === 'partial') ? res.description : null;
          // For a partial code the heading's wording is broad, so the codes under it are part of what the description is compared with.
          const off = !!official && descriptionLooksOff(it.desc, [official, ...(res ? res.children.map(c => c.description) : [])].join(' '));
          const name = it.sku || it.desc || 'item ' + (i + 1);
          return (
            <li key={i} className="hsitem">
              <div className="hshead">
                <b>{name}</b>
                <span className="mono">{code || 'no code'}</span>
                <span className={'pill ' + tone}>{label}</span>
              </div>
              {official ? <p className="hsofficial"><span className="note">Official description: </span>{official}</p> : null}
              {res ? <p className="note">{hsMessage(res)}</p> : null}
              {off ? <p className="hsoff" role="note">The description you gave (“{it.desc}”) doesn’t seem to match this code’s official wording. Worth a second look. This is only a suggestion.</p> : null}
              {res && (res.state === 'six-digits' || res.state === 'partial') && res.children.length && !locked ? (
                <div className="fixrow" role="group" aria-label={'Full codes for ' + name}>
                  {res.children.slice(0, 4).map(c => <button key={c.code} type="button" className="btn small ghost" title={c.description} onClick={() => onPick(i, c.code)}>{'Use ' + c.code}</button>)}
                </div>
              ) : null}
              {!locked && (state === 'blank' || state === 'not-found' || state === 'six-digits' || state === 'partial' || state === 'short') ? (
                finder === i
                  ? <HsFinder initial={it.desc || ''} onPick={c => { onPick(i, c); setFinder(null); }} onClose={() => setFinder(null)} />
                  : <button type="button" className="btn small ghost" onClick={() => setFinder(i)}>{'Find a code for ' + name}</button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
