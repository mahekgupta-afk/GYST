// @ts-nocheck
// Ported unchanged from the tested prototype (engine.js). Pure functions, no DOM.
/* Preflight engine: reference data, rulebook checks, carrier logic, spreadsheet reading. */

/* ---------- Reference data (fixed by the case: Sheets 3 and 4) ---------- */
const CARRIERS = [
  { carrier: 'Carrier A', service: 'Road economy',  dest: 'Germany',     price: 180, transit: 5, ontime: 92, maxKg: 500 },
  { carrier: 'Carrier B', service: 'Road standard', dest: 'Germany',     price: 220, transit: 3, ontime: 95, maxKg: 750 },
  { carrier: 'Carrier C', service: 'Road express',  dest: 'Germany',     price: 340, transit: 2, ontime: 98, maxKg: 400 },
  { carrier: 'Carrier A', service: 'Road economy',  dest: 'France',      price: 170, transit: 5, ontime: 92, maxKg: 500 },
  { carrier: 'Carrier B', service: 'Road standard', dest: 'France',      price: 210, transit: 3, ontime: 95, maxKg: 750 },
  { carrier: 'Carrier C', service: 'Road express',  dest: 'France',      price: 330, transit: 2, ontime: 98, maxKg: 400 },
  { carrier: 'Carrier A', service: 'Road economy',  dest: 'Netherlands', price: 160, transit: 5, ontime: 92, maxKg: 500 },
  { carrier: 'Carrier B', service: 'Road standard', dest: 'Netherlands', price: 200, transit: 3, ontime: 95, maxKg: 750 },
  { carrier: 'Carrier C', service: 'Road express',  dest: 'Netherlands', price: 320, transit: 2, ontime: 98, maxKg: 400 }
];
const RULES = [
  { id: 'R-01', sev: 'red',   text: 'Every item needs an HS code of at least 6 digits' },
  { id: 'R-02', sev: 'red',   text: 'Declared value equals the sum of quantity × unit price (within 1%)' },
  { id: 'R-03', sev: 'red',   text: 'Units per carton × cartons equals quantity, for each item' },
  { id: 'R-04', sev: 'red',   text: 'Booking cartons equal the sum of the item cartons' },
  { id: 'R-05', sev: 'red',   text: 'Weight per pallet is within the chosen carrier’s limit' },
  { id: 'R-06', sev: 'red',   text: 'No lithium batteries, aerosols or flammable liquids' },
  { id: 'R-07', sev: 'amber', text: 'Gross weight is at least the sum of unit weight × quantity' },
  { id: 'R-08', sev: 'amber', text: 'Shipments to a warehouse have a delivery appointment' },
  { id: 'R-09', sev: 'amber', text: 'Every item has a country of origin' },
  { id: 'R-10', sev: 'amber', text: 'Ready to ship date is not in the past' }
];
const PRIORITIES = ['Cheapest', 'Fastest', 'Most reliable', 'Balanced'];
const ORIGINS = ['London', 'Manchester', 'Birmingham', 'Leeds'];
const DESTS = { Berlin: 'Germany', Frankfurt: 'Germany', Hamburg: 'Germany', Paris: 'France', Lyon: 'France', Amsterdam: 'Netherlands', Rotterdam: 'Netherlands' };
const COUNTRIES = ['United Kingdom', 'China', 'India', 'Vietnam', 'Turkey', 'Germany'];
const BALANCED_WEIGHTS = { cost: 0.4, speed: 0.3, reliability: 0.3 };

/* ---------- Formatting + date helpers ---------- */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');
function gbp(n) {
  if (n == null || isNaN(n)) return '—';
  const a = Math.abs(n), whole = Math.abs(a - Math.round(a)) < 1e-9;
  return (n < 0 ? '-' : '') + '£' + a.toLocaleString('en-GB', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}
function nf(n, d) {
  if (n == null || isNaN(n)) return '—';
  d = d == null ? 1 : d;
  return (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toLocaleString('en-GB', { maximumFractionDigits: d });
}
function ymd(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return y + '-' + pad(m) + '-' + pad(d);
}
function todayISO() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function addDays(iso, n) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
function diffDays(a, b) { const p = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((p(b) - p(a)) / 864e5); }
function dmy(iso) { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return d + '-' + m + '-' + y; }
function niceDate(iso) { if (!iso) return '—'; const [y, m, d] = iso.split('-').map(Number); return d + ' ' + MON[m - 1] + ' ' + y; }
function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) { const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5); return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }
    return null;
  }
  const s = String(v).trim();
  let m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/.exec(s);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return ymd(y, +m[2], +m[1]); }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  return null;
}
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).replace(/[£,\s]/g, '').replace(/gbp/i, '');
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  return parseFloat(s);
}
const clean = v => (v === null || v === undefined) ? null : (String(v).trim() === '' ? null : String(v).trim());

