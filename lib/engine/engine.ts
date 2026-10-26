// @ts-nocheck
import { FIELDS, checkNumber, checkHs, inputErrorText } from '../validate';
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
  if (v instanceof Date) {
    if (isNaN(v)) return null;
    // A date cell is a calendar day, not a moment: read it in UTC when it sits on UTC midnight, otherwise as local time.
    const utcMidnight = v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0;
    return utcMidnight ? ymd(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()) : ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) { const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5); return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }
    return null;
  }
  const s = String(v).trim();
  let m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/.exec(s);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return ymd(y, +m[2], +m[1]); }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  const mon = t => { const i = MON.findIndex(x => x.toLowerCase() === t.slice(0, 3).toLowerCase()); return i < 0 ? 0 : i + 1; };
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})$/.exec(s);          // 10th Nov 2026, 5 November 2026
  if (m && mon(m[2])) return ymd(+m[3], mon(m[2]), +m[1]);
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s);                 // Dec 9, 2026
  if (m && mon(m[1])) return ymd(+m[3], mon(m[1]), +m[2]);
  return null;
}
// A text date such as 05-11-2026 is read day-first. When that lands in the past but month-first would not, R-10 says so.
function monthFirstReading(raw, today) {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/.exec(raw.trim());
  if (!m || +m[1] > 12 || +m[2] > 12 || m[1] === m[2]) return null;
  let y = +m[3]; if (y < 100) y += 2000;
  const alt = ymd(y, +m[1], +m[2]);
  return alt && alt >= today ? alt : null;
}
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).replace(/[£,\s]/g, '').replace(/gbp/i, '');
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  return parseFloat(s);
}
const BLANKISH = /^(n\/?a|na|-+|—|–|unknown|tbc|tbd|none|null|nil|\?+)$/i;
const isBlankish = v => v === null || v === undefined || String(v).trim() === '' || BLANKISH.test(String(v).trim());
const clean = v => (v === null || v === undefined) ? null : (String(v).trim() === '' ? null : String(v).trim());

/* ---------- Carrier logic ---------- */
const letterOf = o => o.carrier.slice(-1);
// Deterministic order: the priority's own measure first, then lower price, then fewer days, then carrier letter.
function rankBy(list, priority) {
  const L = list.slice();
  const tie = (a, c) => a.price - c.price || a.transit - c.transit || letterOf(a).localeCompare(letterOf(c));
  if (priority === 'Cheapest') return L.sort((a, c) => tie(a, c));
  if (priority === 'Fastest') return L.sort((a, c) => a.transit - c.transit || tie(a, c));
  if (priority === 'Most reliable') return L.sort((a, c) => c.ontime - a.ontime || tie(a, c));
  // Balanced: each measure scaled 0..1 across the carriers being compared (lower price and fewer days are better,
  // higher on-time is better), then the three scores are averaged with equal weight.
  const rng = k => { const v = L.map(x => x[k]); return [Math.min.apply(null, v), Math.max.apply(null, v)]; };
  const [p0, p1] = rng('price'), [t0, t1] = rng('transit'), [o0, o1] = rng('ontime');
  const n = (v, lo, hi, inv) => hi === lo ? 1 : (inv ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo));
  L.forEach(x => { x.score = BALANCED_WEIGHTS.cost * n(x.price, p0, p1, true) + BALANCED_WEIGHTS.speed * n(x.transit, t0, t1, true) + BALANCED_WEIGHTS.reliability * n(x.ontime, o0, o1, false); });
  return L.sort((a, c) => (Math.round(c.score * 1e9) - Math.round(a.score * 1e9)) || tie(a, c));
}
function recommend(b) {
  const rows = CARRIERS.filter(c => c.dest === b.destCountry);
  if (!rows.length) return { error: 'unsupported', options: [] };
  const p = b.pallets;
  const pallets = (typeof p === 'number' && isFinite(p) && p > 0 && Number.isInteger(p)) ? p : null;
  const gw = (typeof b.grossWeight === 'number' && isFinite(b.grossWeight) && b.grossWeight >= 0) ? b.grossWeight : null;
  const wpp = pallets && gw !== null ? gw / pallets : null;
  const priority = PRIORITIES.indexOf(b.priority) >= 0 ? b.priority : 'Balanced';
  const options = rows.map(r => {
    const o = Object.assign({}, r);
    o.cost = pallets ? r.price * pallets : null;
    o.eligible = wpp === null ? true : wpp <= r.maxKg + 1e-9;      // exactly at the limit passes
    o.minPallets = gw !== null ? Math.max(1, Math.ceil(gw / r.maxKg - 1e-9)) : null;
    o.minCost = o.minPallets ? o.minPallets * r.price : null;
    return o;
  });
  // First choice for the priority, ignoring weight (used only to explain what was ruled out).
  const preferred = rankBy(options, priority)[0];
  // The recommendation only considers carriers that can take the load, then ranks them by priority.
  const feasible = options.filter(o => o.eligible);
  const recommended = feasible.length ? rankBy(feasible, priority)[0] : null;
  // With no usable pallet count or gross weight there is nothing to price or check against a weight limit, so nothing is recommended.
  const blocked = !pallets || gw === null;
  const rec = { options, pallets, gw, wpp, priority, preferred, recommended: blocked ? null : recommended, blocked, assumedPriority: PRIORITIES.indexOf(b.priority) < 0 };
  // R-05 is checked against the carrier in use: one the user picked, otherwise the recommendation.
  const picked = b._carrier ? options.find(o => o.carrier === b._carrier) : null;
  // The priority's own pick (ignoring weight) is the carrier in use unless the seller chose one. If it cannot take the load R-05 is Red with
  // priced fixes; the booking is not quietly moved to another carrier.
  rec.selected = picked || preferred;
  rec.userPicked = !!picked;
  rec.reason = explain(rec, b);
  rec.ruledOutNotes = ruledOutNotes(rec);
  return rec;
}
const plu = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
function diffText(o, r) {
  const bits = [];
  const dp = o.price - r.price; if (dp) bits.push(gbp(Math.abs(dp)) + ' a pallet ' + (dp < 0 ? 'cheaper' : 'dearer'));
  const dt = o.transit - r.transit; if (dt) bits.push(plu(Math.abs(dt), 'day') + ' ' + (dt < 0 ? 'faster' : 'slower'));
  const dr = o.ontime - r.ontime; if (dr) bits.push(plu(Math.abs(dr), 'point') + ' ' + (dr > 0 ? 'more' : 'less') + ' reliable');
  return bits.length ? bits.join(', ') : 'the same on price, speed and reliability';
}
function explain(rec, b) {
  if (rec.blocked) return 'Fix the input errors above to get a carrier recommendation.';
  const all = rec.options, p = rec.priority, n = rec.pallets, dest = b.destCountry;
  if (!rec.recommended) {
    const maxLimit = Math.max.apply(null, all.map(o => o.maxKg));
    return 'No carrier on this route can take ' + nf(rec.wpp) + ' kg per pallet (the highest limit is ' + maxLimit + ' kg). The load has to be split across more pallets.';
  }
  const r = rec.recommended, label = r.carrier + ' (' + r.service + ')';
  const cost = n ? ' Total ' + gbp(r.price * n) + ' for ' + plu(n, 'pallet') + '.' : '';
  const feas = all.filter(o => o.eligible), others = feas.filter(o => o !== r);
  const facts = gbp(r.price) + ' a pallet, ' + plu(r.transit, 'day') + ', ' + r.ontime + '% on time.';
  let s;
  if (p === 'Cheapest') s = label + ' is the cheapest carrier that can take this load to ' + dest + ': ' + gbp(r.price) + ' a pallet.' + cost + ' It takes ' + plu(r.transit, 'day') + ' and arrives on time ' + r.ontime + '% of the time.';
  else if (p === 'Fastest') s = label + ' is the fastest carrier that can take this load to ' + dest + ': ' + plu(r.transit, 'day') + '.' + (feas.every(o => o.ontime <= r.ontime) ? ' It also has the best on-time record, ' + r.ontime + '%.' : ' It arrives on time ' + r.ontime + '% of the time.') + ' ' + gbp(r.price) + ' a pallet.' + cost;
  else if (p === 'Most reliable') s = label + ' has the highest on-time rate of the carriers that can take this load: ' + r.ontime + '%.' + (feas.every(o => o.transit >= r.transit) ? ' It is also the quickest, at ' + plu(r.transit, 'day') + '.' : ' Transit is ' + plu(r.transit, 'day') + '.') + cost;
  else {
    const scores = rankBy(feas, 'Balanced').map(o => letterOf(o) + ' ' + o.score.toFixed(2)).join(', ');
    s = label + ' scores highest on Balanced for ' + dest + ': ' + facts + cost +
      ' Balanced scores each carrier from 0 to 1 on price, speed and reliability (lower price and fewer days are better, higher on-time is better), compares them across the carriers that can take this load, and weights them cost 40%, speed 30%, reliability 30%. Scores: ' + scores + '.' +
      (others.length ? ' The others lost: ' + others.map(o => o.carrier + ' is ' + diffText(o, r)).join('; ') + '.' : '');
  }
  if (rec.assumedPriority) s += ' No priority was given, so we used Balanced.';
  return s;
}
// Neutral notes about carriers that were ruled out for weight. Not a failure while another carrier can take the load.
function ruledOutNotes(rec) {
  if (!rec.recommended || rec.wpp === null) return [];
  const tag = { 'Cheapest': 'cheapest per pallet', 'Fastest': 'fastest', 'Most reliable': 'most reliable', 'Balanced': 'best balanced' }[rec.priority];
  const recTotal = rec.pallets ? rec.recommended.price * rec.pallets : null;
  return rec.options.filter(o => !o.eligible).map(o => {
    let t = o.carrier + (o === rec.preferred ? ' (' + tag + ')' : '') + ' was ruled out: ' + nf(rec.wpp) + ' kg per pallet exceeds its ' + o.maxKg + ' kg limit.';
    if (o.minPallets) t += ' With ' + plu(o.minPallets, 'pallet') + ' it would fit at ' + gbp(o.minCost) + (o === rec.preferred && recTotal !== null ? ', but ' + rec.recommended.carrier + ' at ' + plu(rec.pallets, 'pallet') + ' is ' + (recTotal <= o.minCost ? 'cheaper' : 'dearer') + ' at ' + gbp(recTotal) : '') + '.';
    return t;
  });
}

