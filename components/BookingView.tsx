'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchJson } from '@/lib/net';
import type { Confirmation } from '@/lib/confirmation';
import ConfirmationPanel from './ConfirmationPanel';

type State = { kind: 'loading' } | { kind: 'ok'; c: Confirmation } | { kind: 'missing' } | { kind: 'error' };

/** Reopens a saved confirmation from its link. The secret key in the link is what lets the server show it. */
export default function BookingView({ reference, k }: { reference: string; k: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    fetchJson('/api/bookings/' + encodeURIComponent(reference) + '?k=' + encodeURIComponent(k))
      .then(({ res, json }) => {
        if (!live) return;
        if (res.ok && json.confirmation) setState({ kind: 'ok', c: json.confirmation });
        else setState(res.status === 404 ? { kind: 'missing' } : { kind: 'error' });
      })
      .catch(() => { if (live) setState({ kind: 'error' }); });
    return () => { live = false; };
  }, [reference, k]);
  return (
    <main className="bookingpage">
      <p><Link className="linkbtn" href="/">← Back to GYST Shipments</Link></p>
      <h1 className="bookingpage-h">Your booking confirmation</h1>
      {state.kind === 'loading' ? <p className="note" role="status">Loading your confirmation…</p> : null}
      {state.kind === 'ok' ? <ConfirmationPanel c={state.c} /> : null}
      {state.kind === 'missing' ? <div className="card section" role="alert"><h2>We couldn’t open that confirmation</h2><p>The link may be incomplete or wrong. Open the confirmation using the full link that was shown when the booking was made, including everything after the “?”.</p></div> : null}
      {state.kind === 'error' ? <div className="card section" role="alert"><h2>Confirmations aren’t available right now</h2><p>Please try again in a minute.</p></div> : null}
    </main>
  );
}