/* ---------- Carrier logic ---------- */
function rankBy(list, priority) {
  const L = list.slice();
  const price = (a, c) => a.price - c.price, time = (a, c) => a.transit - c.transit, rel = (a, c) => c.ontime - a.ontime;
  if (priority === 'Cheapest') return L.sort((a, c) => price(a, c) || time(a, c) || rel(a, c));
  if (priority === 'Fastest') return L.sort((a, c) => time(a, c) || rel(a, c) || price(a, c));
  if (priority === 'Most reliable') return L.sort((a, c) => rel(a, c) || time(a, c) || price(a, c));
  const rng = k => { const v = L.map(x => x[k]); return [Math.min.apply(null, v), Math.max.apply(null, v)]; };
  const [p0, p1] = rng('price'), [t0, t1] = rng('transit'), [o0, o1] = rng('ontime');
  const n = (v, lo, hi, inv) => hi === lo ? 1 : (inv ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo));
  L.forEach(x => { x.score = BALANCED_WEIGHTS.cost * n(x.price, p0, p1, true) + BALANCED_WEIGHTS.speed * n(x.transit, t0, t1, true) + BALANCED_WEIGHTS.reliability * n(x.ontime, o0, o1, false); });
  return L.sort((a, c) => c.score - a.score || price(a, c));
}
function recommend(b) {
  const rows = CARRIERS.filter(c => c.dest === b.destCountry);
  if (!rows.length) return { error: 'unsupported', options: [] };
  const pallets = b.pallets > 0 ? b.pallets : null;
  const gw = typeof b.grossWeight === 'number' ? b.grossWeight : null;
  const wpp = pallets && gw !== null ? gw / pallets : null;
  const priority = PRIORITIES.indexOf(b.priority) >= 0 ? b.priority : 'Balanced';
  const options = rows.map(r => {
    const o = Object.assign({}, r);
    o.cost = pallets ? r.price * pallets : null;
    o.eligible = wpp === null ? true : wpp <= r.maxKg + 1e-9;
    o.minPallets = gw !== null ? Math.max(1, Math.ceil(gw / r.maxKg - 1e-9)) : null;
    o.minCost = o.minPallets ? o.minPallets * r.price : null;
    return o;
  });
  const preferred = rankBy(options, priority)[0];
  const elig = options.filter(o => o.eligible);
  const recommended = elig.length ? rankBy(elig, priority)[0] : null;
  const rec = { options, pallets, gw, wpp, priority, preferred, recommended, assumedPriority: PRIORITIES.indexOf(b.priority) < 0 };
  const selName = b._carrier && options.find(o => o.carrier === b._carrier) ? b._carrier : preferred.carrier;
  rec.selected = options.find(o => o.carrier === selName);
  rec.reason = explain(rec, b);
  return rec;
}
function explain(rec, b) {
  const r = rec.recommended || rec.preferred, dest = b.destCountry, p = rec.priority, n = rec.pallets;
  const cost = n ? ' Total ' + gbp(r.price * n) + ' for ' + n + ' pallet' + (n === 1 ? '' : 's') + '.' : '';
  const label = r.carrier + ' (' + r.service + ')';
  const all = rec.options;
  let s;
  if (p === 'Cheapest') s = label + ' is the cheapest way to ' + dest + ': ' + gbp(r.price) + ' a pallet.' + cost + ' It takes ' + r.transit + ' days and arrives on time ' + r.ontime + '% of the time.';
  else if (p === 'Fastest') {
    const alsoBest = all.every(o => o.ontime <= r.ontime);
    s = label + ' is the fastest eligible option to ' + dest + ': ' + r.transit + ' days.' + (alsoBest ? ' It also has the best on-time record, ' + r.ontime + '%.' : ' It arrives on time ' + r.ontime + '% of the time.') + cost;
  } else if (p === 'Most reliable') {
    const alsoFast = all.every(o => o.transit >= r.transit);
    s = label + ' has the highest on-time rate we can use here: ' + r.ontime + '%.' + (alsoFast ? ' It is also the quickest, at ' + r.transit + ' days.' : ' Transit is ' + r.transit + ' days.') + cost;
  } else {
    s = label + ' gives the best overall balance of price, speed and reliability for ' + dest + ' (we weigh them ' + Math.round(BALANCED_WEIGHTS.cost * 100) + '/' + Math.round(BALANCED_WEIGHTS.speed * 100) + '/' + Math.round(BALANCED_WEIGHTS.reliability * 100) + '): ' + gbp(r.price) + ' a pallet, ' + r.transit + ' days, ' + r.ontime + '% on time.' + cost;
  }
  if (rec.assumedPriority) s += ' No priority was given, so we used Balanced.';
  if (rec.recommended && rec.preferred.carrier !== rec.recommended.carrier) {
    s += ' ' + rec.preferred.carrier + ' would be your first pick for “' + p + '”, but it only accepts ' + rec.preferred.maxKg + ' kg per pallet and this load is ' + nf(rec.wpp) + ' kg per pallet.';
  }
  if (!rec.recommended) {
    const maxLimit = Math.max.apply(null, all.map(o => o.maxKg));
    s = 'No carrier on this route can take ' + nf(rec.wpp) + ' kg per pallet (the highest limit is ' + maxLimit + ' kg). The load has to be split across more pallets.';
  }
  return s;
}