/* ---------- Hazard detection (R-06) ---------- */
/* R-06 runs in layers so it catches hazards that never use the obvious word (earbuds, perfume)
   and does not panic at safe uses of scary words (non-flammable, battery-free, alkaline AA, spray bottle). */
const NEG = /\b(non[\s-]?flammable|not\s+flammable|non[\s-]?inflammable|flame[\s-]?(?:retardant|resistant)|fire[\s-]?(?:retardant|resistant|proof)|non[\s-]?aerosol|battery[\s-]?free|lithium[\s-]?free|no\s+batter(?:y|ies)|without\s+batter(?:y|ies)|batter(?:y|ies)\s+not\s+included|non[\s-]?lithium|alcohol[\s-]?free|fragrance[\s-]?free|solvent[\s-]?free|water[\s-]?based)\b/gi;
const LI_EXPLICIT = /\b(lithium(?![\s-]*(?:soap|grease|stearate|salt|carbonate|hydroxide|chloride)\b)|li[\s-]?ion|li[\s-]?po(?:ly(?:mer)?)?|lipo|lifepo4|18650|21700|cr20(?:16|25|32)|button\s+cells?|coin\s+cells?)\b/i;
const NON_LI_CELL = /\b(alkaline|zinc[\s-]?(?:carbon|chloride)|ni[\s-]?mh|nickel[\s-]?metal|lead[\s-]?acid)\b/i;
const LI_DEVICE = /\b(power\s?banks?|portable\s+chargers?|e[\s-]?cig(?:arette)?s?|vapes?|vape\s+pens?|vaping|e[\s-]?bikes?|electric\s+(?:bikes?|bicycles?|scooters?|skateboards?|toothbrush(?:es)?|shavers?|razors?)|e[\s-]?scooters?|hoverboards?|(?:wireless|bluetooth|true\s+wireless|tws|noise[\s-]?cancel+ing)\s+(?:ear\s?buds?|earphones?|headphones?|headsets?|speakers?)|ear\s?buds?|airpods|smart\s?watch(?:es)?|fitness\s+trackers?|activity\s+trackers?|smart\s?phones?|mobile\s+phones?|laptops?|notebook\s+computers?|ipads?|android\s+tablets?|tablet\s+(?:computers?|pcs?)|drones?|action\s+cam(?:era)?s?|dash\s?cams?|digital\s+cameras?|portable\s+speakers?|cordless\s+(?:drills?|vacuums?|screwdrivers?|tools?|trimmers?|hoovers?)|rechargeable|built[\s-]?in\s+batter(?:y|ies)|gps\s+trackers?|smart\s+rings?)\b/i;
const ACCESSORY = /\b(phone|smartphone|laptop|tablet|ipad|camera|watch|smartwatch|ear\s?buds?|headphones?|speaker|drone|airpods)s?\s+(cases?|covers?|sleeves?|bags?|pouch(?:es)?|stands?|holders?|mounts?|straps?|bands?|skins?|protectors?|cables?|leads?|docks?|tripods?)\b|\bscreen\s+protectors?\b/i;
const BATTERY_WORD = /\b(batter(?:y|ies)|battery[\s-]?(?:powered|operated))\b/i;
const AEROSOL = /\b(aerosols?|spray[\s-]?(?:paints?|cans?)|hair\s?sprays?|body\s+sprays?|deodorant\s+sprays?|spray\s+deodorants?|antiperspirant\s+sprays?|dry\s+shampoo|canned\s+air|compressed\s+air|pressuri[sz]ed\s+(?:cans?|containers?|cylinders?)|shaving\s+(?:foam|gel)|whipped\s+cream\s+(?:cans?|chargers?)|cream\s+chargers?|air\s+freshener\s+sprays?|insect\s+sprays?|bug\s+sprays?|fly\s+sprays?|wd[\s-]?40|spray[\s-]?(?:starch|tan|sunscreen|polish|oil)|cooking\s+sprays?)\b/i;
const NOT_AEROSOL = /\b(pump|trigger|mister|atomi[sz]er|empty|refillable\s+bottle)\b/i;
const FLAMMABLE = /\b(flammable|inflammable|petrol|gasoline|kerosene|paraffin|lamp\s+oil|diesel|bio[\s-]?ethanol|ethanol|methanol|lighter\s+(?:fluid|fuel|gas|refills?)|(?:cigarette|gas|butane|disposable|refillable|windproof|jet|pocket)\s+lighters?|white\s+spirit|turpentine|acetone|methylated\s+spirits?|denatured\s+alcohol|paint\s+thinners?|(?:oil|solvent)[\s-]based\s+(?:paints?|varnish(?:es)?|stains?|primers?)|varnish(?:es)?|lacquers?|wood\s+stains?|contact\s+adhesive|nail\s+(?:polish|varnish|lacquer)(?:\s+remover)?|box(?:es)?\s+of\s+matches|matchbooks?|matchsticks?|safety\s+matches|butane|propane|camping\s+gas|gas\s+canisters?|isopropyl|rubbing\s+alcohol|surgical\s+spirit|hand\s+sanitis?ers?|alcohol[\s-]based|perfumes?|parfum|eau\s+de\s+(?:parfum|toilette|cologne)|colognes?|after[\s-]?shave|body\s+mist|reed\s+diffusers?|fragrance\s+oils?)\b/i;
const SPIRIT = /\b(whisk(?:e)?y|scotch|bourbon|vodka|gin|rum|brandy|cognac|armagnac|tequila|mezcal|absinthe|schnapps|grappa|ouzo|liqueur|spirits?)\b/i;
function hazardOf(it) {
  const raw = ((it.desc || '') + ' ' + (it.sku || ''));
  const text = raw.replace(NEG, ' ');
  let m;
  if ((m = LI_EXPLICIT.exec(text))) return { kind: 'lithium', type: 'a lithium battery or a product containing one', word: m[0], level: 'definite' };
  const noBatt = /batter(?:y|ies)\s+not\s+included|without\s+batter(?:y|ies)|no\s+batter(?:y|ies)/i.test(raw);
  if (!noBatt && !ACCESSORY.test(text) && (m = LI_DEVICE.exec(text))) return { kind: 'lithium', type: 'a device that almost always contains a lithium battery', word: m[0], level: 'likely' };
  if (!noBatt && (m = BATTERY_WORD.exec(text)) && !NON_LI_CELL.test(text)) return { kind: 'lithium', type: 'a battery product whose chemistry isn’t stated (most are lithium)', word: m[0], level: 'likely' };
  if ((m = AEROSOL.exec(text)) && !NOT_AEROSOL.test(text)) return { kind: 'aerosol', type: 'an aerosol', word: m[0], level: 'definite' };
  const text2 = text.replace(/\bpetrol[\s-]?(?:blue|green|grey|gray|colou?r(?:ed)?)\b/gi, ' ').replace(/\bparaffin\s+wax\b/gi, ' ');
  if ((m = FLAMMABLE.exec(text2))) return { kind: 'flammable', type: 'a flammable liquid', word: m[0], level: 'definite' };
  const abv = /(\d{1,2}(?:\.\d+)?)\s*%\s*(?:abv|vol|alc|alcohol)/i.exec(text);
  if (abv && +abv[1] > 24) return { kind: 'flammable', type: 'a flammable liquid (spirits above 24% alcohol are classed as flammable for transport)', word: abv[0], level: 'definite' };
  const NOT_DRINK = /\b(glass(?:es)?|tumblers?|decanters?|stones?|flasks?\s+empty|empty|barrel\s+(?:planter|table)|label|sign|poster|print|book|scented|candle|soap|chocolates?|truffles?|fudge|cake|marmalade|jam|tea|coffee|cufflinks?|t-?shirt|mug|coasters?|ice\s+cubes?|cocktail\s+(?:shaker|set|kit)|jigger|bar\s+tools?|optic|measure)\b/i;
  if (!abv && (m = SPIRIT.exec(text)) && !NOT_DRINK.test(text) && !/\b(ginger|gingham|spirit\s+level|team\s+spirit|rum\s+(?:cake|fudge|truffles?))\b/i.test(text)) return { kind: 'flammable', type: 'spirits, usually above 24% alcohol and classed as a flammable liquid for transport', word: m[0], level: 'likely' };
  return null;
}
/* Things worth telling the seller about an item that are NOT rulebook failures. */
function itemAdvisories(it) {
  const out = [], raw = ((it.desc || '') + ' ' + (it.sku || ''));
  if (BATTERY_WORD.test(raw) && NON_LI_CELL.test(raw) && !LI_EXPLICIT.test(raw)) out.push({ title: 'Batteries, but not lithium', what: (it.sku || 'This item') + ' is described as ' + NON_LI_CELL.exec(raw)[0] + ' batteries. R-06 only bans lithium, so this passes. Keep “' + NON_LI_CELL.exec(raw)[0] + '” in the description so the carrier doesn’t assume lithium.' });
  const negHit = raw.match(NEG); if (!hazardOf(it) && negHit) { out.push({ title: 'Safe wording noticed', what: (it.sku || 'This item') + ' mentions “' + negHit[0] + '”, so it is not treated as restricted. Make sure the product really is ' + negHit[0].toLowerCase() + '.' }); }
  const abv = /(\d{1,2}(?:\.\d+)?)\s*%\s*(?:abv|vol|alc|alcohol)/i.exec(raw);
  if (abv && +abv[1] <= 24) out.push({ title: 'Alcohol below the flammable threshold', what: (it.sku || 'This item') + ' is ' + abv[0] + '. Drinks at 24% alcohol or less are not treated as flammable liquids, so R-06 passes. Excise paperwork still applies.' });
  return out;
}
function hsInfo(v) {
  if (v === null || v === undefined || String(v).trim() === '') return { blank: true };
  const c = checkHs(v);
  const raw = String(v).trim(), digits = raw.replace(/[\s.]/g, '');
  // Only digits count. A leading minus or a letter makes the code invalid; all zeros is invalid whatever the length.
  return { blank: false, raw, digits, numeric: typeof v === 'number', valid: c.ok || c.reason === 'zeros', zeros: !c.ok && c.reason === 'zeros', negative: !c.ok && c.reason === 'negative' };
}

