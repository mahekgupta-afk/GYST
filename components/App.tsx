'use client';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { PF, C } from '@/lib/pf';
import { Detail, SheetCard, UploadResults, plural, type UploadHandlers } from './Results';
import { applyChange, resetBooking, correctedRows, unacknowledged, issueKey, type Spec } from '@/lib/fixes';
import { bookShipment } from '@/lib/bookingClient';
import { fetchJson } from '@/lib/net';
import ThemeToggle from './ThemeToggle';

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
  const [filter, setFilter] = useState<string>('all');
  const [thumpKey, setThumpKey] = useState(0);
  const [today, setToday] = useState('');
  const [uploadMsg, setUploadMsg] = useState('');
  const [saveNote, setSaveNote] = useState('');
  const [drag, setDrag] = useState(false);
  const [input, setInput] = useState('');

  const [bookBusy, setBookBusy] = useState(false);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const pendingBook = useRef(false);
  const inFlight = useRef<Set<any>>(new Set());
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
    fetchJson('/api/parse-message').then(({ json }) => { if (json && json.enabled) { setAiOn(true); } }).catch(() => {});
  }, [greet]);

  // The chat panel is sized to the space left under the header, so the message box is on screen when the page opens.
  useEffect(() => {
    const hero = document.querySelector('.hero') as HTMLElement | null;
    if (!hero) return;
    const set = () => document.documentElement.style.setProperty('--chrome', Math.ceil(hero.getBoundingClientRect().height) + 28 + 'px');
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(set);
    ro.observe(hero);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { const el = logEl.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs]);
  // Grow with the text. An empty box keeps its natural height (measuring it at page load could leave it stuck at the maximum).
  useEffect(() => { const t = inputEl.current; if (!t) return; if (!input) { t.style.height = ''; return; } t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight) + 'px'; }, [input]);

  const completeChips = (ev: any) => {
    if (chat.current.b._confirmed) return ['Start a new booking'];
    const out = ['Add a pallet', 'Change priority to Fastest'];
    if (ev && ev.status !== 'blocked') out.unshift('Book it');
    return out;
  };

  function compose(log: any, snap: any): { text: string; chips: string[] | null } {
    const c = chat.current, a = c.asked;
    const ack = C.ackText(log);
    const dp = log.dateProblem;
    const dateText = dp ? (dp.invalid ? '“' + dp.invalid + '” isn’t a real date. ' : '“' + dp.ambiguous + '” isn’t an exact date, so I haven’t saved one. ') + 'Please give me the day, for example 05-11-2026 or 5 Nov.' : '';
    const extra = [(log.scope || []).join('\n'), dateText].filter(Boolean).join('\n');
    const askAgain = a && !(dp && a.key === 'readyDate');
    // A refused value: say which field and why, keep the old value, ask again. Valid values in the same message were still stored.
    const refusals = (log.rejected || []).map((r: any) => r.message);
    if (refusals.length) return { text: [ack, extra, ...refusals].filter(Boolean).join('\n'), chips: null };
    if (!log.understood) {
      if (extra) return { text: extra + (askAgain ? '\n' + a.q : ''), chips: a && askAgain ? a.chips : null };
      return { text: 'Sorry, I didn’t catch that. ' + (a ? (a.hint || '') + a.q : 'You can say things like “add a pallet”, “change the priority to Fastest”, “use Carrier B” or “book it”.'), chips: a ? a.chips : completeChips(null) };
    }
    let head = ack || (a ? '' : 'Noted.');
    if (extra) head = (head ? head + '\n' : '') + extra;
    if (a && !askAgain) return { text: head, chips: null };
    if (a) return { text: (head ? head + '\n' : '') + a.q, chips: a.chips };
    const b = c.b;
    if (JSON.stringify(Object.assign({}, snap.b, { _confirmed: undefined })) !== sig(c)) b._confirmed = false;
    const ev = PF.evaluate(b);
    if (log.intent === 'confirm') {
      if (ev.status === 'blocked') return { text: 'I can’t book this yet: ' + plural(ev.counts.red, 'red problem') + ' still need fixing. ' + ev.issues.filter((i: any) => i.sev === 'red').slice(0, 4).map((i: any) => i.title).join('; ') + '.', chips: completeChips(ev) };
      const open = unacknowledged(b, ev);
      if (open.length) return { text: 'I can book this once you’ve acknowledged ' + (open.length === 1 ? 'the warning' : 'the ' + open.length + ' warnings') + ': ' + open.slice(0, 4).map((i: any) => i.title).join('; ') + '. Tick “I understand” in the Book this shipment panel, or say “I acknowledge the warnings”.', chips: ['I acknowledge the warnings'] };
      pendingBook.current = true; prev.current = { red: ev.counts.red, amber: ev.counts.amber };
      return { text: 'Booking it with ' + ev.rec.selected.carrier + '…', chips: null };
    }
    const first = !prev.current;
    const lines = ev.issues.slice(0, 6).map((i: any) => '• ' + (i.rule === 'DATA' ? 'Missing detail' : i.rule === 'INPUT' ? 'Input error' : i.rule) + ': ' + i.title + (i.item ? ' (' + i.item + ')' : ''));
    if (ev.issues.length > 6) lines.push('• …and ' + (ev.issues.length - 6) + ' more');
    const verdict = ev.status === 'blocked' ? 'Pre-flight result: ' + plural(ev.counts.red, 'red problem') + (ev.counts.amber ? ' and ' + plural(ev.counts.amber, 'amber warning') : '') + '. Don’t ship yet.'
      : ev.status === 'warning' ? 'Pre-flight result: no red problems, but ' + plural(ev.counts.amber, 'amber warning') + '.'
      : 'Pre-flight result: all ten rules pass.';
    let text = head + '\n' + (first ? 'That’s everything I need. ' : 'I’ve re-run the checks. ') + verdict;
    if (prev.current && !first) text += ' (Before: ' + prev.current.red + ' red, ' + prev.current.amber + ' amber.)';
    if (lines.length) text += '\n' + lines.join('\n');
    const r = ev.rec;
    if (r.recommended) text += '\nRecommended carrier: ' + r.recommended.carrier + ' (' + r.recommended.service + '), ' + PF.gbp(r.recommended.price * r.pallets) + '.';
    else if (r.blocked) text += '\nFix the input errors above to get a carrier recommendation.';
    else text += '\nNo carrier can take this weight per pallet. See the fix on the right.';
    text += '\nYou can change any detail, for example “add a pallet”.';
    prev.current = { red: ev.counts.red, amber: ev.counts.amber };
    return { text, chips: completeChips(ev) };
  }

  /** Ask Gemini (via our server route) to read the message. Returns null on any failure. */
  async function readWithAI(c0: any, text: string, askQ: string | null) {
    // 15 s limit (lib/net.ts): never leave the chat hanging on "Reading your message…". A timeout or error falls back to the built-in parser.
    const { res, json } = await fetchJson('/api/parse-message', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ booking: c0.b, text, askText: askQ }) });
    if (!res.ok) { const e: any = new Error('ai'); e.status = res.status; throw e; }
    return C.aiToEx(json.result, c0);
  }

  async function send(textIn?: string) {
    const text = (textIn !== undefined ? textIn : input).trim();
    if (!text || busy) return;
    setInput('');
    if (/^\s*(start over|start a new booking|new booking|reset)\b/i.test(text)) { say('user', text); greet(); return; }
    say('user', text);
    if (chat.current.b._ref) {
      say('bot', 'This booking is already booked under reference ' + chat.current.b._ref + ' and can’t be changed here. Say “start over” to make a new booking.', ['Start a new booking']);
      return;
    }
    const cur = chat.current;
    if (C.isComplete(cur) && /acknowledg|\bi\s+(?:understand|accept)\b.*warning/i.test(text)) {
      const evA = PF.evaluate(cur.b);
      const keys = evA.issues.filter((i: any) => i.sev === 'amber').map(issueKey);
      cur.b._acks = Array.from(new Set([...(cur.b._acks || []), ...keys]));
      say('bot', keys.length ? 'Noted. You’ve acknowledged ' + plural(keys.length, 'warning') + '. Say “book it” when you’re ready.' : 'There are no warnings to acknowledge.', evA.status === 'blocked' ? completeChips(evA) : ['Book it']);
      bump();
      return;
    }
    setBusy(true);
    let aiFailed = false;
    const c0 = chat.current, snap = C.cloneChat(c0);
    const askQ = c0.reask ? c0.reask.message : c0.asked ? c0.asked.q : null;
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
        aiFailed = true;
        if (e && e.status === 503) setAiOn(false);
      }
    }
    if (!log) log = C.step(chat.current, text, {});
    setBusy(false);
    if (aiFailed && !log.understood && !log.reset) {
      say('bot', 'I couldn’t read that just now. Your booking so far is kept, so please try again or say it another way.', chat.current.asked ? chat.current.asked.chips : null);
      bump();
      return;
    }
    if (log.reset) { greet(); return; }
    const reply = compose(log, snap);
    say('bot', reply.text, reply.chips);
    bump();
    if (pendingBook.current) { pendingBook.current = false; void bookChat(); }
  }

  /** Records a booking through the server, which re-checks the rulebook and refuses red bookings. */
  /**
   * Records a booking through the server, which re-checks the rulebook and refuses red bookings.
   * One request at a time per booking (a second click while it is in flight does nothing), a 15 s limit,
   * and the button always comes back: on failure all booking data is kept and an error is shown.
   */
  async function bookOne(b: any, source: 'chat' | 'upload', fileName?: string) {
    if (b._ref) return { ok: true as const, reference: b._ref, saved: b._saved !== false };
    if (inFlight.current.has(b)) return { ok: false as const, message: 'Already booking.' };
    inFlight.current.add(b);
    setBookBusy(true); delete b._bookError; bump();
    try {
      const r = await bookShipment(b, source, fileName);
      if (r.ok) { b._confirmed = true; b._ref = r.reference; b._saved = r.saved; delete b._bookError; }
      else b._bookError = r.message;
      return r;
    } finally {
      inFlight.current.delete(b);
      setBookBusy(inFlight.current.size > 0);
      thump(); bump();
    }
  }
  async function bookChat() {
    const b = chat.current.b;
    const r = await bookOne(b, 'chat');
    say('bot', r.ok ? 'Booked with ' + PF.evaluate(b).rec.selected.carrier + '. Reference ' + r.reference + '. The “what happens next” steps are on the right.' : r.message,
      r.ok ? ['Start a new booking'] : completeChips(PF.evaluate(b)));
  }
  const fixChat = (spec: Spec) => {
    const b = chat.current.b;
    const before = PF.evaluate(b);
    const res = applyChange(b, spec);
    if (!res.ok) { say('bot', res.message, completeChips(before)); bump(); return res; }
    const ev = PF.evaluate(b), ch = b._changes[b._changes.length - 1];
    say('bot', 'Updated ' + ch.scope + ', ' + ch.field + ': ' + ch.from + ' → ' + ch.to + '. Checks re-run: ' + plural(ev.counts.red, 'red problem') + ', ' + plural(ev.counts.amber, 'amber warning') + ' (was ' + before.counts.red + ' and ' + before.counts.amber + ').', completeChips(ev));
    prev.current = { red: ev.counts.red, amber: ev.counts.amber };
    thump(); bump();
    return res;
  };
  const ackChat = (keys: string[]) => { chat.current.b._acks = keys; bump(); };
  const resetChat = () => { resetBooking(chat.current.b); say('bot', 'Everything is back to the details you gave me.', completeChips(PF.evaluate(chat.current.b))); thump(); bump(); };

  const uploadHandlers: UploadHandlers = {
    fix: (b, spec) => { const r = applyChange(b, spec); thump(); bump(); return r; },
    reset: b => { resetBooking(b); thump(); bump(); },
    ack: (b, keys) => { b._acks = keys; bump(); },
    book: b => { void bookOne(b, 'upload', upload?.fileName); },
    bookAllClear: async () => {
      const todo = (upload?.bookings || []).filter((b: any) => !b._ref && PF.evaluate(b).status === 'clear');
      for (let i = 0; i < todo.length; i++) { setBulk({ done: i, total: todo.length }); await bookOne(todo[i], 'upload', upload?.fileName); }
      setBulk(null);
    },
    download: async () => {
      if (!upload?.bookings) return;
      const mod: any = await import('xlsx');
      const X = mod.default ?? mod;
      const r = correctedRows(upload.bookings);
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(r.bookingRows), 'Bookings');
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(r.itemRows), 'Items');
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(r.changeRows), 'Change log');
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(r.resultRows), 'Results');
      X.writeFile(wb, String(upload.fileName || 'bookings').replace(/\.[^.]+$/, '') + '-corrected.xlsx');
    },
    busy: bookBusy,
    bulk,
  };

  const showUpload = (u: any) => { setUpload(u); setSelState(null); setFilter('all'); thump(); setMode('upload'); };
  async function handleFile(file: File) {
    setUploadMsg('Reading ' + file.name + '…');
    setSaveNote('');
    if (file.size === 0) { showUpload({ error: 'That file is empty. Please choose a file with a Bookings sheet and an Items sheet.', fileName: file.name }); setUploadMsg(''); return; }
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
  /** Stores a copy of the file. Never blocks checking: the results are already on screen, and any problem here is a small note. */
  async function saveUpload(file: File) {
    setSaveNote('');
    if (file.size > 4 * 1024 * 1024) { setSaveNote('Your file has been checked. It is over 4 MB, so a copy was not saved.'); return; }
    const form = new FormData();
    form.append('file', file);
    try {
      const { res: r } = await fetchJson('/api/uploads', { method: 'POST', body: form });
      if (!r.ok && r.status !== 503 && r.status !== 422) setSaveNote('Your file has been checked, but a copy could not be saved.');
    } catch { setSaveNote('Your file has been checked, but a copy could not be saved.'); }
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
    <>
      <header className="hero">
        <div className="hero-in">
          <nav className="nav" aria-label="App">
            <div className="brandrow">
              <span className="logo" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>
              </span>
              <span className="wordmark">UK to EU shipments</span>
            </div>
            <div className="topside">
              <ThemeToggle />
              <div className="today">{today}</div>
            </div>
          </nav>
          <h1 className="brand">Get Your Ship Together</h1>
          <p className="tag">Book a UK to EU shipment by chat or by uploading your sheets. Every booking is checked against the rulebook before it leaves.</p>
        </div>
        <svg className="wave" viewBox="0 0 1440 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0,0 C180,38 360,38 540,20 C720,2 900,2 1080,20 C1260,38 1350,34 1440,18 L1440,40 L0,40 Z" /></svg>
      </header>

      <div className="app">

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
              <p className="note">Uploaded files are stored so we can review how your sheets were checked.</p>
              {saveNote ? <p className="note" role="status">{saveNote}</p> : null}
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
              <Detail b={b} aiOn={aiOn} thumpKey={thumpKey} opts={{ fix: fixChat, book: () => { void bookChat(); }, reset: resetChat, booking: bookBusy, ack: ackChat }} />
            )
          ) : (
            <UploadResults upload={upload} sel={sel} setSel={setSel} filter={filter} setFilter={setFilter} thumpKey={thumpKey} aiOn={aiOn} h={uploadHandlers} />
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
          <p style={{ margin: '16px 0 8px' }}><b>How the carrier is chosen</b></p>
          <ol className="how">
            <li>Weight per pallet is gross weight ÷ pallets. Any carrier whose limit is at least that (exactly equal passes) can take the load.</li>
            <li>Among those carriers: <b>Cheapest</b> takes the lowest total price, <b>Fastest</b> the fewest days, <b>Most reliable</b> the highest on-time rate.</li>
            <li><b>Balanced</b> scores each carrier from 0 to 1 on price, transit days and on-time rate, comparing only the carriers that can take the load (lower price and fewer days score higher, higher on-time scores higher). The three scores are averaged with equal weight, one third each, and the highest average wins.</li>
            <li>Ties go to the lower price, then fewer days, then the earlier carrier letter.</li>
            <li>R-05 is checked against the carrier in use. It passes when the recommended carrier can take the load, and is Red only when no carrier can (or a carrier you picked can’t).</li>
          </ol>
          <p style={{ margin: '16px 0 8px' }}><b>Carrier rate card (fixed)</b></p>
          <div className="scroll"><table>
            <thead><tr><th>Carrier</th><th>Service</th><th>To</th><th className="num">£ per pallet</th><th className="num">Days</th><th className="num">On time</th><th className="num">Max kg per pallet</th></tr></thead>
            <tbody>{PF.CARRIERS.map((x: any, i: number) => <tr key={i}><td>{x.carrier}</td><td>{x.service}</td><td>{x.dest}</td><td className="num">{x.price}</td><td className="num">{x.transit}</td><td className="num">{x.ontime + '%'}</td><td className="num">{x.maxKg}</td></tr>)}</tbody>
          </table></div>
        </div>
      </details>
      <p className="foot">Checks run in the browser using fixed rules, so the same booking always gets the same result. Delivery dates are estimates based on calendar days in transit.</p>
      </div>
    </>
  );
}