/* ---------- Hazard detection (R-06) ---------- */
const HAZ = [
  { type: 'a lithium battery product', re: /\b(lithium|li[\s-]?ion|li[\s-]?po|lipo|lifepo4|power\s?banks?|e[\s-]?cig(?:arette)?s?|vapes?|vaping)\b/i },
  { type: 'a battery product (most are lithium)', re: /\bbatter(?:y|ies)\b/i },
  { type: 'an aerosol', re: /\b(aerosols?|spray[\s-]?paints?|spray[\s-]?cans?|hair\s?spray|body\s?spray|deodorant\s+spray|dry\s+shampoo|canned\s+air|pressuri[sz]ed\s+cans?)\b/i },
  { type: 'a flammable liquid', re: /\b(flammable|inflammable|petrol|gasoline|kerosene|lighter\s+(?:fluid|fuel)|white\s+spirit|turpentine|acetone|methylated\s+spirits?|denatured\s+alcohol|paint\s+thinners?|nail\s+polish\s+remover|butane|propane|isopropyl|rubbing\s+alcohol|hand\s+sanitis?er|alcohol[\s-]based)\b/i }
];
const NEG = /\b(non[\s-]?flammable|not\s+flammable|non[\s-]?aerosol|battery[\s-]?free|lithium[\s-]?free|no\s+batter(?:y|ies)|without\s+batter(?:y|ies)|batteries\s+not\s+included|non[\s-]?lithium)\b/gi;
function hazardOf(it) {
  const text = ((it.desc || '') + ' ' + (it.sku || '')).replace(NEG, ' ');
  for (const h of HAZ) { const m = h.re.exec(text); if (m) return { type: h.type, word: m[0] }; }
  return null;
}
function hsInfo(v) {
  if (v === null || v === undefined || String(v).trim() === '') return { blank: true };
  const raw = String(v).trim(), digits = raw.replace(/[\s.\-]/g, '');
  return { blank: false, raw, digits, numeric: typeof v === 'number', valid: /^\d+$/.test(digits) };
}

