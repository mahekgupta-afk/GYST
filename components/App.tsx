'use client';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { PF, C } from '@/lib/pf';
import { Detail, SheetCard, UploadResults, plural } from './Results';

type Msg = { role: 'bot' | 'user'; text: string; chips?: string[] | null; typing?: boolean };
const sig = (c: any) => JSON.stringify(Object.assign({}, c.b, { _confirmed: undefined }));
const GREETING = 'Let’s get your shipment sorted. Tell me what you’re sending, in your own words, and I’ll only ask about what’s missing.\nOnce I have it, I’ll check the paperwork before it leaves and recommend the right carrier.\nI cover collections from London, Manchester, Birmingham and Leeds to Germany, France and the Netherlands.';

export default function App() {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [mode, setMode] = useState<'chat' | 'upload'>('chat');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [aiOn, setAiOn] = useState(false);
  const [upload, setUpload] = useState<any>(null);
  const [sel, setSelState] = useState<string | null>(null);
  const [thumpKey, setThumpKey] = useState(0);
  const [today, setToday] = useState('');
  const [uploadMsg, setUploadMsg] = useState('');
  const [drag, setDrag] = useState(false);
  const [input, setInput] = useState('');

  const chat = useRef<any>(C.newChat());
  const prev = useRef<{ red: number; amber: number } | null>(null);
  const msgsRef = useRef<Msg[]>([]);
  const logEl = useRef<HTMLDivElement>(null);
  const inputEl = useRef<HTMLTextAreaElement>(null);
  const fileEl = useRef<HTMLInputElement>(null);

  const setM = (m: Msg[]) => { msgsRef.current = m; setMsgs(m); };
  const say = (role: Msg['role'], text: string, chips?: string[] | null, typing?: boolean) => setM([...msgsRef.current, { role, text, chips: chips || null, typing: !!typing }]);
  const popMsg = () => setM(msgsRef.current.slice(0, -1));
  const thump = () => setThumpKey(k => k + 1);

  const greet = useCallback(() => {
    chat.current = C.newChat(); prev.current = null;
    setM([{ role: 'bot', text: GREETING, chips: null }]);
    bump();
  }, []);

  useEffect(() => {
    setToday('Checking against today, ' + PF.niceDate(PF.todayISO()));
    greet();
    fetch('/api/parse-message').then(r => r.json()).then(j => { if (j && j.enabled) { setAiOn(true); } }).catch(() => {});
  }, [greet]);

  useEffect(() => { const el = logEl.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs]);
  useEffect(() => { const t = inputEl.current; if (t) { t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight) + 'px'; } }, [input]);

  const completeChips = (ev: any) => {
    if (chat.current.b._confirmed) return ['Start a new booking'];
    const out = ['Add a pallet', 'Change priority to Fastest'];
    if (ev && ev.status !== 'blocked') out.unshift('Confirm booking');
    return out;
  };

  function compose(log: any, snap: any): { text: string; chips: string[] | null } {
    const c = chat.current, a = c.asked;
    const ack = C.ackText(log);
    if (!log.understood) {
      if (log.unsupported) return { text: 'I can’t book that: ' + log.unsupported + '. ' + (a ? a.q : ''), chips: a ? a.chips : null };
      return { text: 'Sorry, I didn’t catch that. ' + (a ? (a.hint || '') + a.q : 'You can say things like “add a pallet”, “change the priority to Fastest”, “use Carrier B” or “confirm”.'), chips: a ? a.chips : completeChips(null) };
    }
    let head = ack || (a ? '' : 'Noted.');
    if (log.unsupported) head += '\nI can’t book “' + log.unsupported + '”. I only handle the cities listed above.';
    if (a) return { text: (head ? head + '\n' : '') + a.q, chips: a.chips };
    const b = c.b;
    if (JSON.stringify(Object.assign({}, snap.b, { _confirmed: undefined })) !== sig(c)) b._confirmed = false;
    const ev = PF.evaluate(b);
    if (log.intent === 'confirm') {
      if (ev.status === 'blocked') return { text: 'I can’t confirm yet: ' + plural(ev.counts.red, 'red problem') + ' still need fixing. ' + ev.issues.filter((i: any) => i.sev === 'red').slice(0, 4).map((i: any) => i.title).join('; ') + '.', chips: completeChips(ev) };
      b._confirmed = true; prev.current = { red: ev.counts.red, amber: ev.counts.amber };
      return { text: 'Booking confirmed with ' + ev.rec.selected.carrier + '. The “what happens next” steps are on the right.', chips: ['Start a new booking'] };
    }
    const first = !prev.current;
    const lines = ev.issues.slice(0, 6).map((i: any) => '• ' + (i.rule === 'DATA' ? 'Missing detail' : i.rule) + ': ' + i.title + (i.item ? ' (' + i.item + ')' : ''));
    if (ev.issues.length > 6) lines.push('• …and ' + (ev.issues.length - 6) + ' more');
    const verdict = ev.status === 'blocked' ? 'Pre-flight result: ' + plural(ev.counts.red, 'red problem') + (ev.counts.amber ? ' and ' + plural(ev.counts.amber, 'amber warning') : '') + '. Don’t ship yet.'
      : ev.status === 'warning' ? 'Pre-flight result: no red problems, but ' + plural(ev.counts.amber, 'amber warning') + '.'
      : 'Pre-flight result: all ten rules pass.';
    let text = head + '\n' + (first ? 'That’s everything I need. ' : 'I’ve re-run the checks. ') + verdict;
    if (prev.current && !first) text += ' (Before: ' + prev.current.red + ' red, ' + prev.current.amber + ' amber.)';
    if (lines.length) text += '\n' + lines.join('\n');
    const r = ev.rec;
    if (r.recommended) text += '\nRecommended carrier: ' + r.recommended.carrier + ' (' + r.recommended.service + '), ' + PF.gbp(r.recommended.price * r.pallets) + '.';
    else text += '\nNo carrier can take this weight per pallet. See the fix on the right.';
    text += '\nYou can change any detail, for example “add a pallet”.';
    prev.current = { red: ev.counts.red, amber: ev.counts.amber };
    return { text, chips: completeChips(ev) };
  }

  /** Ask Gemini (via our server route) to read the message. Returns null on any failure. */
  async function readWithAI(c0: any, text: string, askQ: string | null) {
    const res = await fetch('/api/parse-message', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ booking: c0.b, text, askText: askQ }) });
    if (!res.ok) { const e: any = new Error('ai'); e.status = res.status; throw e; }
    const { result } = await res.json();
    return C.aiToEx(result, c0);
  }

  async function send(textIn?: string) {
    const text = (textIn !== undefined ? textIn : input).trim();
    if (!text || busy) return;
    setInput('');
    if (/^\s*(start over|start a new booking|new booking|reset)\b/i.test(text)) { say('user', text); greet(); return; }
    say('user', text);
    setBusy(true);
    const c0 = chat.current, snap = C.cloneChat(c0);
    const askQ = c0.asked ? c0.asked.q : null;
    let log: any = null;
    if (aiOn) {
      say('bot', 'Reading your message…', null, true);
      try {
        const ex = await readWithAI(c0, text, askQ);
        if (!ex) throw new Error('parse');
        popMsg();
        log = C.stepAI(c0, text, ex);
        if (!log.understood) { chat.current = C.cloneChat(snap); log = null; }
      } catch (e: any) {
        popMsg();
        chat.current = C.cloneChat(snap);
        log = null;
        if (e && e.status === 503) setAiOn(false);
      }
    }
    if (!log) log = C.step(chat.current, text, {});
    setBusy(false);
    if (log.reset) { greet(); return; }
    const reply = compose(log, snap);
    say('bot', reply.text, reply.chips);
    bump();
  }

  const changeChat = (fn: () => void, msg: string) => {
    const b = chat.current.b;
    const before = PF.evaluate(b); fn(); b._confirmed = msg === 'Booking confirmed.';
    const ev = PF.evaluate(b);
    say('bot', msg + ' Checks re-run: ' + plural(ev.counts.red, 'red problem') + ', ' + plural(ev.counts.amber, 'amber warning') + ' (was ' + before.counts.red + ' and ' + before.counts.amber + ').', completeChips(ev));
    prev.current = { red: ev.counts.red, amber: ev.counts.amber };
    thump(); bump();
  };

  const showUpload = (u: any) => { setUpload(u); setSelState(null); thump(); setMode('upload'); };
  async function handleFile(file: File) {
    setUploadMsg('Reading ' + file.name + '…');
    try {
      const mod: any = await import('xlsx');
      const res = PF.parseWorkbook(mod.default ?? mod, await file.arrayBuffer());
      if (res.error) showUpload({ error: res.error, fileName: file.name });
      else if (!res.bookings.length) showUpload({ error: 'The Bookings sheet has no rows with a Booking ID.', fileName: file.name });
      else {
        showUpload({ fileName: file.name, bookings: res.bookings, warnings: res.warnings });
        saveUpload(file);
      }
    } catch (e: any) { showUpload({ error: (e && e.message) || 'Something went wrong reading that file.', fileName: file.name }); }
    setUploadMsg('');
  }
  /** Fire-and-forget: store the original file in Neon. The user already has their results, so failures are silent. */
  function saveUpload(file: File) {
    const form = new FormData();
    form.append('file', file);
    fetch('/api/uploads', { method: 'POST', body: form }).catch(() => {});
  }
  /** Blank workbook in the template format, so users can see the expected sheets and columns. */
  async function downloadTemplate() {
    const mod: any = await import('xlsx');
    const X = mod.default ?? mod;
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Bookings: one row per shipment. Enter data from row 3.'], PF.BH]), 'Bookings');
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Items: one row per product in a booking. Enter data from row 3.'], PF.IH]), 'Items');
    X.writeFile(wb, 'preflight-template.xlsx');
  }
  const setSel = (id: string | null) => { setSelState(id); thump(); };

  const c = chat.current, b = c.b;
  const lastIdx = msgs.length - 1;

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1 className="brand">Get Your Ship Together</h1>
          <p className="tag">Book a UK to EU shipment by chat or by uploading your sheets. Every booking is checked against the rulebook before it leaves.</p>
        </div>
        <div className="today">{today}</div>
      </header>

      <main className="grid">
        <section className="card left" aria-label="Start a booking">
          <div className="tabs" role="tablist">
            <button className="tab" role="tab" id="tab-chat" aria-selected={mode === 'chat'} aria-controls="pane-chat" onClick={() => setMode('chat')}>Chat to book</button>
            <button className="tab" role="tab" id="tab-upload" aria-selected={mode === 'upload'} aria-controls="pane-upload" onClick={() => setMode('upload')}>Upload a file</button>
          </div>
          <div className={'pane' + (mode === 'chat' ? ' on' : '')} id="pane-chat" role="tabpanel" aria-labelledby="tab-chat">
            <div className="log" ref={logEl} role="log" aria-live="polite">
              {msgs.map((m, i) => (
                <div key={i}>
                  <div className={'msg ' + m.role + (m.typing ? ' typing' : '')}>{m.text.split('\n').map((l, k) => <p key={k}>{l}</p>)}</div>
                  {m.chips && i === lastIdx && !busy ? <div className="chips">{m.chips.map(ch => <button key={ch} className="chip" onClick={() => send(ch)}>{ch}</button>)}</div> : null}
                </div>
              ))}
            </div>
            <div className="composer">
              <textarea ref={inputEl} rows={1} value={input} placeholder="Describe your shipment…" aria-label="Your message"
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <button className="btn" disabled={busy} onClick={() => send()}>Send</button>
              <div className="aibar"><span>Say “start over” at any time to begin a new booking.</span></div>
            </div>
          </div>
          <div className={'pane' + (mode === 'upload' ? ' on' : '')} id="pane-upload" role="tabpanel" aria-labelledby="tab-upload">
            <div className="upload">
              <div className={'drop' + (drag ? ' over' : '')}
                onDragEnter={e => { e.preventDefault(); setDrag(true); }} onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={e => { e.preventDefault(); setDrag(false); }}
                onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}>
                <strong>Drop your booking file here</strong>
                <span className="note">An Excel or OpenDocument file with a Bookings sheet and an Items sheet, in the template format.</span><br />
                <button className="btn" onClick={() => fileEl.current?.click()}>Choose a file</button>
                <input ref={fileEl} type="file" accept=".xlsx,.xls,.xlsm,.ods" className="sr" tabIndex={-1} aria-label="Upload booking file"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
              </div>
              <button className="linkbtn" onClick={downloadTemplate}>Download the blank template (.xlsx)</button>
              <p className="note">Uploaded files are stored securely so we can review how your sheets were checked.</p>
              <div className="note" role="status">{uploadMsg}</div>
            </div>
          </div>
        </section>

        <section className="right" aria-label="Results">
          {mode === 'chat' ? (
            !C.isComplete(c) ? (
              <>
                <SheetCard b={b} title="Your booking so far" showProgress />
                <div className="card section"><h3>Pre-flight checks</h3><p className="muted">The ten rulebook checks and the carrier recommendation appear here as soon as the details are complete. Nothing is guessed: anything I’m unsure of, I’ll ask.</p></div>
              </>
            ) : (
              <Detail b={b} aiOn={aiOn} thumpKey={thumpKey} opts={{ change: changeChat }} sheet={<SheetCard b={b} title="Booking sheet" />} />
            )
          ) : (
            <UploadResults upload={upload} sel={sel} setSel={setSel} bump={bump} thumpKey={thumpKey} aiOn={aiOn} />
          )}
        </section>
      </main>

      <details className="card ref">
        <summary>Rulebook and rate card used for every check</summary>
        <div className="inner">
          <div className="scroll"><table>
            <thead><tr><th>Rule</th><th>Check</th><th>If broken</th></tr></thead>
            <tbody>{PF.RULES.map((x: any) => <tr key={x.id}><td><b>{x.id}</b></td><td>{x.text}</td><td><span className={'pill ' + x.sev}>{x.sev === 'red' ? 'Red' : 'Amber'}</span></td></tr>)}</tbody>
          </table></div>
          <p style={{ margin: '16px 0 8px' }}><b>Carrier rate card (fixed)</b></p>
          <div className="scroll"><table>
            <thead><tr><th>Carrier</th><th>Service</th><th>To</th><th className="num">£ per pallet</th><th className="num">Days</th><th className="num">On time</th><th className="num">Max kg per pallet</th></tr></thead>
            <tbody>{PF.CARRIERS.map((x: any, i: number) => <tr key={i}><td>{x.carrier}</td><td>{x.service}</td><td>{x.dest}</td><td className="num">{x.price}</td><td className="num">{x.transit}</td><td className="num">{x.ontime + '%'}</td><td className="num">{x.maxKg}</td></tr>)}</tbody>
          </table></div>
        </div>
      </details>
      <p className="foot">Checks run in the browser using fixed rules, so the same booking always gets the same result. Delivery dates are estimates based on calendar days in transit.</p>
    </div>
  );
}
