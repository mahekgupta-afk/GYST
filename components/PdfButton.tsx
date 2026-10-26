'use client';
import { useState } from 'react';

/** A button that builds a PDF in the browser. The PDF code is only loaded when it is clicked; a failure shows a friendly message. */
export default function PdfButton({ label, run, small = true }: { label: string; run: () => Promise<void>; small?: boolean }) {
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  return (
    <span className="pdfbtn">
      <button type="button" className={'btn ghost' + (small ? ' small' : '')} disabled={state === 'busy'}
        onClick={async () => { setState('busy'); try { await run(); setState('idle'); } catch { setState('error'); } }}>
        {state === 'busy' ? 'Preparing PDF…' : label}
      </button>
      {state === 'error' ? <span className="fixerr" role="alert">The PDF could not be created. Please try again.</span> : null}
    </span>
  );
}