/* ---------- Rule engine ---------- */
function evaluate(b, opts) {
  const today = (opts && opts.todayISO) || todayISO();
  const items = b.items || [];
  const issues = [], skipped = {};
  const add = (rule, sev, title, what, fix, item) => issues.push({ rule, sev, title, what, fix, item: item || null });
  const label = it => (it.sku || 'item') + (it.desc ? ' (' + it.desc + ')' : '');
  const rec = recommend(b);

  // Missing or unreadable inputs
  const data = (title, what, fix) => add('DATA', 'red', title, what, fix);
  if (!items.length) data('No items found', 'This booking has no product lines, so nothing can be checked against the invoice.', 'Add at least one product line with quantity, price and carton details.');
  if (rec.error) data('Route not supported', 'We can only book from the UK to Germany, France or the Netherlands. Destination country is “' + (b.destCountry || 'blank') + '”.', 'Use Germany, France or the Netherlands as the destination country.');
  if (!(b.pallets > 0)) data('Pallet count missing', 'Number of pallets is blank or zero, so weight per pallet and price can’t be worked out.', 'Enter how many pallets the shipment is on.');
  if (typeof b.grossWeight !== 'number') data('Gross weight missing', 'Total gross weight is blank or not a number.', 'Enter the total weight of everything shipped, including cartons and pallets.');
  const itemMiss = [];
  items.forEach(it => {
    [['qty', 'quantity'], ['price', 'unit price'], ['upc', 'units per carton'], ['cartons', 'cartons'], ['unitWeight', 'unit weight']].forEach(([k, n]) => { if (typeof it[k] !== 'number') itemMiss.push({ it, k, n }); });
  });
  itemMiss.forEach(m => data('Missing ' + m.n + ' for ' + (m.it.sku || 'an item'), label(m.it) + ' has no usable ' + m.n + '.', 'Fill in ' + m.n + ' for this item.'));
  const has = (k) => items.every(i => typeof i[k] === 'number');

  const sumVal = items.reduce((s, i) => s + (i.qty || 0) * (i.price || 0), 0);
  const sumCartons = items.reduce((s, i) => s + (i.cartons || 0), 0);
  const sumWt = items.reduce((s, i) => s + (i.qty || 0) * (i.unitWeight || 0), 0);

  // R-01 HS code
  items.forEach(it => {
    const h = hsInfo(it.hs);
    if (h.blank) add('R-01', 'red', 'HS code missing', label(it) + ' has no HS code. Customs can’t classify it, so it is likely to be held.', 'Look the product up in the UK Trade Tariff (gov.uk/trade-tariff) and enter at least the first 6 digits.', it.sku);
    else if (!h.valid) add('R-01', 'red', 'HS code isn’t a number', label(it) + ' has the HS code “' + h.raw + '”, which contains characters other than digits.', 'Enter digits only, at least 6 (for example 691200).', it.sku);
    else if (h.digits.length < 6) add('R-01', 'red', 'HS code too short', label(it) + ' has the HS code “' + h.raw + '” with only ' + h.digits.length + ' digits. At least 6 are required.' + (h.numeric && h.digits.length === 5 ? ' If the code starts with 0, the spreadsheet may have dropped it (091200 saved as 91200).' : ''), 'Replace it with the full code (6 digits or more) from the UK Trade Tariff.' + (h.numeric && h.digits.length === 5 ? ' Format the HS code column as text so leading zeros stay.' : ''), it.sku);
  });

  // R-02 declared value
  if (typeof b.declaredValue !== 'number') { skipped['R-02'] = 1; data('Declared value missing', 'Total declared value is blank or not a number.', 'Enter the total value of the goods in GBP.'); }
  else if (!has('qty') || !has('price')) skipped['R-02'] = 1;
  else {
    const diff = Math.abs(b.declaredValue - sumVal), pct = sumVal === 0 ? (diff === 0 ? 0 : Infinity) : diff / sumVal;
    if (pct > 0.01 + 1e-12) add('R-02', 'red', 'Declared value doesn’t match the items',
      'Declared value is ' + gbp(b.declaredValue) + ', but quantity × unit price across all items adds up to ' + gbp(sumVal) + ' (' + (isFinite(pct) ? nf(pct * 100) + '% ' + (b.declaredValue > sumVal ? 'higher' : 'lower') : 'no match') + '; up to 1% is allowed). Customs relies on the invoice value, so a gap invites questions or a hold.',
      'Change the declared value to ' + gbp(sumVal) + ', or correct the quantities or unit prices if the declared figure is the right one.');
  }

  // R-03 carton maths per item
  items.forEach(it => {
    if (typeof it.qty !== 'number' || typeof it.upc !== 'number' || typeof it.cartons !== 'number' || it.upc <= 0) return;
    if (Math.abs(it.upc * it.cartons - it.qty) > 1e-9) {
      const fix = (it.qty % it.upc === 0)
        ? 'If the quantity is right, this item should be ' + (it.qty / it.upc) + ' cartons. If ' + it.cartons + ' cartons is right, the quantity should be ' + (it.upc * it.cartons) + ' units. Check the packing list and fix whichever is wrong.'
        : it.qty + ' units doesn’t fill a whole number of cartons of ' + it.upc + ' (' + (it.qty % it.upc) + ' left over). Check units per carton, cartons and quantity against the packing list.';
      add('R-03', 'red', 'Carton maths doesn’t add up', label(it) + ': ' + it.upc + ' units per carton × ' + it.cartons + ' cartons = ' + (it.upc * it.cartons) + ' units, but the quantity is ' + it.qty + '. The receiving warehouse will count a different number from the paperwork.', fix, it.sku);
    }
  });

  // R-04 total cartons
  if (typeof b.cartons !== 'number') { skipped['R-04'] = 1; data('Total cartons missing', 'The booking’s total cartons is blank or not a number.', 'Enter the total number of cartons.'); }
  else if (!has('cartons')) skipped['R-04'] = 1;
  else if (Math.abs(b.cartons - sumCartons) > 1e-9) add('R-04', 'red', 'Total cartons don’t match the items',
    'The booking says ' + b.cartons + ' cartons, but the items add up to ' + sumCartons + '. Labels and counts at the warehouse won’t match the declaration.',
    'Set total cartons to ' + sumCartons + ', or add the missing ' + Math.abs(b.cartons - sumCartons) + ' carton' + (Math.abs(b.cartons - sumCartons) === 1 ? '' : 's') + ' to the item lines if ' + b.cartons + ' is right.');

  // R-05 weight per pallet against the chosen carrier
  const sel = rec.selected;
  if (!sel || rec.wpp === null) skipped['R-05'] = 1;
  else if (!sel.eligible) {
    const over = rec.wpp - sel.maxKg, fixes = [];
    if (rec.recommended) fixes.push('Switch to ' + rec.recommended.carrier + ' (' + rec.recommended.service + '), which takes up to ' + rec.recommended.maxKg + ' kg per pallet: ' + gbp(rec.recommended.price * rec.pallets) + ' for ' + rec.pallets + ' pallet' + (rec.pallets === 1 ? '' : 's') + '.');
    const keepN = sel.minPallets, keepCost = sel.minCost;
    fixes.push((rec.recommended ? 'Or keep ' + sel.carrier + ' and ' : 'Split the load: with ' + sel.carrier + ' you need ') + (rec.recommended ? 'spread the load over ' : '') + keepN + ' pallets (' + gbp(keepCost) + ', ' + nf(rec.gw / keepN) + ' kg each).');
    if (!rec.recommended) rec.options.filter(o => o !== sel).forEach(o => fixes.push('With ' + o.carrier + ' you need ' + o.minPallets + ' pallets (' + gbp(o.minCost) + ').'));
    add('R-05', 'red', 'Pallets too heavy for ' + sel.carrier,
      'Weight per pallet is ' + nf(rec.wpp) + ' kg (' + nf(rec.gw) + ' kg ÷ ' + rec.pallets + ' pallet' + (rec.pallets === 1 ? '' : 's') + '). ' + sel.carrier + ' (' + sel.service + ') accepts at most ' + sel.maxKg + ' kg per pallet, so this is ' + nf(over) + ' kg over. The carrier is likely to refuse or re-price the pallets.',
      fixes.join(' '));
  }

  // R-06 dangerous goods
  items.forEach(it => {
    const hz = hazardOf(it);
    if (hz) add('R-06', 'red', 'Restricted goods', label(it) + ' looks like ' + hz.type + ' (matched “' + hz.word + '”). Lithium batteries, aerosols and flammable liquids can’t go as ordinary freight.', 'Remove this item from the booking, or ship it separately with a carrier approved for dangerous goods. If it is not actually restricted (for example battery-free), correct the description.', it.sku);
  });

  // R-07 gross weight not below the sum of the items
  if (typeof b.grossWeight !== 'number' || !has('qty') || !has('unitWeight')) skipped['R-07'] = 1;
  else if (b.grossWeight < sumWt - 1e-9) {
    let extra = '';
    if (b.pallets > 0 && sel && sumWt / b.pallets > sel.maxKg) extra = ' Heads up: at ' + nf(sumWt) + ' kg the load would be ' + nf(sumWt / b.pallets) + ' kg per pallet, above ' + sel.carrier + '’s ' + sel.maxKg + ' kg limit.';
    add('R-07', 'amber', 'Gross weight is lower than the goods alone',
      'Total gross weight is ' + nf(b.grossWeight) + ' kg, but the items alone weigh ' + nf(sumWt) + ' kg (unit weight × quantity), before cartons and pallets. Under-declaring weight leads to carrier surcharges.',
      'Raise the gross weight to at least ' + nf(sumWt) + ' kg; with cartons and pallets it will usually be higher.' + extra);
  }

  // R-08 delivery appointment
  if (b.destType === 'Warehouse' && b.appointment !== 'Yes') add('R-08', 'amber', 'No delivery appointment',
    'This is going to a warehouse, and no delivery appointment is booked. Warehouses often turn away trucks that arrive without a slot.',
    'Book a delivery slot with the receiving warehouse before collection, then set “Delivery appointment booked” to Yes.');

  // R-09 country of origin
  items.forEach(it => {
    if (!clean(it.coo)) add('R-09', 'amber', 'Country of origin missing', label(it) + ' has no country of origin. This is where the product was made, not where it ships from. Customs uses it to set duty.', 'Add the country where it was made (for example United Kingdom, China, India, Vietnam, Turkey or Germany).', it.sku);
  });

  // R-10 date
  if (!b.readyDate) { skipped['R-10'] = 1; data('Ready date missing or unreadable', 'The ready to ship date is blank or isn’t a valid DD-MM-YYYY date.', 'Enter the date in DD-MM-YYYY format.'); }
  else if (b.readyDate < today) {
    const ago = diffDays(b.readyDate, today);
    add('R-10', 'amber', 'Ready date is in the past', 'The ready to ship date is ' + niceDate(b.readyDate) + ', which was ' + ago + ' day' + (ago === 1 ? '' : 's') + ' ago (today is ' + niceDate(today) + '). A carrier can’t collect in the past.', 'Choose today (' + dmy(today) + ') or a later date.');
  }

  const order = { red: 0, amber: 1 };
  const ruleNo = r => r === 'DATA' ? 0 : parseInt(r.slice(2), 10);
  issues.sort((a, c) => order[a.sev] - order[c.sev] || ruleNo(a.rule) - ruleNo(c.rule));
  const counts = { red: issues.filter(i => i.sev === 'red').length, amber: issues.filter(i => i.sev === 'amber').length };
  const ruleStatus = {};
  RULES.forEach(r => {
    const hit = issues.find(i => i.rule === r.id);
    ruleStatus[r.id] = hit ? hit.sev : (skipped[r.id] ? 'na' : 'pass');
  });
  const status = counts.red ? 'blocked' : counts.amber ? 'warning' : 'clear';
  return { issues, rec, counts, status, ruleStatus, calc: { sumVal, sumCartons, sumWt, wpp: rec.wpp }, today };
}