/* ---------- Input validation (shared with chat, the fix inputs and the editable table) ---------- */
const BOOK_KEYS = [['pallets', 'pallets'], ['cartons', 'cartons'], ['declaredValue', 'declaredValue'], ['grossWeight', 'grossWeight']];
const ITEM_KEYS = [['qty', 'qty'], ['price', 'price'], ['upc', 'upc'], ['cartons', 'itemCartons'], ['unitWeight', 'unitWeight']];
// Present-but-unacceptable numbers (0, negative, a fractional count, text) are reported as input errors. Their value is then
// treated as missing for the calculations, so no rule shows a misleading result based on a zero.
// The original spreadsheet cell is used only while the value is unchanged; once someone edits it, the edited value is what counts.
const rawFor = (obj, key) => (obj._raw && key in obj._raw && num(obj._raw[key]) === obj[key]) ? obj._raw[key] : obj[key];
function sanitizeInputs(bIn) {
  const found = [];
  const b = Object.assign({}, bIn, { items: (bIn.items || []).map(i => Object.assign({}, i)), _bad: {} });
  BOOK_KEYS.forEach(([key, fk]) => {
    const raw = rawFor(bIn, key);
    const c = checkNumber(fk, raw);
    if (c.ok) b[key] = c.value;
    else if (c.reason !== 'blank') { b._bad[key] = true; b[key] = null; found.push({ scope: 'booking', key, fk, check: c }); }
  });
  b.items.forEach((it, idx) => {
    it._bad = {};
    const src = bIn.items[idx];
    ITEM_KEYS.forEach(([key, fk]) => {
      const raw = rawFor(src, key);
      const c = checkNumber(fk, raw);
      if (c.ok) it[key] = c.value;
      else if (c.reason !== 'blank') { it._bad[key] = true; it[key] = null; found.push({ scope: 'item', idx, key, fk, check: c }); }
    });
  });
  return { b, found };
}

