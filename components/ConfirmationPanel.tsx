'use client';
import { useState } from 'react';
import { PF } from '@/lib/pf';
import { SIMULATED_DETAIL, type Confirmation } from '@/lib/confirmation';
import PdfButton from './PdfButton';

const d = (iso: string | null) => (iso ? PF.dmy(iso) : '—');
const nice = (iso: string | null) => (iso ? PF.niceDate(iso) : '—');

/** Copies the secret link to this confirmation. Anyone with the link can open it, so it says so. */
function CopyLink({ link }: { link: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <span className="pdfbtn">
      <button type="button" className="btn small ghost" onClick={async () => {
        try { await navigator.clipboard.writeText(link); setState('copied'); } catch { setState('failed'); }
      }}>{state === 'copied' ? 'Link copied' : 'Copy link to this confirmation'}</button>
      {state === 'failed' ? <span className="fixerr" role="alert">Copying isn’t available here. Select the link below and copy it.</span> : null}
    </span>
  );
}

/**
 * The booking confirmation: what was booked, with which carrier at what price, the reason, the checks that passed,
 * and a timeline in which only "Booked" has happened. Everything after it is an estimate, and the whole thing is labelled simulated.
 */
export default function ConfirmationPanel({ c, link }: { c: Confirmation; link?: string | null }) {
  const s = c.shipment;
  return (
    <section className="confirmation" id="booking-confirmation" aria-labelledby={'conf-' + c.reference}>
      <div className="simbanner" role="note">
        <b>{c.notice}</b>
        <span>{SIMULATED_DETAIL}</span>
      </div>
      <div className="confirmed" role="status">
        <b id={'conf-' + c.reference} tabIndex={-1}>{'Booked. Reference ' + c.reference}</b>
        <span className="note"> {'Recorded ' + nice(c.bookedAt.slice(0, 10))}</span>
      </div>

      <div className="confgrid">
        <div className="confcard">
          <h4>Carrier</h4>
          <p className="conf-carrier">{c.carrier.name + ' · ' + c.carrier.service}</p>
          <dl className="sheet">
            <div><dt>Price</dt><dd>{PF.gbp(c.carrier.pricePerPallet) + ' × ' + c.carrier.pallets + ' pallet' + (c.carrier.pallets === 1 ? '' : 's') + ' = ' + PF.gbp(c.carrier.total)}</dd></div>
            <div><dt>Transit</dt><dd>{c.carrier.transit + ' calendar days'}</dd></div>
            <div><dt>On time</dt><dd>{c.carrier.ontime + '%'}</dd></div>
            <div><dt>Estimated delivery</dt><dd>{nice(c.estimatedDelivery)}</dd></div>
          </dl>
        </div>
        <div className="confcard">
          <h4>Shipment</h4>
          <dl className="sheet">
            <div><dt>Seller</dt><dd>{s.seller || '—'}</dd></div>
            <div><dt>Collection from</dt><dd>{s.originCity || '—'}</dd></div>
            <div><dt>Delivery to</dt><dd>{(s.destCity || '—') + (s.destCountry ? ', ' + s.destCountry : '')}</dd></div>
            <div><dt>Delivery type</dt><dd>{s.destType || '—'}</dd></div>
            <div><dt>Delivery appointment</dt><dd>{s.appointment || '—'}</dd></div>
            <div><dt>Ready to ship</dt><dd>{d(s.readyDate)}</dd></div>
            <div><dt>Pallets</dt><dd>{s.pallets}</dd></div>
            <div><dt>Cartons</dt><dd>{s.cartons ?? '—'}</dd></div>
            <div><dt>Gross weight</dt><dd>{s.grossWeight === null ? '—' : PF.nf(s.grossWeight) + ' kg'}</dd></div>
            <div><dt>Declared value</dt><dd>{s.declaredValue === null ? '—' : PF.gbp(s.declaredValue)}</dd></div>
            <div><dt>Priority</dt><dd>{s.priority}</dd></div>
          </dl>
        </div>
      </div>

      {c.reason ? <div className="confblock"><h4>Why this carrier</h4><p>{c.reason}</p></div> : null}

      <div className="confblock">
        <h4>Checks</h4>
        <p>{c.checks.passed + ' of ' + c.checks.total + ' checks passed.' + (c.checks.acceptedWarnings.length ? ' Warnings you accepted:' : '')}</p>
        {c.checks.acceptedWarnings.length ? <ul>{c.checks.acceptedWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
        {c.changes.length ? <p className="note">{c.changes.length + ' correction' + (c.changes.length === 1 ? '' : 's') + ' made before booking (listed in the PDF).'}</p> : null}
      </div>

      <div className="confblock">
        <h4>Status</h4>
        <ol className="timeline" aria-label="Booking status timeline">
          {c.timeline.map(t => (
            <li key={t.key} className={t.status} aria-current={t.status === 'active' ? 'step' : undefined}>
              <span className="tl-dot" aria-hidden="true" />
              <span className="tl-label">{t.label}</span>
              <span className="tl-date">{t.status === 'active' ? 'Done · ' + d(t.date) : t.date ? 'Estimated ' + d(t.date) : 'Date to be confirmed'}</span>
            </li>
          ))}
        </ol>
        <p className="note">Only “Booked” has happened. The other steps show estimated dates and are not updated by a carrier.</p>
      </div>

      <div className="row-actions" style={{ justifyContent: 'flex-start' }}>
        <PdfButton small={false} label="Download booking confirmation (PDF)" run={async () => { const m = await import('@/lib/pdf/confirmation'); m.downloadConfirmation(c); }} />
        {link ? <CopyLink link={link} /> : null}
        {link ? <a className="btn small ghost" href={link} target="_blank" rel="noopener">Open this confirmation on its own page</a> : null}
      </div>
      {link ? <p className="note">{'Anyone with this link can open the confirmation, so share it carefully: '}<span className="mono confirm-link">{link}</span></p> : null}
    </section>
  );
}
