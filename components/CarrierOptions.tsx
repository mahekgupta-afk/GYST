'use client';
import { useMemo, useState } from 'react';
import { PF } from '@/lib/pf';
import { compare, DEST_LIST, PRIORITY_LIST } from '@/lib/compare';

export type UseDetails = { dest: string; pallets: number; weight: number; priority: string };
const kg = (n: number) => PF.nf(Math.round(n * 100) / 100) + ' kg';
const plu = (n: number, w: string) => n + ' ' + w + (n === 1 ? '' : 's');

/** The fixed rate card (read from the engine's data, not copied) and a tool to compare the carriers on a route for one shipment. */
export default function CarrierOptions({ onUse }: { onUse: (d: UseDetails) => void }) {
  const [dest, setDest] = useState('Germany');
  const [pallets, setPallets] = useState('');
  const [weight, setWeight] = useState('');
  const [priority, setPriority] = useState('Cheapest');
  const out = useMemo(() => compare({ dest, pallets, weight, priority }), [dest, pallets, weight, priority]);
  const cmp = out.comparison;

  return (
    <section className="card section co" id="carriers" aria-labelledby="co-h">
      <h2 id="co-h">Carrier options</h2>
      <p className="muted">The fixed rate card, and a way to compare the three carriers for a shipment before you book. It uses the same carrier logic as every booking.</p>

      <h3>Rate card</h3>
      <div className="scroll"><table>
        <thead><tr><th>Carrier</th><th>Service</th><th>Route</th><th className="num">£ per pallet</th><th className="num">Transit days</th><th className="num">On time</th><th className="num">Max kg per pallet</th></tr></thead>
        <tbody>{PF.CARRIERS.map((x: any, i: number) => <tr key={i}><td><b>{x.carrier}</b></td><td>{x.service}</td><td>{'UK to ' + x.dest}</td><td className="num">{x.price}</td><td className="num">{x.transit}</td><td className="num">{x.ontime + '%'}</td><td className="num">{x.maxKg}</td></tr>)}</tbody>
      </table></div>

      <h3>Compare carriers for a shipment</h3>
      <form className="co-form" onSubmit={e => e.preventDefault()} noValidate>
        <label className="fld"><span>Destination country</span>
          <select id="co-dest" value={dest} onChange={e => setDest(e.target.value)}>{DEST_LIST.map(d => <option key={d}>{d}</option>)}</select>
        </label>
        <label className="fld"><span>Pallets</span>
          <input id="co-pallets" className="inp" inputMode="numeric" autoComplete="off" value={pallets} onChange={e => setPallets(e.target.value)}
            aria-invalid={!!out.errors.pallets} aria-describedby={out.errors.pallets ? 'co-pallets-err' : undefined} />
          {out.errors.pallets ? <small id="co-pallets-err" className="fielderr" role="alert">{out.errors.pallets}</small> : null}
        </label>
        <label className="fld"><span>Total gross weight (kg)</span>
          <input id="co-weight" className="inp" inputMode="decimal" autoComplete="off" value={weight} onChange={e => setWeight(e.target.value)}
            aria-invalid={!!out.errors.weight} aria-describedby={out.errors.weight ? 'co-weight-err' : undefined} />
          {out.errors.weight ? <small id="co-weight-err" className="fielderr" role="alert">{out.errors.weight}</small> : null}
        </label>
        <label className="fld"><span>Seller priority</span>
          <select id="co-priority" value={priority} onChange={e => setPriority(e.target.value)}>{PRIORITY_LIST.map(p => <option key={p}>{p}</option>)}</select>
        </label>
      </form>

      {!cmp ? <p className="note" role="status">{out.errors.pallets || out.errors.weight ? 'Fix the highlighted value to compare carriers.' : 'Enter pallets and total gross weight to compare the carriers.'}</p> : (
        <div className="co-out" role="status" aria-live="polite">
          <p className="co-sum">{plu(cmp.pallets, 'pallet') + ' · ' + kg(cmp.weight) + ' · ' + kg(cmp.wpp) + ' per pallet · UK to ' + cmp.dest}</p>
          {cmp.none ? <div className="warnbox">{'No carrier on this route can take ' + kg(cmp.wpp) + ' per pallet. The load has to be split across more pallets. Pallets needed, and the total price, for each carrier:'}</div> : (
            <div className="recbox"><b>{cmp.winner!.carrier + ' · ' + cmp.winner!.service}</b> <span className="pill green">Recommended</span><br />{cmp.reason}</div>
          )}
          <div className="scroll"><table>
            <thead><tr><th>Carrier</th><th className="num">Total price</th><th className="num">Transit</th><th className="num">On time</th><th className="num">Per pallet vs limit</th><th>Status</th></tr></thead>
            <tbody>{cmp.rows.map(r => (
              <tr key={r.carrier} className={r.recommended ? 'co-win' : ''}>
                <td><b>{r.carrier}</b> <span className="note">{r.service}</span>{r.recommended ? <> <span className="pill green">Recommended</span></> : null}</td>
                <td className="num">{PF.gbp(r.total)}<div className="note">{PF.gbp(r.price) + ' × ' + cmp.pallets}</div></td>
                <td className="num">{plu(r.transit, 'day')}</td>
                <td className="num">{r.ontime + '%'}</td>
                <td className="num">{kg(r.wpp) + ' of ' + kg(r.maxKg)}</td>
                <td>{r.fits
                  ? <span className="pill green">{'Fits, ' + kg(r.spare) + ' spare'}</span>
                  : <><span className="pill red">{'Over by ' + kg(r.over)}</span><div className="note">{plu(r.minPallets, 'pallet') + ' would fit, at ' + PF.gbp(r.minCost)}</div></>}</td>
              </tr>))}</tbody>
          </table></div>
          {!cmp.none ? (
            <div className="co-win-row">
              <b>Winner by priority</b>
              <ul>{cmp.winners.map(w => <li key={w.priority}><span>{w.priority}</span> <b>{w.carrier}</b></li>)}</ul>
              <p className="note">{'Balanced scores (0 to 1, across the carriers that fit): ' + cmp.scores.map(s => s.carrier.replace('Carrier ', '') + ' ' + s.score.toFixed(2)).join(', ')}</p>
            </div>
          ) : null}
          <div className="row-actions"><button type="button" className="btn" onClick={() => onUse({ dest: cmp.dest, pallets: cmp.pallets, weight: cmp.weight, priority: cmp.priority })}>Use these details in a booking</button></div>
        </div>
      )}
    </section>
  );
}
