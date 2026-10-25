(function () {
'use strict';
const PF = window.PF, C = PF.Chat;
const $ = (s, r) => (r || document).querySelector(s);
const today = () => PF.todayISO();

function h(tag, attrs) {
  const e = document.createElement(tag);
  for (const k in (attrs || {})) {
    const v = attrs[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  const add = k => { if (k === null || k === undefined || k === false) return; if (Array.isArray(k)) return k.forEach(add); e.append(k.nodeType ? k : document.createTextNode(String(k))); };
  for (let i = 2; i < arguments.length; i++) add(arguments[i]);
  return e;
}
const plural = (n, w, p) => n + ' ' + (n === 1 ? w : (p || w + 's'));

const state = {
  mode: 'chat', chat: C.newChat(), msgs: [], prev: null, busy: false,
  ai: { sample: null, on: false, noticed: false }, dl: null,
  upload: null, sel: null, advisories: {}, thump: true
};

/* ===================== chat ===================== */
function renderMsgs() {
  const log = $('#log'); log.textContent = '';
  state.msgs.forEach((m, i) => {
    const lines = String(m.text).split('\n');
    log.append(h('div', { class: 'msg ' + m.role + (m.typing ? ' typing' : '') }, lines.map(l => h('p', null, l))));
    if (m.chips && i === state.msgs.length - 1 && !state.busy) log.append(h('div', { class: 'chips' }, m.chips.map(c => h('button', { class: 'chip', onclick: () => send(c) }, c))));
  });
  log.scrollTop = log.scrollHeight;
}
function say(role, text, chips, typing) { state.msgs.push({ role, text, chips: chips || null, typing: !!typing }); renderMsgs(); }
function exampleText() {
  return 'I’m Northfield Goods. I’m sending 1,080 ceramic mugs from Manchester to a warehouse in Frankfurt, 3 pallets, ready on ' + PF.dmy(PF.addDays(today(), 10)) + '. They’re £5 each, 12 per carton and weigh 0.5 kg each.';
}
function greet() {
  state.chat = C.newChat(); state.prev = null; state.msgs = [];
  say('bot', 'Hi, I’m your booking assistant. Tell me about the shipment in your own words and I’ll ask only for what’s missing. Then I’ll check it against the rulebook and recommend a carrier.\nI book from London, Manchester, Birmingham or Leeds to Germany, France or the Netherlands.', ['Try an example']);
  render();
}
async function send(textIn) {
  const text = (textIn !== undefined ? textIn : $('#input').value).trim();
  if (!text || state.busy) return;
  $('#input').value = ''; autosize();
  if (text === 'Try an example') { return send(exampleText()); }
  if (/^\s*(start over|start a new booking|new booking|reset)\b/i.test(text)) { say('user', text); greet(); return; }
  say('user', text);
  state.busy = true; $('#send').disabled = true;
  const c0 = state.chat, snap = C.cloneChat(c0);
  const askQ = c0.asked ? c0.asked.q : null;
  let log = null, used = 'built-in';
  if (state.ai.on && state.ai.sample) {
    say('bot', 'Reading your message…', null, true);
    try {
      const res = await state.ai.sample(C.aiPrompt(c0, text, askQ), { modelTier: 'quick', cache: false });
      const ex = C.aiToEx(C.aiParse(res.text), c0);
      if (!ex) throw { code: 'parse' };
      state.msgs.pop();
      log = C.stepAI(c0, text, ex); used = 'claude';
      if (!log.understood) { state.chat = C.cloneChat(snap); log = null; }
    } catch (e) {
      state.msgs.pop();
      state.chat = C.cloneChat(snap);
      if (e && (e.code === 'not_granted' || e.code === 'capability_disabled' || e.code === 'unavailable')) { state.ai.on = false; if (!state.ai.noticed) { state.ai.noticed = true; say('bot', 'I’ll read your messages with the built-in parser instead. Everything still works.'); } }
      log = null;
    }
  }
  const c = state.chat;
  const before = sig(c);
  if (!log) { const snap2 = C.cloneChat(c); log = C.step(c, text, {}); if (!log.understood) { /* keep state */ } void snap2; }
  state.busy = false; $('#send').disabled = false;
  if (log.reset) { greet(); return; }
  const reply = compose(log, snap);
  say('bot', reply.text, reply.chips);
  render();
  renderAIBar();
  void used; void before;
}
const sig = c => JSON.stringify(Object.assign({}, c.b, { _confirmed: undefined }));
function compose(log, snap) {
  const c = state.chat, a = c.asked;
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
    if (ev.status === 'blocked') return { text: 'I can’t confirm yet: ' + plural(ev.counts.red, 'red problem') + ' still need fixing. ' + ev.issues.filter(i => i.sev === 'red').slice(0, 4).map(i => i.title).join('; ') + '.', chips: completeChips(ev) };
    b._confirmed = true; state.prev = { red: ev.counts.red, amber: ev.counts.amber };
    return { text: 'Booking confirmed with ' + ev.rec.selected.carrier + '. The “what happens next” steps are on the right.', chips: ['Start a new booking'] };
  }
  const first = !state.prev;
  const lines = ev.issues.slice(0, 6).map(i => '• ' + (i.rule === 'DATA' ? 'Missing detail' : i.rule) + ': ' + i.title + (i.item ? ' (' + i.item + ')' : ''));
  if (ev.issues.length > 6) lines.push('• …and ' + (ev.issues.length - 6) + ' more');
  let verdict = ev.status === 'blocked' ? 'Pre-flight result: ' + plural(ev.counts.red, 'red problem') + (ev.counts.amber ? ' and ' + plural(ev.counts.amber, 'amber warning') : '') + '. Don’t ship yet.'
    : ev.status === 'warning' ? 'Pre-flight result: no red problems, but ' + plural(ev.counts.amber, 'amber warning') + '.'
    : 'Pre-flight result: all ten rules pass.';
  let text = head + '\n' + (first ? 'That’s everything I need. ' : 'I’ve re-run the checks. ') + verdict;
  if (state.prev && !first) text += ' (Before: ' + state.prev.red + ' red, ' + state.prev.amber + ' amber.)';
  if (lines.length) text += '\n' + lines.join('\n');
  const r = ev.rec;
  if (r.recommended) text += '\nRecommended carrier: ' + r.recommended.carrier + ' (' + r.recommended.service + '), ' + PF.gbp(r.recommended.price * r.pallets) + '.';
  else text += '\nNo carrier can take this weight per pallet. See the fix on the right.';
  text += '\nYou can change anything, for example “add a pallet”.';
  state.prev = { red: ev.counts.red, amber: ev.counts.amber };
  return { text, chips: completeChips(ev) };
}
function completeChips(ev) {
  const out = ['Add a pallet', 'Change priority to Fastest'];
  if (ev && ev.status !== 'blocked' && !state.chat.b._confirmed) out.unshift('Confirm booking');
  if (state.chat.b._confirmed) return ['Start a new booking'];
  return out;
}
function autosize() { const t = $('#input'); t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight) + 'px'; }
function renderAIBar() {
  const bar = $('#aibar'); bar.textContent = '';
  if (state.ai.sample) {
    bar.append(h('span', null, state.ai.on ? 'Claude is helping read your messages.' : 'Using the built-in message reader.'),
      h('button', { class: 'linkbtn', onclick: () => { state.ai.on = !state.ai.on; renderAIBar(); } }, state.ai.on ? 'Turn off' : 'Turn on Claude'));
  } else bar.append(h('span', null, 'Say “start over” at any time to begin a new booking.'));
}

/* ===================== results: shared pieces ===================== */
function ruleStrip(ev) {
  const t = { pass: 'Pass', red: 'Fail', amber: 'Warn', na: 'n/a' };
  return h('div', { class: 'rules', role: 'list', 'aria-label': 'Rulebook results' }, PF.RULES.map(r => {
    const st = ev.ruleStatus[r.id];
    return h('div', { class: 'rule ' + st, role: 'listitem', title: r.id + ': ' + r.text, 'aria-label': r.id + ' ' + t[st] + '. ' + r.text }, h('b', null, r.id), t[st]);
  }));
}
function verdict(b, ev) {
  const map = { blocked: ['HOLD', 'red'], warning: ['CHECK', 'amber'], clear: ['CLEAR', 'green'] }[ev.status];
  const title = ev.status === 'blocked' ? plural(ev.counts.red, 'problem') + ' to fix before this ships'
    : ev.status === 'warning' ? 'Can ship, but ' + plural(ev.counts.amber, 'thing') + ' need a look' : 'No problems found';
  const stamp = h('span', { class: 'stamp ' + map[1] + (state.thump ? ' thump' : ''), 'aria-hidden': 'true' }, map[0]);
  return h('div', { class: 'card verdict' }, stamp,
    h('div', null, h('h2', null, title), h('p', { class: 'sub' }, b.id + ' for ' + (b.seller || 'unnamed seller') + ', ' + (b.originCity || '?') + ' to ' + (b.destCity || b.destCountry || '?') + (ev.counts.red || ev.counts.amber ? '. ' + ev.counts.red + ' red, ' + ev.counts.amber + ' amber.' : '.'))),
    ruleStrip(ev));
}
function issuesSection(b, ev, opts) {
  const sec = h('div', { class: 'card section' }, h('h3', null, ev.issues.length ? 'What’s wrong and how to fix it' : 'Rulebook check'));
  if (!ev.issues.length) { sec.append(h('div', { class: 'allgood' }, h('span', { class: 'pill green' }, 'All clear'), h('p', null, 'All ten rules pass for this booking. Nothing needs fixing.'))); return sec; }
  ev.issues.forEach(i => {
    const acts = [];
    const rec = ev.rec;
    if (i.rule === 'R-05' && rec.selected) {
      if (rec.recommended && rec.recommended.carrier !== rec.selected.carrier) acts.push(h('button', { class: 'btn small', onclick: () => opts.change(() => { b._carrier = rec.recommended.carrier; }, 'Switched to ' + rec.recommended.carrier + '.') }, 'Switch to ' + rec.recommended.carrier));
      if (rec.selected.minPallets && rec.selected.minPallets !== b.pallets) acts.push(h('button', { class: 'btn small ghost', onclick: () => opts.change(() => { b.pallets = rec.selected.minPallets; }, 'Changed to ' + rec.selected.minPallets + ' pallets.') }, 'Use ' + rec.selected.minPallets + ' pallets with ' + rec.selected.carrier));
    }
    const sevLabel = i.sev === 'red' ? 'Red: must fix' : 'Amber: should fix';
    sec.append(h('article', { class: 'issue ' + i.sev },
      h('header', null, h('span', { class: 'pill ' + i.sev }, sevLabel), h('span', { class: 'pill grey' }, i.rule === 'DATA' ? 'Missing data' : i.rule), i.item ? h('span', { class: 'pill grey' }, i.item) : null, h('h4', null, i.title)),
      h('dl', null, h('dt', null, 'What’s wrong'), h('dd', null, i.what), h('dt', null, 'How to fix'), h('dd', null, i.fix)),
      acts.length ? h('div', { class: 'acts' }, acts) : null));
  });
  return sec;
}
function carrierSection(b, ev, opts) {
  const rec = ev.rec, sec = h('div', { class: 'card section reco' }, h('h3', null, 'Recommended carrier'));
  if (rec.error) { sec.append(h('p', null, 'No rate card for this destination. Use Germany, France or the Netherlands.')); return sec; }
  const r = rec.recommended;
  if (r) {
    sec.append(h('div', { class: 'reco-top' }, h('span', { class: 'reco-name' }, r.carrier + ' · ' + r.service), h('span', { class: 'pill grey' }, 'for “' + rec.priority + '”' + (rec.assumedPriority ? ' (assumed)' : ''))));
    sec.append(h('p', null, rec.reason));
    sec.append(h('div', { class: 'stats' },
      stat(PF.gbp(r.price * rec.pallets), 'total, ' + plural(rec.pallets, 'pallet')), stat(r.transit + ' days', 'transit'), stat(r.ontime + '%', 'on time'), stat(PF.nf(rec.wpp) + ' kg', 'per pallet (limit ' + r.maxKg + ')')));
  } else {
    sec.append(h('p', null, rec.reason));
    const alt = rec.options.slice().sort((x, y) => x.minCost - y.minCost)[0];
    if (alt && alt.minPallets) sec.append(h('p', null, 'Cheapest way to make it fit: ' + alt.carrier + ' with ' + plural(alt.minPallets, 'pallet') + ' (' + PF.gbp(alt.minCost) + ', ' + PF.nf(rec.gw / alt.minPallets) + ' kg each).'));
  }
  const rows = rec.options.map(o => {
    const isRec = r && o.carrier === r.carrier, isSel = o.carrier === rec.selected.carrier;
    const fit = o.eligible ? (rec.wpp === null ? '—' : 'Fits, ' + PF.nf(o.maxKg - rec.wpp) + ' kg spare') : 'Over by ' + PF.nf(rec.wpp - o.maxKg) + ' kg';
    return h('tr', { class: isSel ? 'pick' : '' },
      h('td', null, h('b', null, o.carrier), ' ', o.service, isRec ? h('div', null, h('span', { class: 'pill green' }, 'Recommended')) : null, (o === rec.preferred && !isRec) ? h('div', null, h('span', { class: 'pill grey' }, 'Your first pick')) : null),
      h('td', { class: 'num' }, PF.gbp(o.price)), h('td', { class: 'num' }, o.cost != null ? PF.gbp(o.cost) : '—'), h('td', { class: 'num' }, o.transit), h('td', { class: 'num' }, o.ontime + '%'), h('td', { class: 'num' }, o.maxKg),
      h('td', null, h('span', { class: 'pill ' + (o.eligible ? 'green' : 'red') }, fit)),
      h('td', null, isSel ? h('span', { class: 'pill grey' }, 'Selected') : h('button', { class: 'btn small ghost', onclick: () => opts.change(() => { b._carrier = o.carrier; }, 'Switched to ' + o.carrier + '.') }, 'Use')));
  });
  sec.append(h('div', { class: 'scroll' }, h('table', null,
    h('thead', null, h('tr', null, ['Carrier', '£ per pallet', 'Total', 'Days', 'On time', 'Max kg per pallet', 'This load', ''].map((t, i) => h('th', { class: i >= 1 && i <= 5 ? 'num' : '' }, t)))), h('tbody', null, rows))));
  if (rec.priority === 'Balanced') sec.append(h('p', { class: 'note' }, 'Balanced weighs cost 40%, speed 30% and reliability 30%.'));
  return sec;
}
const stat = (v, l) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l));
function confirmSection(b, ev, opts) {
  const s = PF.summarise(b, ev), sec = h('div', { class: 'card section confirm' }, h('h3', null, 'Confirmation'));
  sec.append(h('p', null, h('b', null, s.headline + '. ')), ...s.lines.map(l => h('p', null, l)));
  sec.append(h('p', { class: 'muted', style: 'margin-top:10px' }, h('b', null, 'What happens next')));
  sec.append(h('ol', null, s.next.map(n => h('li', null, n))));
  if (b._confirmed && ev.status !== 'blocked') sec.append(h('div', { class: 'confirmed', role: 'status' }, h('b', null, 'Booking ' + b.id + ' confirmed with ' + ev.rec.selected.carrier + '. '), 'This is a demo, so nothing is sent to a real carrier.'));
  else sec.append(h('div', { class: 'row-actions', style: 'margin:14px 0 0' }, h('button', { class: 'btn', disabled: ev.status === 'blocked', onclick: () => opts.change(() => { b._confirmed = true; }, 'Booking confirmed.') }, ev.status === 'blocked' ? 'Fix red items to confirm' : 'Confirm booking'), ev.status === 'warning' ? h('span', { class: 'note' }, 'You can confirm with warnings, but fixing them avoids delays.') : null));
  return sec;
}
function sheetCard(b, title, showProgress) {
  const f = C.sheetFields(b), done = f.filter(x => x.value !== null).length;
  const sec = h('div', { class: 'card section' }, h('h3', null, title));
  if (showProgress) {
    const itemsOk = b.items.length > 0 && b.items.every(it => it.desc && it.qty != null && it.price != null && it.upc != null && it.cartons != null && it.unitWeight != null && (it.hs != null || it.skipHS) && (it.coo || it.skipCOO));
    const total = f.length + 1, d = done + (itemsOk ? 1 : 0);
    sec.append(h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': d, 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-label': 'Booking details filled in' }, h('i', { style: 'width:' + Math.round(d / total * 100) + '%' })));
  }
  sec.append(h('dl', { class: 'sheet' }, f.map(x => h('div', null, h('dt', null, x.label), h('dd', { class: x.value === null ? 'miss' : '' }, x.value === null ? 'Not yet' : String(x.value))))));
  if (b.items && b.items.length) {
    const rows = b.items.map(i => h('tr', null, h('td', null, i.desc || '—', i.sku ? h('div', { class: 'note' }, i.sku) : null), h('td', { class: 'num' }, i.qty != null ? i.qty.toLocaleString('en-GB') : '—'), h('td', { class: 'num' }, i.price != null ? PF.gbp(i.price) : '—'), h('td', { class: 'num' }, i.upc != null ? i.upc : '—'), h('td', { class: 'num' }, i.cartons != null ? i.cartons : '—'), h('td', { class: 'num' }, i.unitWeight != null ? i.unitWeight : '—'), h('td', null, i.hs != null && i.hs !== '' ? String(i.hs) : (i.skipHS ? 'blank' : '—')), h('td', null, i.coo || (i.skipCOO ? 'blank' : '—'))));
    sec.append(h('div', { class: 'scroll', style: 'margin-top:14px' }, h('table', null, h('thead', null, h('tr', null, ['Product', 'Units', '£ per unit', 'Per carton', 'Cartons', 'kg each', 'HS code', 'Made in'].map((t, i) => h('th', { class: i >= 1 && i <= 5 ? 'num' : '' }, t)))), h('tbody', null, rows))));
  }
  return sec;
}
function advisorySection(b) {
  if (!state.ai.sample || !b.items.length) return null;
  const sec = h('div', { class: 'card section' }, h('h3', null, 'Second opinion on item descriptions'));
  const box = h('div', { class: 'note' }, 'The rulebook check looks for known words. Claude can read the descriptions for restricted goods that don’t use those words, such as devices with built-in batteries.');
  const out = h('div', { class: 'adv', style: 'display:none' });
  const btn = h('button', { class: 'btn small ghost', style: 'margin-top:10px', onclick: async () => {
    btn.disabled = true; btn.textContent = 'Asking Claude…'; out.style.display = 'block'; out.textContent = '';
    try {
      const list = b.items.map(i => ({ sku: i.sku, description: i.desc }));
      const res = await state.ai.sample('You check export item descriptions for dangerous goods. Rule: lithium batteries (including devices with built-in lithium batteries), aerosols and flammable liquids cannot ship as ordinary freight. For each item, say whether it is likely restricted. Return ONLY a JSON array like [{"sku":"X","concern":null}] where concern is null when fine, or a short plain-English reason when it may be restricted. Items: ' + JSON.stringify(list), { modelTier: 'quick' });
      const a = res.text.indexOf('['), z = res.text.lastIndexOf(']'), arr = JSON.parse(res.text.slice(a, z + 1));
      const flagged = arr.filter(x => x && x.concern);
      if (!flagged.length) out.append(h('p', null, 'Claude found nothing else that looks restricted.'));
      flagged.forEach(x => out.append(h('p', null, h('b', null, (x.sku || 'Item') + ': '), String(x.concern))));
      if (flagged.length) out.append(h('p', { class: 'note' }, 'These are advisory and not part of the ten rules.'));
    } catch (e) { out.append(h('p', null, 'Couldn’t get a second opinion this time.')); }
    btn.disabled = false; btn.textContent = 'Ask again';
  } }, 'Ask Claude to double-check');
  sec.append(box, btn, out);
  return sec;
}
function detail(b, opts) {
  const ev = PF.evaluate(b);
  const wrap = h('div', { class: 'right' });
  wrap.append(verdict(b, ev), issuesSection(b, ev, opts), carrierSection(b, ev, opts), confirmSection(b, ev, opts));
  if (opts.sheet) wrap.append(opts.sheet);
  const adv = advisorySection(b); if (adv) wrap.append(adv);
  state.thump = false;
  return wrap;
}