/* ---------- Rule engine ---------- */
function evaluate(bIn, opts) {
  const san = sanitizeInputs(bIn);
  const b = san.b;
  const today = (opts && opts.todayISO) || todayISO();
  const items = b.items || [];
  const issues = [], skipped = {}, advisories = [];
  const advise = (title, what) => advisories.push({ title, what });
  // Each issue says where it is: the booking, the SKU, and the spreadsheet row when the data came from a file.
  const add = (rule, sev, title, what, fix, item, src) => issues.push({ rule, sev, title, what, fix, item: item || null, bookingId: b.id || null,
    sheet: src ? (src._row ? 'Items' : null) : (b._row ? 'Bookings' : null), row: src ? (src._row || null) : (b._row || null) });
  const label = it => (it.sku || 'item') + (it.desc ? ' (' + it.desc + ')' : '');
  const rec = recommend(b);

  // Missing or unreadable inputs
  const data = (title, what, fix, src) => add('DATA', 'red', title, what, fix, null, src);
  if (b._dupCount > 1) data('Duplicate Booking ID', 'The Booking ID “' + b.id + '” appears ' + b._dupCount + ' times in the Bookings sheet (rows ' + (b._dupRows || []).join(', ') + '). Items can only be linked to one of them' + (b._dupLater ? ', and they were linked to the first row, so this row has none.' : '.'), 'Give every booking its own Booking ID, then upload the file again.');
  if (b._noId) add('INPUT', 'red', 'Input error: Booking ID', 'Bookings sheet, row ' + b._row + ' has no Booking ID. Add one and upload again.', 'Add a Booking ID to this row in the Bookings sheet, and the same ID to its rows in the Items sheet, then upload the file again. This row cannot be booked until then.');
  if (!items.length && !b._dupLater && !b._noId) data('No items found', 'This booking has no product lines in the Items sheet, so nothing can be checked against the invoice.', 'Add at least one product line with quantity, price and carton details.');
  if (rec.error) data('Route not supported', 'We can only book from the UK to Germany, France or the Netherlands. Destination country is “' + (b.destCountry || 'blank') + '”.', 'Use Germany, France or the Netherlands as the destination country.');
  // Places and choices outside the lists we can book are reported as missing details, never passed over.
  {
    const oc = b.originCity ? ORIGINS.find(o => o.toLowerCase() === String(b.originCity).trim().toLowerCase()) : null;
    if (!b.originCity) data('Collection city missing', 'The origin city is blank.', 'Use London, Manchester, Birmingham or Leeds.');
    else if (!oc) data('Collection city not supported', 'We can only collect from London, Manchester, Birmingham and Leeds. “' + b.originCity + '” isn’t one of them, so this can’t be booked.', 'Use London, Manchester, Birmingham or Leeds.');
    if (b.originCountry && !/^(united kingdom|uk|u\.k\.|gb|great britain|britain|england|scotland|wales)$/i.test(String(b.originCountry).trim())) data('Collection country not supported', 'We only collect in the United Kingdom. The origin country is “' + b.originCountry + '”.', 'Use United Kingdom.');
    const dcKey = b.destCity ? Object.keys(DESTS).find(d => d.toLowerCase() === String(b.destCity).trim().toLowerCase()) : null;
    if (!rec.error) {
      if (!b.destCity) data('Delivery city missing', 'The destination city is blank.', 'Use ' + Object.keys(DESTS).filter(d => DESTS[d] === b.destCountry).join(', ') + '.');
      else if (!dcKey) data('Delivery city not supported', 'We can only deliver to Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam and Rotterdam. “' + b.destCity + '” isn’t one of them, so this can’t be booked.', 'Use ' + Object.keys(DESTS).filter(d => DESTS[d] === b.destCountry).join(', ') + ' for ' + b.destCountry + '.');
      else if (DESTS[dcKey] !== b.destCountry) data('Delivery city and country don’t match', dcKey + ' is in ' + DESTS[dcKey] + ', but the destination country is ' + b.destCountry + '.', 'Change the country to ' + DESTS[dcKey] + ', or pick a city in ' + b.destCountry + ' (' + Object.keys(DESTS).filter(d => DESTS[d] === b.destCountry).join(', ') + ').');
    }
    if (b._rawChoices) {
      const rc = b._rawChoices;
      if (rc.destType && !b.destType) data('Destination type not recognised', '“' + rc.destType + '” isn’t a destination type. It must be Warehouse or Business address.', 'Use Warehouse or Business address.');
      if (rc.priority && !b.priority) data('Seller priority not recognised', '“' + rc.priority + '” isn’t one of the four priorities.', 'Use Cheapest, Fastest, Most reliable or Balanced.');
      if (rc.appointment && !b.appointment) data('Delivery appointment not recognised', '“' + rc.appointment + '” isn’t Yes or No.', 'Enter Yes or No.');
    }
  }
  if ((b.pallets === null || b.pallets === undefined) && !b._bad.pallets) data('Pallet count missing', 'Number of pallets is blank, so weight per pallet and price can’t be worked out.', 'Enter how many pallets the shipment is on.');
  if (typeof b.grossWeight !== 'number' && !b._bad.grossWeight) data('Gross weight missing', 'Total gross weight is blank or not a number.', 'Enter the total weight of everything shipped, including cartons and pallets.');
  const itemMiss = [];
  items.forEach(it => {
    [['qty', 'quantity'], ['price', 'unit price'], ['upc', 'units per carton'], ['cartons', 'cartons'], ['unitWeight', 'unit weight']].forEach(([k, n]) => { if (typeof it[k] !== 'number' && !(it._bad && it._bad[k])) itemMiss.push({ it, k, n }); });
  });
  itemMiss.forEach(m => data('Missing ' + m.n + ' for ' + (m.it.sku || 'an item'), label(m.it) + ' has no usable ' + m.n + '.', 'Fill in ' + m.n + ' for this item.', m.it));
  const has = (k) => items.every(i => typeof i[k] === 'number');
  // Input errors (Red): separate from R-01..R-10, but they block booking like any Red.
  san.found.forEach(f => {
    const info = FIELDS[f.fk], src = f.scope === 'item' ? items[f.idx] : null;
    const fromFile = src ? !!src._row : !!b._row;
    const row = src ? src._row : b._row;
    const sheet = src ? 'Items' : 'Bookings';
    const text = inputErrorText(f.fk, f.check);
    info.affects.forEach(r => { skipped[r] = 1; });
    add('INPUT', 'red', 'Input error: ' + info.column + (src && src.sku ? ' (' + src.sku + ')' : ''),
      (fromFile ? (b.id || '') + ' · ' + sheet + ' sheet, row ' + row + ' · ' : '') + text,
      (info.whole ? 'Enter a whole number greater than 0' : 'Enter a number greater than 0') + ' for ' + info.label.toLowerCase() + '. Checks that depend on it (' + info.affects.join(', ') + ') were skipped for this booking because of this input error, and will run once it is fixed.',
      src ? src.sku : null, src || undefined);
    const made = issues[issues.length - 1];
    made.field = f.fk; made.itemIndex = f.scope === 'item' ? f.idx : null;      // lets the Fix it here box target the right cell
  });

  const noItems = !items.length;
  const pence = v => Math.round(v * 100 + 1e-7);
  const sumVal = Math.round(items.reduce((s, i) => s + (i.qty || 0) * (i.price || 0), 0) * 100 + 1e-7) / 100;
  const sumCartons = items.reduce((s, i) => s + (i.cartons || 0), 0);
  const sumWt = items.reduce((s, i) => s + (i.qty || 0) * (i.unitWeight || 0), 0);

  // R-01 HS code
  items.forEach((it, idx) => {
    const h = hsInfo(it.hs);
    if (h.blank) add('R-01', 'red', 'HS code missing', label(it) + ' has no HS code. Customs can’t classify it, so it is likely to be held.', 'Look the product up in the UK Trade Tariff (gov.uk/trade-tariff) and enter at least the first 6 digits.', it.sku, it);
    else if (h.zeros) add('R-01', 'red', 'HS code is all zeros', (it.sku || 'This item') + ' has the HS code “' + h.raw + '”, which is all zeros. Enter a real code of at least 6 digits from the UK Trade Tariff.', 'Look the product up in the UK Trade Tariff (gov.uk/trade-tariff) and enter a real code of at least 6 digits.', it.sku, it);
    else if (!h.valid) add('R-01', 'red', 'HS code isn’t a number', label(it) + ' has the HS code “' + h.raw + '”, which contains characters other than digits.', 'Enter digits only, at least 6 (for example 691200).', it.sku, it);
    else if (h.digits.length < 6) {
      const lz = h.numeric && h.digits.length === 5;
      add('R-01', 'red', lz ? 'HS code lost its leading zero' : 'HS code too short',
        label(it) + ' has the HS code “' + h.raw + '” with only ' + h.digits.length + ' digit' + (h.digits.length === 1 ? '' : 's') + '. At least 6 are required.'
          + (lz ? ' It was stored as a number, so a leading 0 was probably dropped: 0' + h.digits + ' is likely what was meant. Codes for food and drink (chapters 01 to 09) all start with a zero.' : (h.digits.length === 5 ? ' A leading zero may have been dropped (for example 090111 saved as 90111).' : '')),
        lz ? 'Change it to 0' + h.digits + ' (check it in the UK Trade Tariff) and format the HS code column as text so the zero stays.' : 'Replace it with the full code (6 digits or more) from the UK Trade Tariff.' + (h.digits.length === 5 ? ' Format the HS code column as text so leading zeros stay.' : ''), it.sku, it);
      if (lz) issues[issues.length - 1].autofix = { label: 'Use 0' + h.digits, item: idx, set: { hs: '0' + h.digits } };
    }
  });

  // R-02 declared value (compared in whole pence; up to and including exactly 1% of the items total passes)
  if (noItems) skipped['R-02'] = 1;
  else if (typeof b.declaredValue !== 'number') { skipped['R-02'] = 1; if (!b._bad.declaredValue) data('Declared value missing', 'Total declared value is blank or not a number.', 'Enter the total value of the goods in GBP.'); }
  else if (!has('qty') || !has('price')) skipped['R-02'] = 1;
  else {
    const decP = pence(b.declaredValue), sumP = pence(sumVal), diffP = Math.abs(decP - sumP);
    const within = sumP === 0 ? diffP === 0 : diffP * 100 <= sumP;
    if (!within) {
      const pct = sumP === 0 ? null : diffP / sumP;
      add('R-02', 'red', 'Declared value doesn’t match the items',
        'Declared value is ' + gbp(b.declaredValue) + ', but quantity × unit price across all items adds up to ' + gbp(sumVal) + (pct === null ? '' : ' (' + nf(pct * 100) + '% ' + (decP > sumP ? 'higher' : 'lower') + ' than the items') + (pct === null ? '' : '; up to 1% is allowed)') + '. Customs relies on the invoice value, so a gap invites questions or a hold.',
        'Set the declared value to ' + gbp(sumVal) + ', or correct the quantities or unit prices if the declared figure is the right one.');
    }
  }

  // R-03 carton maths per item
  items.forEach(it => {
    if (typeof it.qty !== 'number' || typeof it.upc !== 'number' || typeof it.cartons !== 'number' || it.upc <= 0) return;
    if (Math.abs(it.upc * it.cartons - it.qty) > 1e-9) {
      const fix = (it.qty % it.upc === 0)
        ? 'If the quantity is right, this item should be ' + (it.qty / it.upc) + ' cartons. If ' + it.cartons + ' cartons is right, the quantity should be ' + (it.upc * it.cartons) + ' units. Check the packing list and fix whichever is wrong.'
        : it.qty + ' units doesn’t fill a whole number of cartons of ' + it.upc + ' (' + (it.qty % it.upc) + ' left over). Check units per carton, cartons and quantity against the packing list.';
      add('R-03', 'red', 'Carton maths doesn’t add up', label(it) + ': ' + it.upc + ' units per carton × ' + it.cartons + ' cartons = ' + (it.upc * it.cartons) + ' units, but the quantity is ' + it.qty + '. The receiving warehouse will count a different number from the paperwork.', fix, it.sku, it);
    }
  });

  // R-04 total cartons
  if (noItems) skipped['R-04'] = 1;
  else if (typeof b.cartons !== 'number') { skipped['R-04'] = 1; if (!b._bad.cartons) data('Total cartons missing', 'The booking’s total cartons is blank or not a number.', 'Enter the total number of cartons.'); }
  else if (!has('cartons')) skipped['R-04'] = 1;
  else if (Math.abs(b.cartons - sumCartons) > 1e-9) add('R-04', 'red', 'Total cartons don’t match the items',
    'The booking says ' + b.cartons + ' cartons, but the items add up to ' + sumCartons + '. Labels and counts at the warehouse won’t match the declaration.',
    'Set total cartons to ' + sumCartons + ', or add the missing ' + Math.abs(b.cartons - sumCartons) + ' carton' + (Math.abs(b.cartons - sumCartons) === 1 ? '' : 's') + ' to the item lines if ' + b.cartons + ' is right.');

  // R-05 weight per pallet against the carrier in use: the one the seller picked, otherwise the one their priority points at
  // (ignoring weight). Red when that carrier cannot take it, with the fixes priced: switch carrier, or add pallets.
  const sel = rec.selected;
  const last = () => issues[issues.length - 1];
  if (!sel || rec.wpp === null) skipped['R-05'] = 1;
  else if (!sel.eligible) {
    const nP = rec.pallets, over = rec.wpp - sel.maxKg, fixes = [];
    const keepN = sel.minPallets, keepCost = sel.minCost;
    if (rec.recommended) fixes.push('Switch to ' + rec.recommended.carrier + ' (' + rec.recommended.service + '), which takes up to ' + rec.recommended.maxKg + ' kg per pallet: ' + gbp(rec.recommended.price * nP) + ' for ' + plu(nP, 'pallet') + '.');
    if (rec.recommended) fixes.push('Or keep ' + sel.carrier + ' and spread the load over ' + plu(keepN, 'pallet') + ' (' + gbp(keepCost) + ', ' + nf(rec.gw / keepN) + ' kg each).');
    const best = rec.options.slice().sort((x, y) => x.minCost - y.minCost || x.transit - y.transit)[0];
    let extra;
    if (rec.recommended) {
      const sw = rec.recommended.price * nP;
      fixes.push(sw <= keepCost ? 'Switching is the cheaper fix (' + gbp(keepCost - sw) + ' less).' : 'Re-palletising is the cheaper fix (' + gbp(sw - keepCost) + ' less), but it means repacking.');
      extra = { autofix: { label: 'Switch to ' + rec.recommended.carrier, set: { _carrier: rec.recommended.carrier } }, autofix2: { label: 'Use ' + keepN + ' pallets with ' + sel.carrier, set: { pallets: keepN, _carrier: sel.carrier } } };
    } else {
      fixes.push('Split the load over more pallets. ' + rec.options.slice().sort((x, y) => x.minCost - y.minCost || x.minPallets - y.minPallets).map(o => o.carrier + ' needs ' + plu(o.minPallets, 'pallet') + ' (' + gbp(o.minCost) + ', ' + nf(rec.gw / o.minPallets) + ' kg each)').join('; ') + '.');
      fixes.push('Switching carrier cannot fix this: no carrier on this route takes ' + nf(rec.wpp) + ' kg per pallet (the highest limit is ' + Math.max.apply(null, rec.options.map(o => o.maxKg)) + ' kg). Cheapest way to make it fit: ' + best.carrier + ' on ' + plu(best.minPallets, 'pallet') + ' (' + gbp(best.minCost) + ').');
      extra = { autofix: { label: 'Use ' + best.minPallets + ' pallets with ' + best.carrier, set: { pallets: best.minPallets, _carrier: best.carrier } } };
    }
    add('R-05', 'red', rec.recommended ? 'Pallets too heavy for ' + sel.carrier : 'Pallets too heavy for every carrier on this route',
      nf(rec.wpp) + ' kg per pallet; ' + sel.carrier + ' (' + (b._carrier ? 'your choice' : rec.priority.toLowerCase()) + ') takes max ' + sel.maxKg + ' kg. That is ' + nf(rec.gw) + ' kg ÷ ' + plu(nP, 'pallet') + ', ' + nf(over) + ' kg over the limit, so the carrier is likely to refuse or re-price the pallets.',
      fixes.join(' '));
    Object.assign(last(), extra);
  }

  // R-06 dangerous goods: one finding per offending item, each removable on its own
  items.forEach(it => {
    const hz = hazardOf(it);
    if (hz) add('R-06', 'red', hz.kind === 'lithium' ? 'Lithium battery goods' : hz.kind === 'aerosol' ? 'Aerosol' : 'Flammable liquid',
      label(it) + (hz.level === 'definite' ? ' is ' : ' looks like ') + hz.type + ' (from “' + hz.word + '” in the description). Lithium batteries, aerosols and flammable liquids can’t travel as ordinary road freight, and an undeclared one can get the whole shipment stopped.',
      'Remove this item from the booking, or ship it separately with a carrier approved for dangerous goods.' + (hz.level === 'likely' ? ' If it really contains no ' + (hz.kind === 'lithium' ? 'lithium battery (for example it uses alkaline AA cells or is battery-free)' : 'flammable liquid') + ', say so in the description and this clears.' : ''), it.sku, it);
    itemAdvisories(it).forEach(a => advise(a.title, a.what));
  });

  // R-07 gross weight not below the sum of the items
  if (noItems || typeof b.grossWeight !== 'number' || !has('qty') || !has('unitWeight')) skipped['R-07'] = 1;
  else if (b.grossWeight < sumWt - 1e-9) {
    const huge = sumWt > 0 && b.grossWeight > 0 && sumWt / b.grossWeight > 50;
    let extra = '';
    if (b.pallets > 0 && sel && sumWt / b.pallets > sel.maxKg) extra = ' Heads up: at ' + nf(sumWt) + ' kg the load would be ' + nf(sumWt / b.pallets) + ' kg per pallet, above ' + sel.carrier + '’s ' + sel.maxKg + ' kg limit.';
    if (extra && !huge) {
      const fit = rec.options.filter(o => sumWt / b.pallets <= o.maxKg + 1e-9);
      const alt = fit.length ? rankBy(fit, rec.priority)[0] : null;
      advise('Correcting the weight changes the carrier', 'At the real weight (' + nf(sumWt) + ' kg or more) ' + sel.carrier + ' can no longer take the pallets. ' + (alt ? alt.carrier + ' would be the best fit for “' + rec.priority + '” at ' + gbp(alt.price * b.pallets) + '.' : 'No carrier would fit on ' + b.pallets + ' pallets, so more pallets would be needed.'));
    }
    add('R-07', 'amber', 'Gross weight is lower than the goods alone',
      'Total gross weight is ' + nf(b.grossWeight) + ' kg, but the items alone weigh ' + nf(sumWt) + ' kg (unit weight × quantity), before cartons and pallets. Under-declaring weight leads to carrier surcharges.' + (huge ? ' The gap is huge, so check whether unit weights were entered in grams instead of kg.' : ''),
      huge ? 'Check the unit weights first: if they are in grams, divide them by 1,000 (350 becomes 0.35). Otherwise raise the gross weight to at least ' + nf(sumWt) + ' kg.'
        : 'Raise the gross weight to at least ' + nf(sumWt) + ' kg (the expected minimum); with cartons and pallets it will usually be higher.' + extra);
  }

  // R-08 delivery appointment
  if (b.destType === 'Warehouse' && b.appointment !== 'Yes') add('R-08', 'amber', 'No delivery appointment',
    'This is going to a warehouse, and no delivery appointment is booked. Warehouses often turn away trucks that arrive without a slot.',
    'Book a delivery slot with the receiving warehouse before collection, then set “Delivery appointment booked” to Yes.');

  // R-09 country of origin
  items.forEach(it => {
    if (isBlankish(it.coo)) add('R-09', 'amber', 'Country of origin missing', label(it) + ' has no country of origin. This is where the product was made, not where it ships from. Customs uses it to set duty.', 'Add the country where it was made (for example United Kingdom, China, India, Vietnam, Turkey or Germany).', it.sku, it);
  });

  // R-10 date
  if (!b.readyDate) { skipped['R-10'] = 1; data('Ready date missing or unreadable', (b.readyDateRaw !== null && b.readyDateRaw !== undefined && String(b.readyDateRaw).trim() !== '' ? 'The ready to ship date “' + String(b.readyDateRaw).trim() + '” isn’t a valid DD-MM-YYYY date.' : 'The ready to ship date is blank.'), 'Enter the date as DD-MM-YYYY, for example 05-11-2026 for 5 November.'); }
  else if (b.readyDate < today) {
    const ago = diffDays(b.readyDate, today);
    add('R-10', 'amber', 'Ready date is in the past', 'The ready to ship date is ' + niceDate(b.readyDate) + ', which was ' + ago + ' day' + (ago === 1 ? '' : 's') + ' ago (today is ' + niceDate(today) + '). A carrier can’t collect in the past.', 'Choose today (' + dmy(today) + ') or a later date.');
    const us = monthFirstReading(b.readyDateRaw, today);
    if (us) last().what += ' The text “' + String(b.readyDateRaw).trim() + '” is read day-first; read month-first (MM-DD-YYYY) it would be ' + niceDate(us) + ', which is in the future. If that is what you meant, enter it as DD-MM-YYYY (' + dmy(us) + ').';
  }

  const order = { red: 0, amber: 1 };
  const ruleNo = r => (r === 'DATA' || r === 'INPUT') ? 0 : parseInt(r.slice(2), 10);
  issues.sort((a, c) => order[a.sev] - order[c.sev] || ruleNo(a.rule) - ruleNo(c.rule));
  const counts = { red: issues.filter(i => i.sev === 'red').length, amber: issues.filter(i => i.sev === 'amber').length };
  const ruleStatus = {};
  RULES.forEach(r => {
    const hit = issues.find(i => i.rule === r.id);
    ruleStatus[r.id] = hit ? hit.sev : (skipped[r.id] ? 'na' : 'pass');
  });
  const status = counts.red ? 'blocked' : counts.amber ? 'warning' : 'clear';
  return { issues, advisories, rec, counts, status, ruleStatus, calc: { sumVal, sumCartons, sumWt, wpp: rec.wpp }, today };
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
  for (let i = 0; i < Math.min(rows.length, 12); i++) if (rows[i] && rows[i].some(c => nh(c) === 'booking id')) return i;
  return -1;
}
// rowOffset is how many sheet rows sit above the first row we were given, so _row is the real spreadsheet row number.
function tableFromRows(rows, rowOffset) {
  const hi = findHeaderRow(rows);
  if (hi < 0) return null;
  const heads = rows[hi].map(nh);
  const recs = [];
  rows.slice(hi + 1).forEach((r, n) => {
    if (!r || !r.some(c => c !== null && c !== undefined && String(c).trim() !== '')) return;   // blank or whitespace-only row
    const o = { _row: (rowOffset || 0) + hi + 2 + n };
    heads.forEach((h, i) => { if (h) o[h] = r[i] === undefined ? null : r[i]; });
    recs.push(o);
  });
  recs.heads = heads;
  return recs;
}
function pickKey(o, ...cands) { for (const c of cands) if (c in o) return o[c]; return null; }
// Columns the sheets must have. Each entry is [display name, accepted header spellings].
const BOOKING_COLS = [['Booking ID', ['booking id']], ['Destination city', ['destination city']], ['Destination country', ['destination country']], ['Destination type', ['destination type']],
  ['Ready to ship date', ['ready to ship date']], ['Pallets', ['pallets']], ['Cartons', ['cartons']], ['Total declared value', ['total declared value', 'declared value']],
  ['Total gross weight (kg)', ['total gross weight kg', 'total gross weight', 'gross weight kg', 'gross weight']], ['Delivery appointment booked', ['delivery appointment booked', 'delivery appointment']]];