/* ---------- Plain-language confirmation ---------- */
function summarise(b, ev) {
  const rec = ev.rec, c = rec.recommended || rec.preferred;
  const sel = rec.selected;
  const route = (b.originCity || 'the UK') + ' to ' + (b.destCity || b.destCountry);
  const what = (b.pallets || '?') + ' pallet' + (b.pallets === 1 ? '' : 's') + ', ' + (b.cartons != null ? b.cartons : '?') + ' carton' + (b.cartons === 1 ? '' : 's') + ', ' + nf(b.grossWeight) + ' kg';
  const out = { route, what, lines: [], next: [] };
  if (ev.status === 'blocked') {
    out.headline = 'Not ready to ship yet';
    out.lines.push(ev.counts.red + ' problem' + (ev.counts.red === 1 ? '' : 's') + ' must be fixed first' + (ev.counts.amber ? ', plus ' + ev.counts.amber + ' warning' + (ev.counts.amber === 1 ? '' : 's') : '') + '. Nothing has been booked.');
    out.next = ['Work through the red items above. Each one says what to change.', 'The carrier, price and checks update as soon as the details change.', 'Once there are no red items you can confirm the booking.'];
  } else {
    const eta = b.readyDate ? addDays(b.readyDate, sel.transit) : null;
    out.headline = ev.status === 'clear' ? 'Clear to ship' : 'Ready to ship, with warnings';
    out.lines.push('Your shipment of ' + what + ' goes from ' + route + ' with ' + sel.carrier + ' (' + sel.service + ').');
    out.lines.push('Collection ' + niceDate(b.readyDate) + ', delivery about ' + niceDate(eta) + ' (' + sel.transit + ' days), total ' + gbp(sel.price * b.pallets) + '.');
    if (ev.counts.amber) out.lines.push(ev.counts.amber + ' warning' + (ev.counts.amber === 1 ? '' : 's') + ' won’t stop the booking, but fixing them avoids delays or surcharges.');
    out.next = [
      'The carrier collects from ' + (b.originCity || 'your site') + ' on ' + niceDate(b.readyDate) + '. Have the pallets labelled and wrapped.',
      'Send the commercial invoice with the goods. It should match this booking: HS codes, values and countries of origin.',
      b.destType === 'Warehouse' ? 'Keep your delivery appointment details handy. The driver will need them at ' + (b.destCity || 'the warehouse') + '.' : 'Make sure someone is available to receive the delivery at the business address.',
      'You’ll get the carrier’s tracking once collection is confirmed.'
    ];
  }
  return out;
}

