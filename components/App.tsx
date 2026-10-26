'use client';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { PF, C } from '@/lib/pf';
import { Detail, SheetCard, UploadResults, plural, type UploadHandlers } from './Results';
import { applyChange, resetBooking, correctedRows, unacknowledged, issueKey, type Spec } from '@/lib/fixes';
import { bookShipment } from '@/lib/bookingClient';
import { fetchJson } from '@/lib/net';
import { parseExample } from '@/lib/example';
import { readInvoice, INVOICE_MESSAGES } from '@/lib/invoiceClient';
import Nav, { type NavKey } from './Nav';
import About from './About';
import { Hero, StatsStrip, WaysSection, ChecksSection, FeaturesSection } from './Home';
import Footer from './Footer';
import { useHsResults } from './HsPanel';
import { suggestHs, verifyHs } from '@/lib/hsClient';
import { descriptionLooksOff, shortText } from '@/lib/hs';
import CarrierOptions, { type UseDetails } from './CarrierOptions';

type Msg = { role: 'bot' | 'user'; text: string; chips?: string[] | null; typing?: boolean; suggest?: { code: string; label: string }[] };
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
  const [focusChat, setFocusChat] = useState(0);
  const [section, setSection] = useState<'app' | 'carriers' | 'rulebook' | 'about'>('app');
  const rulebookEl = useRef<HTMLDetailsElement>(null);

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
  const invoiceEl = useRef<HTMLInputElement>(null);
  // An invoice the seller has chosen but not sent yet, and a temporary address for its thumbnail.
  const [pending, setPending] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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
    setToday(PF.niceDate(PF.todayISO()));
    greet();
    fetchJson('/api/parse-message').then(({ json }) => { if (json && json.enabled) { setAiOn(true); } }).catch(() => {});
  }, [greet]);

  // --nav-h is the sticky bar's height: scroll targets and the sticky chat panel leave that much room at the top.
  // --chrome is what the chat panel gives up, so it fills the window under the bar when it is scrolled into view.
  useEffect(() => {
    const set = () => {
      const nav = document.querySelector('.topnav') as HTMLElement | null;
      if (!nav) return;
      const nh = Math.ceil(nav.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--nav-h', nh + 'px');
      document.documentElement.style.setProperty('--chrome', nh + 32 + 'px');
    };
    set();
    const late = window.setTimeout(set, 400);
    window.addEventListener('load', set);
    window.addEventListener('resize', set);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(set).catch(() => {});
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set);
    if (ro) document.querySelectorAll('.topnav').forEach(el => ro.observe(el));
    return () => { clearTimeout(late); window.removeEventListener('load', set); window.removeEventListener('resize', set); if (ro) ro.disconnect(); };
  }, []);
  // Which part of the page is in view, for the header's active state.
  useEffect(() => {
    let queued = false;
    const spy = () => {
      if (queued) return; queued = true;
      window.setTimeout(() => {
        queued = false;
        const line = (parseFloat(document.documentElement.style.getPropertyValue('--nav-h')) || 64) + 120;
        // The section whose top has most recently passed the line. Carrier options and About can share a row, so on a tie keep the one already current.
        let best = -Infinity; let tied: ('carriers' | 'rulebook' | 'about')[] = [];
        for (const id of ['carriers', 'rulebook', 'about'] as const) {
          const el = document.getElementById(id); if (!el) continue;
          const top = Math.round(el.getBoundingClientRect().top);
          if (top > line) continue;
          if (top > best + 2) { best = top; tied = [id]; } else if (Math.abs(top - best) <= 2) tied.push(id);
        }
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && document.getElementById('about')) { setSection('about'); return; }
        setSection(prev => (tied.length === 0 ? 'app' : tied.includes(prev as any) ? prev : tied[0]));
      }, 60);
    };
    window.addEventListener('scroll', spy, { passive: true });
    return () => window.removeEventListener('scroll', spy);
  }, []);
  // The thumbnail's address is released as soon as the attachment is removed, replaced or sent, and when the page closes.
  useEffect(() => {
    if (!pending || !pending.type.startsWith('image/') || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(pending);
    setPreviewUrl(url);
    return () => { URL.revokeObjectURL(url); };
  }, [pending]);
  useEffect(() => { if (focusChat > 0) inputEl.current?.focus({ preventScroll: true }); }, [focusChat]);
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

  /**
   * When the chat is asking for an HS code, offers up to three suggestions from the UK Tariff as buttons. Advisory only:
   * the seller picks one (or types their own), and the same rules and validation apply as for anything typed.
   */
  async function offerHs() {
    const a = chat.current.asked;
    if (!a || (a.key !== 'item.hs' && a.key !== 'item.details')) return;
    const it = chat.current.b.items[a.itemIdx ?? chat.current.b.items.length - 1];
    if (!it || !it.desc || (it.hs !== null && it.hs !== undefined && it.hs !== '')) return;
    const at = msgsRef.current.length - 1, text = msgsRef.current[at]?.text;
    const found = await suggestHs(it.desc);
    const picks: { code: string; label: string }[] = [];
    const add = (code: string, official: string) => { if (picks.length < 3 && /^\d{10}$/.test(code) && !picks.some(p => p.code === code)) picks.push({ code, label: code + ' · ' + shortText(official.split(' › ').pop() || official, 70) }); };
    for (const sg of found.suggestions) {
      if (picks.length >= 3) break;
      if (sg.kind === 'commodity') add(sg.code, sg.title);
      else { const r = await verifyHs(sg.code); r.children.filter(ch => !descriptionLooksOff(it.desc, ch.description)).slice(0, 2).forEach(ch => add(ch.code, ch.description)); }
    }
    if (!picks.length || msgsRef.current[at]?.text !== text) return;          // nothing to offer, or the conversation has moved on
    setM(msgsRef.current.map((m, i) => (i === at ? { ...m, suggest: picks } : m)));
  }

  async function send(textIn?: string, builtInOnly = false) {
    const text = (textIn !== undefined ? textIn : input).trim();
    if (!text || busy) return;
    setInput('');
    if (/^\s*(start over|start a new booking|new booking|reset)\b/i.test(text)) { newBooking(); return; }
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
    if (aiOn && !builtInOnly) {
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
    if (log.reset) { newBooking(); return; }
    const reply = compose(log, snap);
    say('bot', reply.text, reply.chips);
    bump();
    void offerHs();
    if (pendingBook.current) { pendingBook.current = false; void bookChat(); }
  }

  /**
   * The seller attaches an invoice in the chat. The reader copies what is printed on it; the details go through the same
   * sanitising, validators and rulebook as anything typed, and the chat then asks only for what is still missing.
   * The picture is read in memory and not stored.
   */
  async function handleInvoice(file: File) {
    if (busy) return;
    say('user', 'Invoice attached: ' + file.name);
    if (chat.current.b._ref) {
      say('bot', 'This booking is already booked under reference ' + chat.current.b._ref + ' and can’t be changed here. Say “start over” to make a new booking.', ['Start a new booking']);
      return;
    }
    setBusy(true);
    say('bot', 'Reading your invoice…', null, true);
    const out = await readInvoice(file);
    popMsg();
    if (!out.ok) { setBusy(false); say('bot', out.message, chat.current.asked ? chat.current.asked.chips : null); bump(); return; }
    const r = out.result;
    if (!r.isInvoice) { setBusy(false); say('bot', INVOICE_MESSAGES.notInvoice, chat.current.asked ? chat.current.asked.chips : null); bump(); return; }
    if (r.currency && r.currency !== 'GBP') {
      setBusy(false);
      say('bot', 'This invoice is in ' + r.currency + '. I can only book in £ (GBP), so I haven’t used it. Please upload a GBP invoice, or type the prices in £.', chat.current.asked ? chat.current.asked.chips : null); bump(); return;
    }
    const snap = C.cloneChat(chat.current);
    const ex = C.aiToEx(r, chat.current);
    const log = C.stepAI(chat.current, 'Invoice uploaded: ' + file.name, ex, { document: true });
    setBusy(false);
    const notes: string[] = [];
    if ((r.destCity || r.destCountry) && !ex.b.destCity && !ex.b.destCountry) notes.push('The invoice delivers to ' + [r.destCity, r.destCountry].filter(Boolean).join(', ') + ', which I can’t book. I only deliver to Germany, France and the Netherlands.');
    if (!r.currency) notes.push('I couldn’t see a currency on the invoice, so I’ve treated the prices as £.');
    if (!log.set.length && !log.changed.length) { say('bot', [INVOICE_MESSAGES.empty, ...notes].join('\n'), chat.current.asked ? chat.current.asked.chips : null); bump(); return; }
    const reply = compose(log, snap);
    say('bot', ['Here is what I read from your invoice. Please check it is right: the checks use it exactly as written, and you can tell me to change anything.', ...notes, reply.text].join('\n'), reply.chips);
    bump();
    void offerHs();
  }

  /** Send: the attached invoice (if any) first, then any text typed with it. Nothing is sent until this is pressed. */
  async function submit() {
    if (busy) return;
    const file = pending, text = input.trim();
    if (!file && !text) return;
    if (!file) { void send(); return; }
    setPending(null); setInput('');
    if (invoiceEl.current) invoiceEl.current.value = '';
    await handleInvoice(file);
    if (text) await send(text);
  }
  const chooseInvoice = (f: File | undefined | null) => { if (f) setPending(f); };

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
      if (r.ok) { b._confirmed = true; b._ref = r.reference; b._saved = r.saved; b._confirmation = r.confirmation || null; b._accessKey = r.accessKey || null; delete b._bookError; }
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

  /** From Carrier options: a new chat booking that already has the country, pallets, weight and priority. The normal parser and validation read it. */
  function useInBooking(d: UseDetails) {
    const started = msgsRef.current.some(m => m.role === 'user');
    if (started && typeof window !== 'undefined' && window.confirm && !window.confirm('Start a new chat booking with these details? The booking in the chat now will be cleared.')) return;
    greet(); setInput(''); setMode('chat'); setFocusChat(n => n + 1); scrollToId('start');
    void send('I’m sending ' + d.pallets + (d.pallets === 1 ? ' pallet' : ' pallets') + ' weighing ' + d.weight + ' kg to ' + d.dest + '. Priority ' + d.priority + '.', true);
  }
  const clearExample = () => { setUpload(null); setSelState(null); setFilter('all'); thump(); };

  const uploadHandlers: UploadHandlers = {
    fix: (b, spec) => { const r = applyChange(b, spec); thump(); bump(); return r; },
    reset: b => { resetBooking(b); thump(); bump(); },
    ack: (b, keys) => { b._acks = keys; bump(); },
    book: b => { if (upload?.example) return; void bookOne(b, 'upload', upload?.fileName); },
    bookAllClear: async () => {
      if (upload?.example) return;
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
    clearExample,
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

  /** Clears everything: chat, booking, results, any uploaded file and any example. Same as typing "start over". */
  function newBooking() {
    greet(); setUpload(null); setSelState(null); setFilter('all'); setUploadMsg(''); setSaveNote(''); setInput(''); setPending(null);
    setMode('chat'); setFocusChat(n => n + 1); thump();
  }
  const reduced = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Smooth scroll to a section. If a long smooth scroll has not arrived after a moment (a busy page can interrupt it), jump there.
  const scrollToId = (id: string) => {
    const el = document.getElementById(id);
    if (!el || !el.scrollIntoView) return;
    el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    if (reduced()) return;
    window.setTimeout(() => {
      const t = document.getElementById(id);
      const navH = parseFloat(document.documentElement.style.getPropertyValue('--nav-h')) || 70;
      if (t && Math.abs(t.getBoundingClientRect().top - (navH + 12)) > 40) t.scrollIntoView({ behavior: 'auto', block: 'start' });
    }, 1100);
  };
  function goTo(k: NavKey) {
    if (k === 'chat' || k === 'upload' || k === 'example') setSection('app');
    if (k === 'chat') { setMode('chat'); setFocusChat(n => n + 1); scrollToId('start'); }
    else if (k === 'upload') { setMode('upload'); scrollToId('start'); }
    else if (k === 'example') { loadExample(); }
    else if (k === 'rulebook') { if (rulebookEl.current) rulebookEl.current.open = true; setSection('rulebook'); scrollToId('rulebook'); }
    else if (k === 'carriers') { setSection('carriers'); scrollToId('carriers'); const f = document.getElementById('co-dest'); if (f) f.focus({ preventScroll: true }); }
    else if (k === 'about') { setSection('about'); scrollToId('about'); }
  }
  /** Built-in sample, read by the same parser and rulebook as a real file. Never stored and never sent anywhere. */
  async function loadExample() {
    if (upload && !upload.error && !upload.example && typeof window !== 'undefined' && window.confirm && !window.confirm('Replace your uploaded results with the example? Your file itself is not changed.')) return;
    setMode('upload'); scrollToId('start'); setSaveNote(''); setUploadMsg('');
    const mod: any = await import('xlsx');
    const res = parseExample(mod.default ?? mod);
    if (res.error || !res.bookings.length) { showUpload({ error: res.error || 'The example could not be built.', fileName: 'Example data' }); return; }
    showUpload({ fileName: 'Example data', example: true, bookings: res.bookings, warnings: res.warnings });
  }
  const navCurrent: NavKey = section !== 'app' ? section : mode === 'chat' ? 'chat' : upload && upload.example ? 'example' : 'upload';

  const c = chat.current, b = c.b;
  const chatHs = useHsResults(b.items || [], true);                         // advisory: the official wording shown beside each code in the chat summary
  const lastIdx = msgs.length - 1;

  return (
    <>
      <Nav current={navCurrent} onGo={goTo} onNew={newBooking} today={today} />

      <Hero onGo={goTo} />
      <StatsStrip />
      <WaysSection onGo={goTo} />

      <div className="app app-tool">
        <h2 className="tool-h" id="tool-h">Book or check a shipment</h2>

      <main className="grid" id="start">
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
                  {m.suggest && i === lastIdx && !busy ? (
                    <div className="hssuggest" role="group" aria-label="Suggested HS codes">
                      <span className="note">Suggested from the UK Tariff. Check one fits, or type your own:</span>
                      <div className="chips">{m.suggest.map(sg => <button key={sg.code} type="button" className="chip" title={sg.label} onClick={() => send('HS ' + sg.code)}>{sg.label}</button>)}</div>
                    </div>
                  ) : null}
                  {m.chips && i === lastIdx && !busy ? <div className="chips">{m.chips.map(ch => <button key={ch} className="chip" onClick={() => send(ch)}>{ch}</button>)}</div> : null}
                </div>
              ))}
            </div>
            <div className={'composer' + (aiOn ? ' has-attach' : '')}>
              {pending ? (
                <div className="attachprev" role="group" aria-label="Attached invoice">
                  {previewUrl ? <img src={previewUrl} alt={'Preview of ' + pending.name} /> : <span className="attachdoc" aria-hidden="true">{pending.type === 'application/pdf' ? 'PDF' : 'FILE'}</span>}
                  <span className="attachname"><b>{pending.name}</b><span>{Math.max(1, Math.round(pending.size / 1024)).toLocaleString('en-GB')} KB · press Send to read it</span></span>
                  <button type="button" className="attachx" aria-label="Remove attachment" title="Remove" disabled={busy} onClick={() => setPending(null)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </div>
              ) : null}
              {aiOn ? (
                <>
                  <button type="button" className="attach" aria-label="Attach an invoice" title="Attach an invoice (picture or PDF)" disabled={busy} onClick={() => invoiceEl.current?.click()}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.4 11.1l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" /></svg>
                  </button>
                  <input ref={invoiceEl} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="sr" tabIndex={-1} aria-label="Invoice file"
                    onChange={e => { chooseInvoice(e.target.files?.[0]); e.target.value = ''; }} />
                </>
              ) : null}
              <textarea ref={inputEl} rows={1} value={input} placeholder="Your shipment…" aria-label="Your message"
                onChange={e => setInput(e.target.value)}
                onPaste={e => { const f = aiOn ? Array.from(e.clipboardData.files || []).find(x => x.type.startsWith('image/')) : null; if (f) { e.preventDefault(); chooseInvoice(f); } }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }} />
              <button className="btn" disabled={busy || (!input.trim() && !pending)} onClick={() => void submit()}>Send</button>
              <div className="aibar"><span>Say “start over” at any time to begin a new booking.</span>{aiOn ? <span>Invoices are read once to fill in the details and are not stored.</span> : null}</div>
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
                <SheetCard b={b} title="Your booking so far" showProgress hs={chatHs} />
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
      </div>

      <ChecksSection />
      <FeaturesSection />

      <div className="app app-tail">

      <CarrierOptions onUse={useInBooking} />

      <details className="card ref" id="rulebook" ref={rulebookEl}>
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

      <About />
      </div>

      <Footer onGo={goTo} />
    </>
  );
}