const ITEM_COLS = [['Booking ID', ['booking id']], ['Description', ['description']], ['HS code', ['hs code']], ['Quantity (units)', ['quantity units', 'quantity']], ['Unit price', ['unit price']],
  ['Units per carton', ['units per carton']], ['Cartons', ['cartons']], ['Unit weight (kg)', ['unit weight kg', 'unit weight']], ['Country of origin', ['country of origin']]];
const missingCols = (heads, spec) => spec.filter(([, alts]) => !alts.some(a => heads.indexOf(a) >= 0)).map(([n]) => n);
const pick = (r, ...keys) => { for (const k of keys) if (k in r) return r[k]; return null; };

// A Booking ID is trimmed and shown upper-case ("  bk-002 " is BK-002). Matching between sheets uses the same form, so it is case-insensitive.
const idKey = id => String(id).toLowerCase().replace(/[\s_\-.]+/g, '');      // "bk324", "BK 324" and "BK-324" are the same booking
const NOTE_ID = /^(totals?|sub-?totals?|grand\s*total|sum|average|count|notes?\b|n\.?b\.?\b|remarks?|comments?)/i;
const isNoteRow = (r, idv, keyCols) => !!idv && (NOTE_ID.test(idv) || (!/\d/.test(idv) && idv.split(' ').length >= 3) || (idv.split(' ').length >= 4 && keyCols.every(k => r[k] === null || r[k] === undefined || String(r[k]).trim() === '')));
const normId = v => { const t = clean(v); return t === null ? '' : t.replace(/\s+/g, ' ').toUpperCase(); };
function bookingsFromTables(bookingRows, itemRows, opts) {
  opts = opts || {};
  const warnings = [];
  const bt = tableFromRows(bookingRows, opts.bookingRowOffset), it = tableFromRows(itemRows, opts.itemRowOffset);
  if (!bt) return { error: 'I couldn’t find a “Booking ID” header in the first rows of the Bookings sheet.' };
  if (!it) return { error: 'I couldn’t find a “Booking ID” header in the first rows of the Items sheet.' };
  const mb = missingCols(bt.heads, BOOKING_COLS), mi = missingCols(it.heads, ITEM_COLS);
  if (mb.length || mi.length) {
    return { error: [mb.length ? 'The Bookings sheet is missing the column' + (mb.length === 1 ? '' : 's') + ': ' + mb.join(', ') + '.' : '', mi.length ? 'The Items sheet is missing the column' + (mi.length === 1 ? '' : 's') + ': ' + mi.join(', ') + '.' : '', 'Add ' + (mb.length + mi.length === 1 ? 'it' : 'them') + ' (the blank template shows the layout) and upload again.'].filter(Boolean).join(' ') };
  }
  const bookings = [];
  bt.forEach(r => {
    const id = normId(r['booking id']);
    const place = (v, list) => { const t = clean(v); return t === null ? null : (list.find(x => x.toLowerCase() === t.toLowerCase()) || t); };
    const country = v => { const t = clean(v); if (t === null) return null; const k = t.toLowerCase().replace(/[.\s]/g, ''); return ({ uk: 'United Kingdom', gb: 'United Kingdom', greatbritain: 'United Kingdom', britain: 'United Kingdom', england: 'United Kingdom', unitedkingdom: 'United Kingdom', de: 'Germany', deutschland: 'Germany', germany: 'Germany', fr: 'France', france: 'France', nl: 'Netherlands', holland: 'Netherlands', thenetherlands: 'Netherlands', netherlands: 'Netherlands' })[k] || t; };
    if (isNoteRow(r, id, ['seller name', 'destination country', 'pallets']) || (!id && ['seller name', 'destination city', 'destination country', 'pallets', 'cartons'].every(k => r[k] === null || r[k] === undefined || String(r[k]).trim() === ''))) {
      warnings.push('Bookings sheet, row ' + r._row + (id ? ' (“' + id.slice(0, 40) + (id.length > 40 ? '…' : '') + '”)' : '') + ' is a note or total, not a booking, so it was skipped.');
      return;
    }   // a row with data but no ID is kept, flagged Red, and never silently dropped
    const prRaw = clean(pickKey(r, 'seller priority'));
    const pr = PRIORITIES.find(p => prRaw && p.toLowerCase() === prRaw.toLowerCase());
    const dtRaw = clean(pickKey(r, 'destination type'));
    const apRaw = clean(pickKey(r, 'delivery appointment booked', 'delivery appointment'));
    const b = {
      id, _noId: !id, _row: r._row, seller: clean(r['seller name']), originCity: place(r['origin city'], ORIGINS), originCountry: country(r['origin country']),
      destCity: place(r['destination city'], Object.keys(DESTS)), destCountry: country(r['destination country']),
      destType: dtRaw ? (/^warehouse$/i.test(dtRaw) ? 'Warehouse' : /^business(?:\s+address)?$/i.test(dtRaw) ? 'Business address' : null) : null,
      readyDate: parseDate(r['ready to ship date']), readyDateRaw: r['ready to ship date'],
      priority: pr || null, priorityRaw: prRaw,
      _raw: { pallets: r['pallets'], cartons: r['cartons'], declaredValue: pick(r, 'total declared value', 'declared value'), grossWeight: pick(r, 'total gross weight kg', 'total gross weight', 'gross weight kg', 'gross weight') },
      pallets: num(r['pallets']), cartons: num(r['cartons']), declaredValue: num(pick(r, 'total declared value', 'declared value')),
      currency: clean(r['currency']) || 'GBP', grossWeight: num(pick(r, 'total gross weight kg', 'total gross weight', 'gross weight kg', 'gross weight')),
      appointment: apRaw && /^(y|yes|true|1)$/i.test(apRaw) ? 'Yes' : (!apRaw || /^(n|no|false|0)\b/i.test(apRaw)) ? 'No' : null, items: []
    };
    if ((dtRaw && !b.destType) || (prRaw && !b.priority) || (apRaw && !b.appointment)) b._rawChoices = { destType: dtRaw && !b.destType ? dtRaw : null, priority: prRaw && !b.priority ? prRaw : null, appointment: apRaw && !b.appointment ? apRaw : null };
    // Optional extra column written by corrected files: keeps a carrier the user chose. Absent in the standard template,
    // in which case R-05 uses the recommended carrier for the seller's priority.
    const carRaw = clean(pickKey(r, 'chosen carrier'));
    const carM = carRaw && /^carrier\s*([abc])$/i.exec(carRaw);
    if (carM) b._carrier = 'Carrier ' + carM[1].toUpperCase();
    bookings.push(b);
  });
  // Booking IDs match case-insensitively. A repeated ID is reported; items link to the first row with that ID.
  const byId = {}, seenRows = {};
  bookings.forEach((b, i) => {
    b._uid = i;
    if (b._noId) return;
    const k = idKey(b.id);
    (seenRows[k] = seenRows[k] || []).push(b._row);
    if (!byId[k]) byId[k] = b; else b._dupLater = true;
  });
  bookings.forEach(b => { if (b._noId) return; const rows = seenRows[idKey(b.id)]; if (rows.length > 1) { b._dupCount = rows.length; b._dupRows = rows; } });
  const dupIds = Object.keys(seenRows).filter(k => seenRows[k].length > 1);
  dupIds.forEach(k => warnings.push('Booking ID “' + byId[k].id + '” appears ' + seenRows[k].length + ' times in the Bookings sheet (rows ' + seenRows[k].join(', ') + '). Each copy is flagged, and its items are linked to the first one.'));
  const orphan = {};
  it.forEach(r => {
    const id = normId(r['booking id']);
    if (isNoteRow(r, id, ['sku', 'description', 'hs code', 'quantity units'])) { warnings.push('Items sheet, row ' + r._row + ' (“' + id.slice(0, 40) + (id.length > 40 ? '…' : '') + '”) is a note or total, not an item, so it was skipped.'); return; }
    if (!id) { warnings.push('Items sheet, row ' + r._row + ' has no Booking ID, so it was ignored.'); return; }
    const b = byId[idKey(id)];
    const item = {
      _row: r._row,
      _raw: { qty: pick(r, 'quantity units', 'quantity'), price: r['unit price'], upc: r['units per carton'], cartons: r['cartons'], unitWeight: pick(r, 'unit weight kg', 'unit weight') },
      sku: clean(r['sku']), desc: clean(r['description']), hs: (r['hs code'] === null || r['hs code'] === undefined || String(r['hs code']).trim() === '') ? null : r['hs code'],
      qty: num(pick(r, 'quantity units', 'quantity')), price: num(r['unit price']), upc: num(r['units per carton']), cartons: num(r['cartons']),
      unitWeight: num(pick(r, 'unit weight kg', 'unit weight')), coo: isBlankish(r['country of origin']) ? null : clean(r['country of origin'])
    };
    if (b) b.items.push(item); else (orphan[id] = orphan[id] || []).push(r._row);
  });
  Object.keys(orphan).forEach(id => warnings.push('Items listed for “' + id + '” (Items sheet, row' + (orphan[id].length === 1 ? ' ' : 's ') + orphan[id].join(', ') + ') have no matching booking, so they were ignored.'));
  return { bookings, warnings };
}
function parseWorkbook(XLSX, data) {
  let wb;
  try { wb = XLSX.read(data, { type: 'array' }); } catch (e) { return { error: 'That file couldn’t be read as a spreadsheet. Please upload an .xlsx or .ods file.' }; }
  const all = wb.SheetNames || [];
  const norm = n => String(n).trim().toLowerCase();
  const ignore = /carrier|rule|allowed|field|gloss/i;       // reference sheets are never used: the app has its own rate card and rules
  const find = (exact, fuzzy) => all.find(n => exact.indexOf(norm(n)) >= 0) || all.find(n => !ignore.test(n) && fuzzy.test(n));
  let bn = find(['bookings', 'booking'], /booking/i), inn = find(['items', 'item'], /item/i);
  const rest = all.filter(n => !ignore.test(n));
  if (!bn && !inn && rest.length >= 2) { bn = rest[0]; inn = rest[1]; }       // sheets with other names: first two
  const missing = [!bn ? 'Bookings' : '', !inn ? 'Items' : ''].filter(Boolean);
  if (missing.length || bn === inn) {
    return { error: 'I couldn’t find a sheet called ' + (missing.join(' or ') || 'Items') + '. This file has: ' + (all.length ? all.map(n => '“' + String(n).trim() + '”').join(', ') : 'no sheets') + '. I need one sheet named Bookings and one named Items.' };
  }
  const grab = n => {
    const ws = wb.Sheets[n];
    const off = ws && ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.r : 0;
    return { rows: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true }), off };
  };
  const B = grab(bn), I = grab(inn);
  return bookingsFromTables(B.rows, I.rows, { bookingRowOffset: B.off, itemRowOffset: I.off });
}

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
  rankBy, recommend, evaluate, summarise, hazardOf, hsInfo, isBlankish,
  bookingsFromTables, parseWorkbook, sampleTables
};