/* ===================== results: chat mode ===================== */
function renderChatResults(root) {
  const c = state.chat, b = c.b;
  if (!C.isComplete(c)) {
    root.append(sheetCard(b, 'Your booking so far', true));
    root.append(h('div', { class: 'card section' }, h('h3', null, 'Pre-flight checks'), h('p', { class: 'muted' }, 'The ten rulebook checks and the carrier recommendation appear here as soon as the details are complete. Nothing is guessed: anything I’m unsure of, I’ll ask.')));
    return;
  }
  const opts = { change: (fn, msg) => { const before = PF.evaluate(b); fn(); b._confirmed = (msg === 'Booking confirmed.') ? true : false; const ev = PF.evaluate(b); say('bot', msg + ' Checks re-run: ' + plural(ev.counts.red, 'red problem') + ', ' + plural(ev.counts.amber, 'amber warning') + ' (was ' + before.counts.red + ' and ' + before.counts.amber + ').', completeChips(ev)); state.prev = { red: ev.counts.red, amber: ev.counts.amber }; state.thump = true; render(); }, sheet: null };
  const d = detail(b, Object.assign({}, opts, { sheet: sheetCard(b, 'Booking sheet', false) }));
  root.append(...d.childNodes);
}

/* ===================== results: upload mode ===================== */
function statusPills(ev) {
  if (!ev.issues.length) return h('span', { class: 'pill green' }, 'All clear');
  return h('span', null, ev.counts.red ? h('span', { class: 'pill red' }, ev.counts.red + ' red') : null, ' ', ev.counts.amber ? h('span', { class: 'pill amber' }, ev.counts.amber + ' amber') : null);
}
function renderUploadResults(root) {
  const u = state.upload;
  if (!u) {
    root.append(h('div', { class: 'card empty' }, h('h2', null, 'Check a whole file in one go'), h('p', null, 'Upload your Bookings and Items sheets. Every booking is checked against the ten rules and gets a carrier recommendation, with a plain explanation for anything that’s wrong.'), h('p', null, 'No file to hand? Use the built-in sample on the left.')));
    return;
  }
  if (u.error) { root.append(h('div', { class: 'card section' }, h('h3', null, 'I couldn’t read that file'), h('p', null, u.error))); return; }
  const evs = u.bookings.map(b => ({ b, ev: PF.evaluate(b) }));
  if (state.sel) {
    const cur = evs.find(x => x.b.id === state.sel);
    if (cur) {
      const idx = evs.indexOf(cur);
      const nav = h('div', { class: 'row-actions' },
        h('button', { class: 'btn small ghost', onclick: () => { state.sel = null; state.thump = true; render(); } }, 'Back to all bookings'),
        h('span', { class: 'note' }, 'Booking ' + (idx + 1) + ' of ' + evs.length),
        h('span', null, h('button', { class: 'btn small ghost', disabled: idx === 0, onclick: () => { state.sel = evs[idx - 1].b.id; state.thump = true; render(); } }, 'Previous'), ' ', h('button', { class: 'btn small ghost', disabled: idx === evs.length - 1, onclick: () => { state.sel = evs[idx + 1].b.id; state.thump = true; render(); } }, 'Next')));
      root.append(nav);
      const opts = { change: (fn) => { fn(); cur.b._edited = true; render(); }, sheet: sheetCard(cur.b, 'Booking details as uploaded', false) };
      const d = detail(cur.b, opts);
      if (cur.b._edited) d.insertBefore(h('div', { class: 'warnbox' }, 'You changed this booking here to see the effect. Your file hasn’t changed, so make the same fix there before resubmitting.'), d.firstChild);
      root.append(...d.childNodes);
      return;
    }
  }
  const n = { red: 0, amber: 0, green: 0 };
  evs.forEach(x => { n[x.ev.status === 'blocked' ? 'red' : x.ev.status === 'warning' ? 'amber' : 'green']++; });
  const sec = h('div', { class: 'card section' });
  sec.append(h('div', { class: 'row-actions' }, h('h3', { style: 'margin:0' }, u.fileName), state.dl ? h('button', { class: 'btn small ghost', onclick: exportCSV }, 'Download results (CSV)') : null));
  sec.append(h('div', { class: 'tiles' },
    h('div', { class: 'tile' }, h('b', null, evs.length), h('span', null, 'bookings checked')),
    h('div', { class: 'tile red' }, h('b', null, n.red), h('span', null, 'on hold (red problems)')),
    h('div', { class: 'tile amber' }, h('b', null, n.amber), h('span', null, 'can ship with warnings')),
    h('div', { class: 'tile green' }, h('b', null, n.green), h('span', null, 'clear to ship'))));
  (u.warnings || []).forEach(w => sec.append(h('div', { class: 'warnbox' }, w)));
  const rows = evs.map(({ b, ev }) => {
    const r = ev.rec, c = r.recommended;
    const go = () => { state.sel = b.id; state.thump = true; render(); window.scrollTo({ top: 0 }); };
    return h('tr', { class: 'click', tabindex: '0', role: 'link', 'aria-label': 'Open ' + b.id, onclick: go, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } } },
      h('td', null, h('b', null, b.id)), h('td', null, b.seller || '—'), h('td', null, (b.originCity || '?') + ' to ' + (b.destCity || '?')),
      h('td', { class: 'num' }, b.pallets != null ? b.pallets : '—'),
      h('td', null, c ? c.carrier + ', ' + PF.gbp(c.price * (r.pallets || 0)) : (r.error ? '—' : 'None fits')),
      h('td', null, statusPills(ev)));
  });
  sec.append(h('div', { class: 'scroll' }, h('table', null, h('thead', null, h('tr', null, ['Booking', 'Seller', 'Route', 'Pallets', 'Recommended carrier', 'Result'].map((t, i) => h('th', { class: i === 3 ? 'num' : '' }, t)))), h('tbody', null, rows))));
  sec.append(h('p', { class: 'note', style: 'margin-top:10px' }, 'Select a booking to see what’s wrong, how to fix it, the carrier reasoning and the confirmation.'));
  root.append(sec);
}
function exportCSV() {
  if (!state.dl || !state.upload || !state.upload.bookings) return;
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const out = [['Booking ID', 'Seller', 'Status', 'Rule', 'Severity', 'Item', 'Problem', 'What is wrong', 'How to fix', 'Recommended carrier', 'Total cost GBP'].map(q).join(',')];
  state.upload.bookings.forEach(b => {
    const ev = PF.evaluate(b), c = ev.rec.recommended, cost = c && ev.rec.pallets ? c.price * ev.rec.pallets : '';
    const base = [b.id, b.seller, ev.status];
    const tail = [c ? c.carrier + ' ' + c.service : 'None fits', cost];
    if (!ev.issues.length) out.push(base.concat(['', '', '', 'No issues', '', ''], tail).map(q).join(','));
    ev.issues.forEach(i => out.push(base.concat([i.rule, i.sev, i.item || '', i.title, i.what, i.fix], tail).map(q).join(',')));
  });
  state.dl.save({ filename: 'preflight-results.csv', data: out.join('\n') }).catch(() => {});
}