/* ---------- Spreadsheet reading ---------- */
const nh = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) if (rows[i] && rows[i].some(c => nh(c) === 'booking id')) return i;
  return -1;
}
function tableFromRows(rows) {
  const hi = findHeaderRow(rows);
  if (hi < 0) return null;
  const heads = rows[hi].map(nh);
  const recs = rows.slice(hi + 1).filter(r => r && r.some(c => c !== null && c !== undefined && String(c).trim() !== '')).map((r, n) => {
    const o = { _row: hi + 2 + n };
    heads.forEach((h, i) => { if (h) o[h] = r[i] === undefined ? null : r[i]; });
    return o;
  });
  return recs;
}
function pickKey(o, ...cands) { for (const c of cands) if (c in o) return o[c]; return null; }
function bookingsFromTables(bookingRows, itemRows) {
  const warnings = [];
  const bt = tableFromRows(bookingRows), it = tableFromRows(itemRows);
  if (!bt) return { error: 'I couldn’t find a “Booking ID” header in the Bookings sheet.' };
  if (!it) return { error: 'I couldn’t find a “Booking ID” header in the Items sheet.' };
  const bookings = [];
  bt.forEach(r => {
    const id = clean(r['booking id']);
    if (!id) return;
    const prRaw = clean(pickKey(r, 'seller priority'));
    const pr = PRIORITIES.find(p => prRaw && p.toLowerCase() === prRaw.toLowerCase());
    const dtRaw = clean(pickKey(r, 'destination type'));
    const apRaw = clean(pickKey(r, 'delivery appointment booked'));
    const b = {
      id, seller: clean(r['seller name']), originCity: clean(r['origin city']), originCountry: clean(r['origin country']),
      destCity: clean(r['destination city']), destCountry: clean(r['destination country']),
      destType: dtRaw ? (/ware/i.test(dtRaw) ? 'Warehouse' : 'Business address') : null,
      readyDate: parseDate(r['ready to ship date']), readyDateRaw: r['ready to ship date'],
      priority: pr || null, priorityRaw: prRaw,
      pallets: num(r['pallets']), cartons: num(r['cartons']), declaredValue: num(r['total declared value']),
      currency: clean(r['currency']) || 'GBP', grossWeight: num(r['total gross weight kg']),
      appointment: apRaw ? (/^y/i.test(apRaw) ? 'Yes' : 'No') : 'No', items: []
    };
    bookings.push(b);
  });
  const byId = {}; bookings.forEach(b => { byId[b.id.toLowerCase()] = b; });
  const orphan = {};
  it.forEach(r => {
    const id = clean(r['booking id']); if (!id) return;
    const b = byId[id.toLowerCase()];
    const item = {
      sku: clean(r['sku']), desc: clean(r['description']), hs: (r['hs code'] === null || r['hs code'] === undefined || String(r['hs code']).trim() === '') ? null : r['hs code'],
      qty: num(r['quantity units']), price: num(r['unit price']), upc: num(r['units per carton']), cartons: num(r['cartons']),
      unitWeight: num(r['unit weight kg']), coo: clean(r['country of origin'])
    };
    if (b) b.items.push(item); else orphan[id] = (orphan[id] || 0) + 1;
  });
  Object.keys(orphan).forEach(id => warnings.push('Items listed for ' + id + ' have no matching booking, so they were ignored.'));
  return { bookings, warnings };
}
function parseWorkbook(XLSX, data) {
  const wb = XLSX.read(data, { type: 'array' });
  const names = wb.SheetNames.filter(n => !/carrier|rule|allowed|field|gloss/i.test(n));
  const bn = names.find(n => /booking/i.test(n)) || names[0];
  const inn = names.find(n => /^items?$/i.test(n.trim())) || names.find(n => /item/i.test(n)) || names[1];
  if (!bn || !inn || bn === inn) return { error: 'I need two sheets: Bookings and Items. This file has ' + wb.SheetNames.length + ' sheet' + (wb.SheetNames.length === 1 ? '' : 's') + '.' };
  const rows = n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: false });
  return bookingsFromTables(rows(bn), rows(inn));
}

/* ---------- Sample data (same structure as the case template) ---------- */
const BH = ['Booking ID', 'Seller name', 'Origin city', 'Origin country', 'Destination city', 'Destination country', 'Destination type', 'Ready to ship date', 'Seller priority', 'Pallets', 'Cartons', 'Total declared value', 'Currency', 'Total gross weight (kg)', 'Delivery appointment booked'];
const IH = ['Booking ID', 'SKU', 'Description', 'HS code', 'Quantity (units)', 'Unit price', 'Units per carton', 'Cartons', 'Unit weight (kg)', 'Country of origin'];
function sampleTables(today) {
  const d = n => dmy(addDays(today, n));
  const B = (id, seller, oc, dc, dcty, dt, date, pr, pal, car, val, gw, ap) => [id, seller, oc, 'United Kingdom', dc, dcty, dt, date, pr, pal, car, val, 'GBP', gw, ap];
  const bookings = [
    B('BK-001', 'Northfield Goods', 'Manchester', 'Frankfurt', 'Germany', 'Warehouse', d(11), 'Cheapest', 3, 90, 5400, 620, 'Yes'),
    B('BK-002', 'Harbour & Co', 'London', 'Paris', 'France', 'Business address', d(7), 'Fastest', 2, 70, 6200, 340, 'No'),
    B('BK-003', 'Brightside Textiles', 'Leeds', 'Amsterdam', 'Netherlands', 'Warehouse', d(9), 'Balanced', 2, 40, 6200, 300, 'Yes'),
    B('BK-004', 'Delta Pantry', 'Birmingham', 'Lyon', 'France', 'Warehouse', d(8), 'Cheapest', 2, 60, 3600, 700, 'Yes'),
    B('BK-005', 'Elm Street Prints', 'London', 'Berlin', 'Germany', 'Business address', d(6), 'Most reliable', 1, 100, 2400, 120, 'No'),
    B('BK-006', 'Forge Hardware', 'Manchester', 'Rotterdam', 'Netherlands', 'Warehouse', d(10), 'Fastest', 2, 100, 7000, 1000, 'Yes'),
    B('BK-007', 'Granite Stone Co', 'Leeds', 'Hamburg', 'Germany', 'Warehouse', d(12), 'Cheapest', 1, 60, 3000, 900, 'Yes'),
    B('BK-008', 'Hexa Gadgets', 'London', 'Frankfurt', 'Germany', 'Warehouse', d(9), 'Balanced', 1, 40, 4000, 120, 'Yes'),
    B('BK-009', 'Ivory Lane Home', 'Birmingham', 'Paris', 'France', 'Warehouse', d(7), 'Cheapest', 2, 50, 5000, 300, 'Yes'),
    B('BK-010', 'Juniper Foods', 'London', 'Amsterdam', 'Netherlands', 'Warehouse', d(8), 'Balanced', 2, 48, 2880, 340, 'No'),
    B('BK-011', 'Kestrel Outdoors', 'Manchester', 'Hamburg', 'Germany', 'Warehouse', d(11), 'Most reliable', 2, 36, 4320, 380, 'Yes'),
    B('BK-012', 'Larch Stationery', 'Leeds', 'Lyon', 'France', 'Business address', d(-20), 'Cheapest', 1, 25, 1250, 200, 'No'),
    B('BK-013', 'Maple Ridge Trading', 'London', 'Berlin', 'Germany', 'Warehouse', d(-3), 'Fastest', 1, 80, 9000, 700, 'No'),
    B('BK-014', 'Nova Pantry', 'London', 'Lyon', 'France', 'Business address', d(14), 'Balanced', 1, 20, 1009, 400, 'No')
  ];
  const I = (id, sku, desc, hs, q, p, u, c, w, o) => [id, sku, desc, hs, q, p, u, c, w, o];
  const items = [
    I('BK-001', 'MUG-01', 'Ceramic coffee mug, 350 ml', 691200, 1080, 5, 12, 90, 0.5, 'United Kingdom'),
    I('BK-002', 'TOTE-01', 'Cotton tote bag', null, 600, 4.5, 20, 30, 0.2, 'India'),
    I('BK-002', 'CAND-01', 'Soy wax candle, 200 g', 34060, 400, 8.75, 10, 40, 0.45, 'United Kingdom'),
    I('BK-003', 'SCARF-01', 'Merino wool scarf', 621410, 800, 6.75, 20, 40, 0.3, 'United Kingdom'),
    I('BK-004', 'JAM-01', 'Strawberry jam, 340 g jar', 200799, 1200, 3, 24, 60, 0.5, 'United Kingdom'),
    I('BK-005', 'POSTER-01', 'A3 art print', 491191, 800, 3, 10, 80, 0.1, 'United Kingdom'),
    I('BK-006', 'TOOL-01', 'Steel hand tool set', 820600, 700, 10, 7, 100, 1.35, 'Germany'),
    I('BK-007', 'COAST-01', 'Slate drinks coaster set', 680300, 600, 5, 10, 60, 1.4, 'United Kingdom'),
    I('BK-008', 'PB-01', 'Lithium-ion power bank, 10000 mAh', 850760, 200, 8, 10, 20, 0.25, 'China'),
    I('BK-008', 'AERO-01', 'Aerosol deodorant spray, 150 ml', 330720, 200, 12, 10, 20, 0.2, 'United Kingdom'),
    I('BK-009', 'CUSH-01', 'Linen cushion cover', 630492, 1000, 5, 20, 50, 0.4, 'India'),
    I('BK-010', 'TEA-01', 'Loose leaf black tea, 100 g', '090240', 2400, 1.2, 50, 48, 0.12, 'India'),
    I('BK-011', 'TENT-01', 'Two-person camping tent', 630622, 144, 30, 4, 36, 2.1, null),
    I('BK-012', 'PEN-01', 'Ballpoint pens, box of 20', 960810, 500, 2.5, 20, 25, 0.35, 'China'),
    I('BK-013', 'SPK-01', 'Bluetooth speaker with built-in lithium battery', '85', 300, 25, 10, 20, 0.8, 'China'),
    I('BK-013', 'LAMP-01', 'LED desk lamp', 940520, 100, 15, 10, 10, 1.2, null),
    I('BK-014', 'OIL-01', 'Olive oil, 500 ml bottle', 150910, 400, 2.5, 20, 20, 0.9, 'Turkey')
  ];
  return {
    bookingRows: [['Bookings — one row per record. Row 3 is an example (grey); enter data from row 4.'], BH].concat(bookings),
    itemRows: [['Items — one row per record. Row 3 is an example (grey); enter data from row 4.'], IH].concat(items)
  };
}

export {
  CARRIERS, RULES, PRIORITIES, ORIGINS, DESTS, COUNTRIES, BALANCED_WEIGHTS, BH, IH,
  gbp, nf, ymd, todayISO, addDays, diffDays, dmy, niceDate, parseDate, num, clean,
  rankBy, recommend, evaluate, summarise, hazardOf, hsInfo,
  bookingsFromTables, parseWorkbook, sampleTables
};