/* ===================== upload handling ===================== */
function setUpload(u) { state.upload = u; state.sel = null; state.thump = true; showMode('upload'); render(); }
async function handleFile(file) {
  const msg = $('#uploadMsg'); msg.textContent = 'Reading ' + file.name + '…';
  try {
    if (!window.XLSX) throw new Error('The spreadsheet reader didn’t load. Check your connection and reload, or use the built-in sample.');
    const res = PF.parseWorkbook(window.XLSX, await file.arrayBuffer());
    if (res.error) setUpload({ error: res.error, fileName: file.name });
    else if (!res.bookings.length) setUpload({ error: 'The Bookings sheet has no rows with a Booking ID.', fileName: file.name });
    else setUpload({ fileName: file.name, bookings: res.bookings, warnings: res.warnings });
    msg.textContent = '';
  } catch (e) { msg.textContent = ''; setUpload({ error: (e && e.message) || 'Something went wrong reading that file.', fileName: file.name }); }
}
function loadSample() {
  const t = PF.sampleTables(today());
  const res = PF.bookingsFromTables(t.bookingRows, t.itemRows);
  setUpload({ fileName: 'Sample bookings (built in)', bookings: res.bookings, warnings: res.warnings });
}

/* ===================== shell ===================== */
function showMode(m) {
  state.mode = m;
  ['chat', 'upload'].forEach(k => {
    $('#tab-' + k).setAttribute('aria-selected', String(k === m));
    $('#pane-' + k).classList.toggle('on', k === m);
  });
  render();
}
function render() {
  const root = $('#results'); root.textContent = '';
  if (state.mode === 'chat') renderChatResults(root); else renderUploadResults(root);
}
function renderReference() {
  const r = $('#reference');
  const table = (heads, rows, numFrom) => h('div', { class: 'scroll' }, h('table', null,
    h('thead', null, h('tr', null, heads.map((t, i) => h('th', { class: numFrom != null && i >= numFrom ? 'num' : '' }, t)))),
    h('tbody', null, rows)));
  r.append(table(['Rule', 'Check', 'If broken'], PF.RULES.map(x => h('tr', null, h('td', null, h('b', null, x.id)), h('td', null, x.text), h('td', null, h('span', { class: 'pill ' + x.sev }, x.sev === 'red' ? 'Red' : 'Amber'))))));
  r.append(h('p', { style: 'margin:16px 0 8px' }, h('b', null, 'Carrier rate card (fixed)')));
  r.append(table(['Carrier', 'Service', 'To', '£ per pallet', 'Days', 'On time', 'Max kg per pallet'],
    PF.CARRIERS.map(c => h('tr', null, h('td', null, c.carrier), h('td', null, c.service), h('td', null, c.dest), h('td', { class: 'num' }, c.price), h('td', { class: 'num' }, c.transit), h('td', { class: 'num' }, c.ontime + '%'), h('td', { class: 'num' }, c.maxKg))), 3));
}
function init() {
  $('#today').textContent = 'Checking against today, ' + PF.niceDate(today());
  $('#tab-chat').addEventListener('click', () => showMode('chat'));
  $('#tab-upload').addEventListener('click', () => showMode('upload'));
  $('#send').addEventListener('click', () => send());
  $('#input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('#input').addEventListener('input', autosize);
  $('#choose').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) handleFile(f); });
  $('#sample').addEventListener('click', loadSample);
  renderReference(); renderAIBar(); greet();
  // optional capabilities: light up if the viewer provides them
  try {
    if (window.claude && typeof window.claude.use === 'function') {
      window.claude.use('sample').then(s => { if (s) { state.ai.sample = s; state.ai.on = true; renderAIBar(); } }).catch(() => {});
      window.claude.use('downloads').then(d => { if (d) { state.dl = d; render(); } }).catch(() => {});
    }
  } catch (e) { /* run without them */ }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

