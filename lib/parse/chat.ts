// @ts-nocheck
// Ported unchanged from the tested prototype (chat.js). Built-in parser plus AI merge helpers.
/* Preflight chat: slot-filling conversation with a built-in parser (works with no AI),
   plus helpers to merge an AI-extracted booking when Claude is available. */
import * as PF from '../engine/engine';
import { parseDateText, DATE_CUE } from './dates';
import { checkScope } from './scope';
import { rejectedClaims, checkNumber, checkHs, checkReadyDate, chatRejection, chatHsRejection, parseNumeric, FIELDS } from '../validate';
const { ORIGINS, DESTS, COUNTRIES, PRIORITIES, gbp, nf, dmy, niceDate } = PF;

const WORD = "(?:(?!(?:at|@|for|in|with|packed|priced|each|from|made|to|and|per|every|are|is|of|on|by|please)\\b)[A-Za-z][A-Za-z0-9'\\-]*)";
const WORDS = '(' + WORD + '(?:\\s+' + WORD + '){0,5})';
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const N = s => parseFloat(String(s).replace(/,/g, ''));

function blankItem() { return { sku: null, desc: null, hs: null, qty: null, price: null, upc: null, cartons: null, unitWeight: null, coo: null, skipHS: false, skipCOO: false }; }
function newChat() {
  return {
    b: { id: 'BK-001', seller: null, originCity: null, originCountry: 'United Kingdom', destCity: null, destCountry: null, destType: null, readyDate: null, priority: null, pallets: null, cartons: null, declaredValue: null, currency: 'GBP', grossWeight: null, appointment: null, items: [] },
    asked: null, wantMore: false, itemsDone: false, started: false
  };
}
const cloneChat = c => JSON.parse(JSON.stringify(c));

/* ---------- value parsers ---------- */
function yesNo(t) {
  const s = t.toLowerCase();
  if (/\b(no|nope|nah|not|n't|haven|without|none)\b/.test(s)) return 'No';
  if (/\b(yes|yeah|yep|yup|sure|booked|confirmed|done|have|got|ok|okay)\b/.test(s)) return 'Yes';
  return undefined;
}
function priorityOf(t, strongOnly) {
  const s = t.toLowerCase();
  const defs = [
    ['Most reliable', /most\s+reliable|reliab|on[\s-]?time|dependab|safest/, /most\s+reliable/],
    ['Cheapest', /cheapest|cheap|lowest\s+(?:cost|price)|budget|economical|least\s+expensive/, /cheapest|lowest\s+(?:cost|price)/],
    ['Fastest', /fastest|quickest|fast|quick|asap|urgent|express|speed|soonest/, /fastest|quickest|asap/],
    ['Balanced', /balanced|no\s+(?:strong\s+)?preference|don'?t\s+mind|best\s+trade[\s-]?off|mix|whatever|either/, /balanced/]
  ];
  let best = null;
  defs.forEach(([name, weak, strong]) => { const m = (strongOnly ? strong : weak).exec(s); if (m && (best === null || m.index < best.i)) best = { name, i: m.index }; });
  return best ? best.name : undefined;
}
function destTypeOf(t) {
  if (/\b(warehouse|fulfil+ment\s+(?:centre|center)|distribution\s+(?:centre|center)|fba|depot|logistics\s+(?:centre|center))\b/i.test(t)) return 'Warehouse';
  if (/\b(business\s+address|shop|store|office|retail(?:er)?|customer'?s?\s+(?:site|address|premises)|factory|showroom|trade\s+counter|business)\b/i.test(t)) return 'Business address';
  return undefined;
}
function cooOf(t) {
  const s = ' ' + t.toLowerCase().replace(/[.]/g, '') + ' ';
  if (/\b(united kingdom|uk|britain|british|england|scotland|wales)\b/.test(s)) return 'United Kingdom';
  if (/\b(china|prc|chinese)\b/.test(s)) return 'China';
  if (/\b(india|indian)\b/.test(s)) return 'India';
  if (/\b(vietnam|viet nam)\b/.test(s)) return 'Vietnam';
  if (/\b(turkey|turkiye|türkiye|turkish)\b/.test(s)) return 'Turkey';
  if (/\b(germany|german)\b/.test(s)) return 'Germany';
  return undefined;
}
const SKIP = /^\s*(skip|unknown|n\/?a|none|not sure|no idea|later|don'?t know|do not know|dunno|i don'?t know.*|not known|no)\s*[.!]?\s*$/i;
function dateOf(t, today) { return parseDateText(t, today).iso; }
function cityOf(t) {
  const out = {};
  ORIGINS.forEach(c => { if (new RegExp('\\b' + c + '\\b', 'i').test(t)) out.originCity = c; });
  Object.keys(DESTS).forEach(c => { if (new RegExp('\\b' + c + '\\b', 'i').test(t)) { out.destCity = c; out.destCountry = DESTS[c]; } });
  if (!out.destCity) {
    const m = /\b(germany|france|netherlands|holland|the\s+netherlands)\b/i.exec(t);
    if (m) out.destCountry = /germany/i.test(m[1]) ? 'Germany' : /france/i.test(m[1]) ? 'France' : 'Netherlands';
  }
  return out;
}
function firstNumber(t) { const m = /(-?\d[\d,]*(?:\.\d+)?|-?\.\d+)/.exec(t.replace(/£/g, '')); return m ? N(m[1]) : undefined; }

/* Parse one named field from a text. Returns a typed value or undefined. */
function parseField(field, text, today) {
  const t = text.trim();
  switch (field) {
    case 'seller': { const s = t.replace(/^(?:it'?s|its|we(?:'| a)re|i(?:'| a)m|this is|my (?:company|business|name|brand) is|(?:company|business|seller)(?: name)? is|called|named)\s+/i, '').replace(/[.!]+$/, '').trim(); return s && s.length <= 60 ? s : undefined; }
    case 'item.unitWeight': { const v = firstNumber(t); return v !== undefined && /\d\s*(?:g|gram|grams|gr)\b/i.test(t) && !/kg|kilo/i.test(t) ? v / 1000 : v; }
    case 'pallets': case 'cartons': case 'grossWeight': case 'declaredValue': case 'item.price': case 'item.qty': case 'item.upc': case 'item.cartons': return firstNumber(t);
    case 'readyDate': return dateOf(t, today);
    case 'priority': return priorityOf(t);
    case 'appointment': return yesNo(t);
    case 'destType': return destTypeOf(t);
    case 'destCity': { const c = cityOf(t); return c.destCity; }
    case 'originCity': { const c = cityOf(t); return c.originCity; }
    case 'item.hs': { const m = /(\d[\d.\s]{0,13}\d|\d)/.exec(t); return m ? m[1].replace(/[\s.]/g, '') : undefined; }
    case 'item.coo': return cooOf(t);
    case 'item.desc': return t.replace(/[.!]+$/, '') || undefined;
    default: return undefined;
  }
}
const ALIASES = [
  [/^(?:number of |no\.? of )?pallets?$/, 'pallets'],
  [/^(?:total |booking )?(?:cartons?|boxes)$|^number of (?:cartons|boxes)$/, 'cartons'],
  [/^(?:total |gross )*weight(?: \(?kg\)?)?$|^gross$/, 'grossWeight'],
  [/^(?:total )?(?:declared )?value$/, 'declaredValue'],
  [/^(?:ready(?: to ship)? |collection |pick ?up |shipping |ship )?date$/, 'readyDate'],
  [/^(?:seller )?priority$/, 'priority'],
  [/^(?:delivery )?appointment(?: booked)?$/, 'appointment'],
  [/^(?:destination|dest|delivery)(?: city)?$/, 'destCity'],
  [/^(?:origin|collection|pick ?up|from)(?: city)?$/, 'originCity'],
  [/^(?:destination|delivery) type$/, 'destType'],
  [/^(?:seller|business|company)(?: name)?$/, 'seller'],
  [/^(?:unit )?price(?: per unit)?$|^unit cost$/, 'item.price'],
  [/^(?:quantity|qty|units|number of units)$/, 'item.qty'],
  [/^units? (?:per|\/) ?carton$|^pack size$|^carton size$/, 'item.upc'],
  [/^(?:item|product) cartons?$/, 'item.cartons'],
  [/^(?:unit|item|product) weight$/, 'item.unitWeight'],
  [/^(?:hs|tariff|commodity)(?: code)?$/, 'item.hs'],
  [/^(?:country of origin|origin country|made in)$/, 'item.coo'],
  [/^(?:description|product|item)$/, 'item.desc']
];
const aliasOf = s => { const k = s.toLowerCase().replace(/^(?:the|my|our)\s+/, '').trim(); for (const [re, f] of ALIASES) if (re.test(k)) return f; return null; };

/* ---------- extraction from free text ---------- */
function extractAll(text, c, askKey, today) {
  const ex = { b: {}, item: {}, rel: [], sets: [], flags: {}, itemTarget: null, carrier: null, intent: null };
  const orig = String(text).replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, ' ').trim();
  if (/^\s*(start over|start a new booking|new booking|reset|clear (?:it|all|everything)|begin again)\b/i.test(orig)) { ex.intent = 'reset'; return ex; }
  if (/\b(confirm(?: it| the booking| booking)?|book it|go ahead|looks good|proceed|that'?s right, book|lock it in)\b/i.test(orig) && c.started && !askKey) { ex.intent = 'confirm'; }

  const cm = /\b(?:use|switch to|choose|pick|go with|select|change (?:the )?carrier to|take)\s+carrier\s+([abc])\b/i.exec(orig);
  if (cm) { ex.carrier = 'Carrier ' + cm[1].toUpperCase(); return ex; }

  // explicit "change X to Y"
  const sm = /\b(?:change|set|update|amend|correct|edit|switch|adjust|make)\s+(?:the\s+|my\s+|our\s+)?([a-z][a-z \/\-()]{1,32}?)\s+(?:from\s+[^,]+?\s+)?(?:to|as|=)\s+(.+?)\s*$/i.exec(orig);
  if (sm) {
    const f = aliasOf(sm[1]);
    if (f) {
      let v = parseField(f, sm[2], today);
      if (v !== undefined) { ex.sets.push({ field: f, value: v }); ex.itemTarget = itemFromText(orig, c); return ex; }
    }
  }
  if (orig.split(/\s+/).length <= 9) {
    const im = /^(?:actually,?\s+|no,?\s+|sorry,?\s+)?(?:the\s+|my\s+|our\s+)?([a-z][a-z \/\-]{1,30}?)\s+(?:is|are|should\s+be|was|will\s+be)\s+(?:actually\s+|now\s+)?(.+?)\s*[.!]?$/i.exec(orig);
    if (im) {
      const f = aliasOf(im[1]);
      if (f) { const v = parseField(f, im[2], today); if (v !== undefined) { ex.sets.push({ field: f, value: v }); ex.itemTarget = itemFromText(orig, c); return ex; } }
    }
  }
  const mk = /\bmake\s+(?:it|that|this)\s+(\d+)\s+(pallets?|cartons?|boxes)\b/i.exec(orig);
  if (mk) { ex.sets.push({ field: /pallet/i.test(mk[2]) ? 'pallets' : 'cartons', value: +mk[1] }); return finish(ex); }

  // relative changes: add / remove pallets or cartons
  const amount = w => w ? (NUMW[w.toLowerCase()] || +w || 1) : 1;
  let rm = /\b(?:add(?:ing)?|plus|include)\s+(?:(\d+|a|an|one|two|three|four|five)\s+)?(?:more\s+|extra\s+|additional\s+)?(pallets?|cartons?|boxes)\b/i.exec(orig)
    || /\b(\d+|a|an|one|two|three|four|five)\s+(?:more|extra|additional)\s+(pallets?|cartons?|boxes)\b/i.exec(orig)
    || /\b(?:another)\s+()(pallet|carton|box)\b/i.exec(orig);
  if (rm && !/\bper\s+(?:pallet|carton)/i.test(orig)) { ex.rel.push({ field: /pallet/i.test(rm[2]) ? 'pallets' : 'cartons', delta: amount(rm[1]) }); return finish(ex); }
  rm = /\b(?:remove|drop|take\s+off|take\s+away|less|minus|one\s+fewer|fewer)\s+(?:(\d+|a|an|one|two|three)\s+)?(pallets?|cartons?|boxes)\b/i.exec(orig);
  if (rm) { ex.rel.push({ field: /pallet/i.test(rm[2]) ? 'pallets' : 'cartons', delta: -amount(rm[1]) }); return finish(ex); }

  let t = ' ' + orig + ' ';
  const take = (re, g) => { const m = re.exec(t); if (!m) return null; t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length); return m[g == null ? 1 : g]; };
  t = t.replace(/\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?=(?:more\s+|extra\s+)?(?:euro\s+)?(?:pallets?|cartons?|boxes)\b)/gi, m => NUMW[m.trim().toLowerCase()] + ' ');

  // flags
  if (/\b(?:only|just|single|one)\s+(?:one\s+)?(?:product|sku|item|type|line)\b|\bthat'?s\s+(?:all|everything|it)\b|\bnothing\s+else\b/i.test(orig)) ex.flags.itemsDone = true;
  if (/(?:don'?t|do\s+not|dont)\s+(?:know|have)\s+(?:the\s+)?(?:hs|tariff|commodity)|no\s+hs\s+code|hs(?:\s+code)?\s*(?:is\s+)?(?:unknown|n\/?a|not\s+known)/i.test(orig)) ex.flags.skipHS = true;
  if (/(?:don'?t|do\s+not|dont)\s+know\s+(?:the\s+)?(?:country\s+of\s+origin|where\s+(?:it|they)\s+(?:is|are|was|were)\s+made)|origin\s+(?:is\s+)?unknown/i.test(orig)) ex.flags.skipCOO = true;

  // country of origin (explicit phrases only)
  const coo = take(/(?:made\s+in|manufactured\s+in|produced\s+in|country\s+of\s+origin\s*(?:is|:)?|origin\s*(?:is|:)|sourced\s+from|imported\s+from)\s+((?:the\s+)?(?:united\s+kingdom|uk|u\.k\.|britain|china|india|vietnam|turkey|germany))\b/i);
  if (coo) ex.item.coo = cooOf(coo);

  // seller
  let sellerM = /(?:^|[\s,.;])(?:[Ii]'?m|[Ii]\s+am|[Ww]e'?re|[Ww]e\s+are|[Tt]his\s+is|[Ii]t'?s)\s+(?:from\s+|with\s+|at\s+)?([A-Z][A-Za-z0-9&'\-]*(?:\s+(?!I\b|I')[A-Z&][A-Za-z0-9&'\-]*){0,4})/.exec(orig);
  if (!sellerM) sellerM = /(?:seller|company|business|brand|shop)(?:\s+name)?\s*(?:is|:|=|called|named)\s*([A-Z0-9][A-Za-z0-9&'.\- ]{1,40}?)(?=\s*(?:[,.;]|\sand\b|\sto\b|\sfrom\b|$))/i.exec(orig);
  if (!sellerM) sellerM = /\b(?:from|for)\s+([A-Z][A-Za-z0-9&'\-]*(?:\s+(?!I\b|I')[A-Z&][A-Za-z0-9&'\-]*){0,3}\s+(?:Ltd|Limited|Goods|Co|Company|Trading|Supplies|Exports|Imports|LLP|plc|Foods|Home|Textiles|Hardware|Designs|Studio))\b/.exec(orig);
  if (sellerM && !ORIGINS.concat(Object.keys(DESTS)).some(x => x.toLowerCase() === sellerM[1].toLowerCase()) && !/^(Sending|Shipping|Looking|Booking)/i.test(sellerM[1])) ex.b.seller = sellerM[1].trim().replace(/\s+(?:and|to|from|in)$/i, '');

  // cities and countries
  Object.assign(ex.b, cityOf(t));

  // destination type, appointment
  const dt = destTypeOf(t); if (dt) ex.b.destType = dt;
  const apNo = /\b(?:no|without|haven'?t\s+(?:got|booked)|not\s+(?:yet\s+)?booked|don'?t\s+have|yet\s+to\s+book|still\s+need\s+to\s+book)\s+(?:a\s+|an\s+|the\s+)?(?:delivery\s+)?(?:appointment|slot)|(?:appointment|slot)\s+(?:is\s+|has\s+been\s+|hasn'?t\s+been\s+)?(?:not\s+(?:yet\s+)?booked|not\s+confirmed|missing)/i.test(orig);
  const apYes = /(?:appointment|slot)\s+(?:is\s+|has\s+been\s+|'s\s+)?(?:already\s+)?(?:booked|confirmed|in\s+place|secured|sorted)|(?:booked|confirmed|have|got|has)\s+(?:a\s+|an\s+|the\s+)?(?:delivery\s+)?(?:appointment|slot)/i.test(orig);
  if (apNo) ex.b.appointment = 'No'; else if (apYes) ex.b.appointment = 'Yes';

  // priority
  const strongOnly = !(askKey === 'priority' || c.b.priority == null || /priorit|prefer|important|care about|looking for|go with|choose|opt for/i.test(orig));
  const pr = priorityOf(orig, strongOnly); if (pr) ex.b.priority = pr;

  // date
  const dtx = parseDateText(orig, today).iso;
  if (dtx && (askKey === 'readyDate' || askKey === 'basics' || DATE_CUE.test(orig))) {
    ex.b.readyDate = dtx;
    take(/\b\d{1,2}[-\/.]\d{1,2}[-\/.]\d{4}\b/);
    take(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s*\d{4})?\b/i);
    take(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?\b/i);
  }

  // money
  let v = take(/(?:declared(?:\s+(?:customs\s+)?value)?|total\s+(?:declared\s+)?value|(?:goods\s+)?(?:worth|valued\s+at|value\s+of|value\s+is|value\s*:|valued))\s*(?:is|of|at|:|=|about|around|approx(?:imately)?)?\s*£?\s*(\d[\d,]*(?:\.\d+)?)/i)
    || take(/£\s*(\d[\d,]*(?:\.\d+)?)\s*(?:declared|in\s+total|total|altogether)/i);
  if (v) ex.b.declaredValue = N(v);
  v = take(/£\s*([\d,]*\.?\d+)\s*(?:each|a\s+(?:unit|piece|item|one)|per\s+(?:unit|piece|item|pc|\w+))/i)
    || take(/(?:at|@|priced\s+at|unit\s+price(?:\s+(?:is|of))?|price\s+(?:is|of)|costs?)\s*£\s*([\d,]*\.?\d+)/i)
    || take(/([\d,]*\.?\d+)\s*(?:pounds|quid|gbp)\s*(?:each|per\s+\w+)/i);
  if (v) ex.item.price = N(v);

  // weights
  v = take(/([\d.]+)\s*(?:kg|kgs|kilos?|kilograms?)\s*(?:each|per\s+\w+|a\s+(?:unit|piece|item)|apiece)/i)
    || take(/(?:each|per\s+(?:unit|piece|item))\s+(?:weighs|weighing|is|at)?\s*([\d.]+)\s*(?:kg|kgs|kilos?)/i)
    || take(/unit\s+weight\s*(?:is|of|:|=)?\s*([\d.]+)/i)
    || take(/(?:weighs|weighing|weight\s+of)\s+([\d.]+)\s*(?:kg|kgs|kilos?)\s+each/i);
  if (v) ex.item.unitWeight = N(v);
  v = take(/(?:total\s+)?(?:gross\s+)?weigh(?:t|s|ing)?\s*(?:is|of|about|around|approx(?:imately)?|:|=|comes\s+to)?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:kg|kgs|kilos?|kilograms?)/i)
    || take(/(\d[\d,]*(?:\.\d+)?)\s*(?:kg|kgs|kilos?|kilograms?)\s*(?:gross|in\s+total|total|altogether|all\s+in|overall)/i)
    || take(/(\d[\d,]*(?:\.\d+)?)\s*(?:kg|kgs|kilos?|kilograms?)\b/i);
  if (v) ex.b.grossWeight = N(v);

  // description hint "N cartons of X"
  let ofDesc = null;
  const od = new RegExp('(?:cartons?|boxes|cases|pallets?)\\s+of\\s+' + WORDS, 'i').exec(t);
  if (od) ofDesc = od[1];

  // pack sizes, pallets, cartons
  v = take(/(\d[\d,]*)\s*(?:units?|pcs|pieces?|items?)?\s*(?:per|a|in\s+(?:each|every|a|one))\s*(?:carton|box|case)s?\b/i)
    || take(/(?:cartons?|boxes|cases)\s+of\s+(\d[\d,]*)\b/i)
    || take(/(\d[\d,]*)\s*(?:to\s+a|\/)\s*(?:carton|box|case)\b/i);
  if (v) ex.item.upc = N(v);
  v = take(/(\d[\d,]*)\s*(?:euro\s+|standard\s+)?pallets?\b/i);
  if (v) ex.b.pallets = N(v);
  v = take(/(\d[\d,]*)\s*(?:cartons?|boxes|cases)\b/i);
  if (v) ex.b.cartons = N(v);

  // HS code
  v = take(/(?:hs(?:\s*code)?|tariff(?:\s*code)?|commodity\s*code)\s*(?:is|of|:|=|#)?\s*(\d[\d.\s]{3,13}\d)/i);
  if (v) ex.item.hs = v.replace(/[\s.]/g, '');

  // product and quantity
  const wantItem = askKey === 'item.product' || !(c.b.items.length && c.b.items.every(i => i.desc)) || c.wantMore || /\b(also|another|plus|additionally)\b/i.test(orig);
  if (wantItem) {
    const q1 = take(/(?:quantity|qty)\s*(?:is|of|:|=)?\s*(\d[\d,]*)/i);
    if (q1) ex.item.qty = N(q1);
    const re = new RegExp("(?:^|[^\\d.£\\-/])(\\d[\\d,]{0,8})\\s*(?:x\\s+|units?\\s+of\\s+|pcs\\s+of\\s+|pieces?\\s+of\\s+|of\\s+)?" + WORDS, 'i');
    const m = re.exec(t);
    if (m && !/^(?:units?|pcs|pieces?|items?|gbp|pounds|per|kg|kgs)$/i.test(m[2].split(/\s+/)[0])) {
      if (ex.item.qty == null) ex.item.qty = N(m[1]);
      ex.item.desc = m[2].trim();
      t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length);
    } else if (m && ex.item.qty == null && /^(?:units?|pcs|pieces?|items?)$/i.test(m[2].split(/\s+/)[0])) { ex.item.qty = N(m[1]); }
    if (!ex.item.desc && ofDesc) ex.item.desc = ofDesc;
    if (!ex.item.desc) {
      const sd = new RegExp('(?:sending|shipping|exporting|moving|selling)\\s+(?:some\\s+|our\\s+|a\\s+load\\s+of\\s+)?' + WORDS, 'i').exec(orig);
      if (sd && !/^(?:a|the|my|our)?\s*(?:shipment|booking|pallets?|cartons?|order|freight|delivery|load|consignment|goods|stock|products?)\b/i.test(sd[1])) ex.item.desc = sd[1].trim();
    }
    if (!ex.item.desc && askKey === 'item.product') {
      const bare = orig.replace(/[\d,.£]+/g, ' ').replace(/\s+/g, ' ').replace(/^(?:it'?s|its|they'?re|we(?:'| a)re (?:sending|shipping)|i(?:'| a)m (?:sending|shipping))\s+/i, '').trim();
      if (bare && bare.split(' ').length <= 8 && !/^(?:yes|no|ok)$/i.test(bare)) ex.item.desc = bare;
    }
  }
  // A SKU is only ever one the seller typed. "no SKU yet" and similar are not SKUs.
  const sk = /\b(?:sku|item\s*code|product\s*code|part\s*(?:no\.?|number))\s*(?:is|=|:|#)?\s*"?([A-Za-z0-9][A-Za-z0-9._\/-]*)"?/i.exec(orig);
  if (sk && !/^(yet|none|na|n|unknown|tbc|tbd|not|no|nothing|skip|dont|don|number|code|is|a|the|for|and)$/i.test(sk[1])) ex.item.sku = sk[1];
  Object.keys(ex.item).forEach(k => { if (ex.item[k] == null || (typeof ex.item[k] === 'number' && isNaN(ex.item[k]))) delete ex.item[k]; });
  return finish(ex);
}
function finish(ex) { return ex; }
function itemFromText(text, c) {
  const s = text.toLowerCase();
  for (let i = 0; i < c.b.items.length; i++) {
    const it = c.b.items[i];
    if ((it.sku && s.indexOf(it.sku.toLowerCase()) >= 0) || (it.desc && s.indexOf(it.desc.toLowerCase()) >= 0)) return i;
  }
  return null;
}

/* ---------- flow ---------- */
function itemNeeds(it) {
  if (!it.desc || it.qty == null) return 'item.product';
  if (it.price == null) return 'item.price';
  if (it.upc == null) return 'item.upc';
  if (it.cartons == null) return 'item.cartons';
  if (it.unitWeight == null) return 'item.weight';
  if (it.hs == null && !it.skipHS) return 'item.hs';
  if (!it.coo && !it.skipCOO) return 'item.coo';
  return null;
}
const itemName = it => (it.desc ? 'the ' + it.desc.toLowerCase() : 'this product');
function totalsMissing(b) {
  const m = [];
  if (b.pallets == null) m.push('pallets'); if (b.cartons == null) m.push('cartons'); if (b.grossWeight == null) m.push('grossWeight'); if (b.declaredValue == null) m.push('declaredValue');
  return m;
}
function sums(b) {
  const it = b.items;
  return { val: it.reduce((s, i) => s + (i.qty || 0) * (i.price || 0), 0), cartons: it.reduce((s, i) => s + (i.cartons || 0), 0), wt: it.reduce((s, i) => s + (i.qty || 0) * (i.unitWeight || 0), 0) };
}
function autoFill(c, notes) {
  const b = c.b;
  if (b.destType === 'Business address' && b.appointment == null) b.appointment = 'No';
  if (b.items.length) {
    const it = b.items[b.items.length - 1];
    if (it.cartons == null && it.upc != null && it.qty != null) {
      if (b.items.length === 1 && b.cartons != null) { it.cartons = b.cartons; notes.push('I used your ' + b.cartons + ' total cartons for the ' + (it.desc || 'product').toLowerCase() + ', as it’s the only product.'); }
      else if (it.upc > 0 && it.qty % it.upc === 0) { it.cartons = it.qty / it.upc; notes.push(it.qty + ' units at ' + it.upc + ' per carton is ' + it.cartons + ' cartons, so I filled that in.'); }
    }
  }
}
function nextAsk(c) {
  const b = c.b;
  // Several booking details missing: ask for all of them in one message instead of one per turn.
  const basics = [];
  if (!b.seller) basics.push('seller');
  if (!b.originCity || !b.destCity) basics.push('route');
  if (!b.destType) basics.push('destType');
  if (b.destType === 'Warehouse' && b.appointment == null) basics.push('appointment');
  if (!b.readyDate) basics.push('readyDate');
  if (!b.priority) basics.push('priority');
  if (basics.length >= 2) {
    const label = {
      seller: 'your business name',
      route: !b.originCity && !b.destCity ? 'where it’s collected from and where it’s going' : !b.originCity ? 'the UK city it’s collected from' : 'the city it’s going to' + (b.destCountry ? ' in ' + b.destCountry : ''),
      destType: 'whether it’s going to a warehouse or a business address',
      appointment: 'whether a delivery appointment is booked at the warehouse',
      readyDate: 'the date it’s ready for collection (DD-MM-YYYY)',
      priority: 'what matters most: cheapest, fastest, most reliable or balanced'
    };
    const parts = basics.map(k => label[k]);
    const list = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
    return { key: 'basics', missing: basics, q: 'I still need ' + list + '. You can answer in one message, for example “Acme Ltd, Leeds to Paris, warehouse, appointment booked, ready 5 Nov, cheapest”.', hint: 'I collect from London, Manchester, Birmingham or Leeds, and deliver to Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam or Rotterdam. ' };
  }
  if (!b.seller) return { key: 'seller', q: 'What’s your business name?' };
  if (!b.originCity && !b.destCity) return { key: 'route', hint: 'I can only book from London, Manchester, Birmingham or Leeds to Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam or Rotterdam. ', q: 'Where is it collected from, and where is it going? I can book from London, Manchester, Birmingham or Leeds to Germany, France or the Netherlands.' + (b.destCountry ? ' (I have the destination country as ' + b.destCountry + '.)' : '') };
  if (!b.originCity) return { key: 'originCity', hint: 'I can only collect from London, Manchester, Birmingham or Leeds. ', q: 'Which UK city is it collected from? London, Manchester, Birmingham or Leeds.', chips: ORIGINS };
  if (!b.destCity) {
    const opts = b.destCountry ? Object.keys(DESTS).filter(k => DESTS[k] === b.destCountry) : Object.keys(DESTS);
    return { key: 'destCity', hint: 'I can only book to Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam or Rotterdam. ', q: 'Which city is it going to' + (b.destCountry ? ' in ' + b.destCountry : '') + '? ' + opts.join(', ') + '.', chips: opts };
  }
  if (!b.destType) return { key: 'destType', q: 'Is it going to a warehouse or a business address?', chips: ['Warehouse', 'Business address'] };
  if (b.destType === 'Warehouse' && b.appointment == null) return { key: 'appointment', q: 'Has a delivery appointment been booked at the warehouse?', chips: ['Yes', 'No'] };
  if (!b.readyDate) return { key: 'readyDate', q: 'What date will the goods be packed and ready for collection? (DD-MM-YYYY)', hint: 'Try a date like 12-11-2026 or “5 Nov”. ' };
  if (!b.priority) return { key: 'priority', q: 'What matters most for this shipment?', chips: PRIORITIES };
  // items
  if (!b.items.length || c.wantMore) { b.items.push(blankItem()); c.wantMore = false; }
  for (let i = 0; i < b.items.length; i++) {
    const it = b.items[i], need = itemNeeds(it);
    if (need) {
      const first = b.items.length === 1;
      if (need === 'item.product') {
        if (it.desc && it.qty == null) return { key: need, itemIdx: i, q: 'How many units of ' + itemName(it) + ' are you sending?' };
        if (!it.desc && it.qty != null) return { key: need, itemIdx: i, q: 'What are the ' + it.qty.toLocaleString('en-GB') + ' units? A short description is fine.' };
        return { key: need, itemIdx: i, q: first ? 'What are you shipping, and how many units? For example “1,080 ceramic mugs”.' : 'What’s the next product, and how many units?' };
      }
      // Three or more product details missing: ask for them together.
      const lack = [];
      if (it.price == null) lack.push('price per unit (£)');
      if (it.upc == null) lack.push('units per carton');
      if (it.unitWeight == null) lack.push('weight of one unit (kg)');
      if (it.hs == null && !it.skipHS) lack.push('HS code');
      if (!it.coo && !it.skipCOO) lack.push('country of origin');
      if (lack.length >= 3 && it.desc && it.qty != null) {
        const list = lack.slice(0, -1).join(', ') + ' and ' + lack[lack.length - 1];
        return { key: 'item.details', itemIdx: i, q: 'For ' + itemName(it) + ' I still need the ' + list + '. For example “£5 each, 12 per carton, 0.5 kg each, HS 691200, made in UK”.', hint: 'Give each with its unit, like “£5 each”, “12 per carton”, “0.5 kg each”. ', chips: ['I don’t know the HS code or country'] };
      }
      if (need === 'item.price') return { key: need, itemIdx: i, q: 'What’s the price per unit of ' + itemName(it) + ', in £?' };
      if (need === 'item.upc') return { key: need, itemIdx: i, q: 'How many units go in each carton?' };
      if (need === 'item.cartons') return { key: need, itemIdx: i, q: 'How many cartons of ' + itemName(it) + ' are there?' };
      if (need === 'item.weight') return { key: need, itemIdx: i, q: 'How much does one unit weigh, in kg?' };
      if (need === 'item.hs') return { key: need, itemIdx: i, q: 'What’s the HS code for ' + itemName(it) + '? Customs needs at least 6 digits.', chips: ['I don’t know the HS code'] };
      if (need === 'item.coo') return { key: need, itemIdx: i, q: 'Which country were these made in? That’s the country of origin for ' + itemName(it) + '.', chips: COUNTRIES.concat(['Not sure']) };
    }
  }
  if (!c.itemsDone) return { key: 'item.more', q: 'Is that everything in the shipment, or is there another product?', chips: ['That’s everything', 'Add another product'] };
  const miss = totalsMissing(b), s = sums(b);
  if (miss.length) {
    const parts = [];
    if (miss.indexOf('pallets') >= 0) parts.push('the number of pallets');
    if (miss.indexOf('cartons') >= 0) parts.push('the total number of cartons' + (s.cartons ? ' (your products add up to ' + s.cartons + ')' : ''));
    if (miss.indexOf('grossWeight') >= 0) parts.push('the total gross weight in kg, including cartons and pallets' + (s.wt ? ' (the products alone weigh ' + nf(s.wt) + ' kg)' : ''));
    if (miss.indexOf('declaredValue') >= 0) parts.push('the total declared value in £' + (s.val ? ' (your products add up to ' + gbp(s.val) + ')' : ''));
    const list = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
    return { key: 'totals', missing: miss, q: 'Almost there. I just need ' + list + '.', hint: 'Add a unit so I know which is which, for example “70 cartons”, “340 kg” or “£6,200”. ' };
  }
  return null;
}

/* ---------- applying changes ---------- */
const LABEL = { seller: 'business name', originCity: 'collection city', destCity: 'destination', destType: 'destination type', readyDate: 'ready date', priority: 'priority', pallets: 'pallets', cartons: 'cartons', grossWeight: 'gross weight', declaredValue: 'declared value', appointment: 'delivery appointment', carrier: 'carrier',
  desc: 'description', qty: 'quantity', price: 'unit price', upc: 'units per carton', unitWeight: 'unit weight', hs: 'HS code', coo: 'country of origin', cartonsItem: 'item cartons' };
function show(field, v) {
  if (v == null) return '—';
  if (field === 'readyDate') return dmy(v);
  if (field === 'declaredValue' || field === 'price') return gbp(v);
  if (field === 'grossWeight' || field === 'unitWeight') return nf(v, 2) + ' kg';
  return String(v);
}
function setB(c, log, field, value) {
  if (value === undefined || value === null || (typeof value === 'number' && isNaN(value))) return;
  const old = c.b[field];
  if (old === value) return;
  if (old != null) log.changed.push({ field, label: LABEL[field] || field, from: show(field, old), to: show(field, value), item: null }); else log.set.push({ field, label: LABEL[field] || field, to: show(field, value), item: null });
  c.b[field] = value;
  if (field === 'destCity' && DESTS[value]) c.b.destCountry = DESTS[value];
}
function setI(c, log, idx, field, value) {
  const it = c.b.items[idx];
  if (!it || value === undefined || value === null || (typeof value === 'number' && isNaN(value))) return;
  const old = it[field];
  if (old === value) return;
  const lab = LABEL[field === 'cartons' ? 'cartonsItem' : field] || field, who = (field === 'desc' ? value : it.desc) || it.sku || ('product ' + (idx + 1));
  if (old != null) log.changed.push({ field, label: lab, from: show(field, old), to: show(field, value), item: who }); else log.set.push({ field, label: lab, to: show(field, value), item: who });
  it[field] = value;
  if (field === 'hs') it.skipHS = false;
  if (field === 'coo') it.skipCOO = false;
}
function currentItemIdx(c) { return c.b.items.length - 1; }
function applyEx(c, ex, log) {
  const b = c.b;
  Object.keys(ex.b).forEach(k => setB(c, log, k, ex.b[k]));
  ex.rel.forEach(r => {
    const old = b[r.field];
    if (old == null) { setB(c, log, r.field, Math.max(0, r.delta)); return; }
    setB(c, log, r.field, Math.max(0, old + r.delta));
  });
  const itemKeyMap = { 'item.price': 'price', 'item.qty': 'qty', 'item.upc': 'upc', 'item.cartons': 'cartons', 'item.unitWeight': 'unitWeight', 'item.hs': 'hs', 'item.coo': 'coo', 'item.desc': 'desc' };
  ex.sets.forEach(s => {
    if (itemKeyMap[s.field]) {
      const idx = ex.itemTarget != null ? ex.itemTarget : currentItemIdx(c);
      if (idx >= 0) setI(c, log, idx, itemKeyMap[s.field], s.value);
    } else setB(c, log, s.field, s.value);
  });
  if (ex.carrier) { if (b._carrier !== ex.carrier) { log.set.push({ field: 'carrier', label: 'carrier', to: ex.carrier, item: null }); b._carrier = ex.carrier; } }
  const keys = Object.keys(ex.item);
  if (keys.length) {
    let idx = ex.itemTarget != null ? ex.itemTarget : null;
    if (idx == null && ex.item.desc) { const m = b.items.findIndex(i => i.desc && i.desc.toLowerCase() === ex.item.desc.toLowerCase()); if (m >= 0) idx = m; }
    const last = b.items[b.items.length - 1];
    if (idx == null) {
      const lastDone = last && !itemNeeds(last);
      const mentionsNew = ex.item.desc && ex.item.qty != null && last && last.desc && last.desc.toLowerCase() !== ex.item.desc.toLowerCase();
      if (!last || c.wantMore || (lastDone && mentionsNew) || (last.desc && ex.item.desc && ex.item.qty != null && mentionsNew && itemNeeds(last))) { b.items.push(blankItem()); c.wantMore = false; c.itemsDone = false; }
      idx = b.items.length - 1;
    }
    keys.sort((x, y) => (x === 'desc' ? -1 : 0) - (y === 'desc' ? -1 : 0)).forEach(k => setI(c, log, idx, k, ex.item[k]));
  }
  if (ex.flags.itemsDone) c.itemsDone = true;
  if (ex.flags.skipHS && b.items.length) { const it = b.items[currentItemIdx(c)]; if (it.hs == null) it.skipHS = true; }
  if (ex.flags.skipCOO && b.items.length) { const it = b.items[currentItemIdx(c)]; if (!it.coo) it.skipCOO = true; }
}

/* ---------- one conversational turn (built-in understanding) ---------- */
/* Keep unsupported places and non-GBP amounts out of the booking, and recover safe misspellings. */
function applyScope(ex, sc) {
  if (sc.blockDest) { delete ex.b.destCity; delete ex.b.destCountry; }
  if (sc.blockOrigin) delete ex.b.originCity;
  if (sc.badCurrency) {
    delete ex.b.declaredValue; if (ex.item) delete ex.item.price;
    (ex.items || []).forEach(i => { i.price = null; });
  }
  if (sc.resolved.destCity && !sc.blockDest && !ex.b.destCity) { ex.b.destCity = sc.resolved.destCity; ex.b.destCountry = PF.DESTS[sc.resolved.destCity]; }
  if (sc.resolved.originCity && !sc.blockOrigin && !ex.b.originCity) ex.b.originCity = sc.resolved.originCity;
}
function dateProblemOf(text, today, ask, ex) {
  const dp = parseDateText(text, today);
  const cue = (ask && (ask.key === 'readyDate' || ask.key === 'basics')) || DATE_CUE.test(text);
  return !dp.iso && cue && (dp.ambiguous || dp.invalid) && !(ex.b && ex.b.readyDate) ? dp : null;
}
/* ---------- Validation of values entering the booking from chat (the rules live in ../validate) ---------- */
const FK_BOOK = { pallets: 'pallets', cartons: 'cartons', declaredValue: 'declaredValue', grossWeight: 'grossWeight' };
const FK_ITEM = { qty: 'qty', price: 'price', upc: 'upc', cartons: 'itemCartons', unitWeight: 'unitWeight' };
const emptyEx = () => ({ b: {}, item: {}, rel: [], sets: [], flags: {}, itemTarget: null, carrier: null, intent: null, items: null });
const itemKeyOf = fk => Object.keys(FK_ITEM).find(k => FK_ITEM[k] === fk) || null;
function dropField(ex, fk) {
  const bk = FK_BOOK[fk];
  if (bk) { delete ex.b[bk]; ex.rel = ex.rel.filter(r => r.field !== bk); ex.sets = ex.sets.filter(x => x.field !== bk); }
  const ik = fk === 'hs' ? 'hs' : (itemKeyOf(fk) || (fk === 'cartons' ? 'cartons' : null));   // a bare "cartons" claim could be either level
  if (ik) { delete ex.item[ik]; ex.sets = ex.sets.filter(x => x.field !== 'item.' + ik); (ex.items || []).forEach(i => { i[ik] = null; }); }
}
function reject(list, field, message, extra) { if (!list.some(r => r.field === field)) list.push(Object.assign({ field, message }, extra || {})); }

/** Checks everything a message tried to put into the booking. Invalid values are dropped; the sentence to show is returned. */
function sanitizeExtraction(c, ex, text, today, askKey) {
  const rej = [];
  const idx = currentItemIdx(c);
  // 1. Numbers the seller attached to a field, read straight from the text (zero, negative, word forms).
  rejectedClaims(text).forEach(r => { dropField(ex, r.field); reject(rej, r.field, r.message, { itemIdx: idx }); });
  // 2. Values that extraction produced, including anything a language model returned.
  Object.keys(FK_BOOK).forEach(k => {
    const vals = [ex.b[k]].concat(ex.sets.filter(x => x.field === k).map(x => x.value)).filter(v => v !== undefined && v !== null);
    for (const v of vals) { const r = checkNumber(FK_BOOK[k], v); if (!r.ok) { dropField(ex, k); reject(rej, k, chatRejection(k, r)); break; } }
  });
  Object.keys(FK_ITEM).forEach(k => {
    const vals = [ex.item[k]].concat(ex.sets.filter(x => x.field === 'item.' + k).map(x => x.value)).concat((ex.items || []).map(i => i[k])).filter(v => v !== undefined && v !== null);
    for (const v of vals) { const r = checkNumber(FK_ITEM[k], v); if (!r.ok) { dropField(ex, FK_ITEM[k]); reject(rej, FK_ITEM[k], chatRejection(FK_ITEM[k], r), { itemIdx: idx }); break; } }
  });
  const hsVals = [ex.item.hs].concat(ex.sets.filter(x => x.field === 'item.hs').map(x => x.value)).concat((ex.items || []).map(i => i.hs)).filter(v => v !== undefined && v !== null);
  for (const v of hsVals) { const r = checkHs(v); if (!r.ok) { dropField(ex, 'hs'); reject(rej, 'hs', chatHsRejection(r), { itemIdx: idx }); break; } }
  // A bare reply to the HS question is checked as typed ("TBC", "-691200", "0"), because extraction may have tidied it into something valid.
  if (askKey === 'item.hs' && !ex.flags.skipHS && !SKIP.test(text) && !/don'?t know|not sure/i.test(text)) {
    const t = text.trim();
    if (/^[-−–]?[\w./]{1,24}$/.test(t) || /^[-−–]?[\d.\s]{1,24}$/.test(t)) {
      const r = checkHs(t);
      if (!r.ok) { dropField(ex, 'hs'); reject(rej, 'hs', chatHsRejection(r), { itemIdx: idx }); }
    }
  }
  // 3. A ready date in the past is not accepted (today is). The old date, if there is one, stays.
  const dateVals = [ex.b.readyDate].concat(ex.sets.filter(x => x.field === 'readyDate').map(x => x.value)).filter(v => v);
  for (const v of dateVals) {
    const d = checkReadyDate(v, today);
    if (!d.ok) { delete ex.b.readyDate; ex.sets = ex.sets.filter(x => x.field !== 'readyDate'); reject(rej, 'readyDate', d.message); break; }
  }
  return rej;
}

/** After applying, undo any change that left a covered field invalid (for example "remove a pallet" down to 0). */
function revertInvalid(c, snap, log, rej, today) {
  const b = c.b;
  if (b.readyDate !== snap.readyDate && b.readyDate) {
    const d = checkReadyDate(b.readyDate, today);
    if (!d.ok) { b.readyDate = snap.readyDate; log.set = log.set.filter(e => e.field !== 'readyDate'); log.changed = log.changed.filter(e => e.field !== 'readyDate'); reject(rej, 'readyDate', d.message); }
  }
  const undo = (field, isItem) => { const keep = e => !(e.field === field && (isItem ? e.item !== null : e.item === null)); log.set = log.set.filter(keep); log.changed = log.changed.filter(keep); };
  Object.keys(FK_BOOK).forEach(k => {
    if (b[k] !== snap[k] && b[k] !== null && b[k] !== undefined) {
      const r = checkNumber(FK_BOOK[k], b[k]);
      if (!r.ok) { b[k] = snap[k]; undo(k, false); reject(rej, k, chatRejection(k, r)); }
    }
  });
  b.items.forEach((it, i) => {
    const old = snap.items[i] || {};
    Object.keys(FK_ITEM).forEach(k => {
      if (it[k] !== old[k] && it[k] !== null && it[k] !== undefined) {
        const r = checkNumber(FK_ITEM[k], it[k]);
        if (!r.ok) { it[k] = old[k] === undefined ? null : old[k]; undo(k, true); reject(rej, FK_ITEM[k], chatRejection(FK_ITEM[k], r), { itemIdx: i }); }
      }
    });
  });
}

/** A bare reply ("3", "£5", "5 Nov") right after a refusal answers the refused field, not whatever question comes next. */
function applyReask(c, ex, pending, text, today) {
  const f = pending.field;
  if (f === 'readyDate') { const d = dateOf(text, today); if (!d) return ex; const out = emptyEx(); out.b.readyDate = d; return out; }
  if (!(f in FIELDS)) return ex;
  const m = /^\s*[£]?\s*(-?\s?\d[\d,]*(?:\.\d+)?|\.\d+|zero|none|nil|no|minus\s+\d[\d,]*(?:\.\d+)?)\s*(?:kg|kgs|gbp|pounds?|units?|pallets?|cartons?)?\s*[.!]?\s*$/i.exec(text);
  if (!m) return ex;
  const p = parseNumeric(m[1].replace(/\s+/g, ' ').replace(/^-\s/, '-'), true);
  if (p.kind !== 'number') return ex;
  const out = emptyEx();
  if (FK_BOOK[f]) out.b[f] = p.n; else { out.item[itemKeyOf(f)] = p.n; out.itemTarget = pending.itemIdx != null ? pending.itemIdx : null; }
  return out;
}

function step(c, text, opts) {
  opts = opts || {};
  text = String(text).replace(/[\u2018\u2019]/g, "'");
  const today = opts.todayISO || PF.todayISO();
  const log = { set: [], changed: [], notes: [], understood: false, intent: null, reset: false };
  const ask = c.asked;
  const askKey = ask ? ask.key : null;
  const pending = c.reask || null;
  c.reask = null;
  const all = extractAll(text, c, askKey, today);
  if (all.intent === 'reset') { log.reset = true; return log; }
  let ex = mergeEx(answerFor(ask, text, c, today), all);
  if (pending) ex = applyReask(c, ex, pending, text, today);
  const sc = checkScope(text);
  applyScope(ex, sc);
  log.scope = sc.messages;
  log.dateProblem = dateProblemOf(text, today, ask, ex);
  if (ex.intent) log.intent = ex.intent;
  const rej = sanitizeExtraction(c, ex, text, today, askKey);
  log.rejected = rej;
  const snap = JSON.parse(JSON.stringify(c.b));
  const before = JSON.stringify(c.b) + '|' + c.itemsDone + '|' + c.wantMore;
  const hadHS = c.b.items.length ? c.b.items[c.b.items.length - 1].skipHS : false;
  const hadCOO = c.b.items.length ? c.b.items[c.b.items.length - 1].skipCOO : false;
  applyEx(c, ex, log);
  revertInvalid(c, snap, log, rej, today);
  c.reask = rej.find(r => r.field !== 'hs') || null;
  const last = c.b.items[c.b.items.length - 1];
  if (last && last.skipHS && !hadHS) log.notes.push('No problem, I’ll leave the HS code blank. Customs needs at least 6 digits, so the checks will flag it.');
  if (last && last.skipCOO && !hadCOO) log.notes.push('OK, I’ll leave the country of origin blank. The checks will flag it.');
  if (askKey === 'item.more') {
    if (/another|one more|add\s+(?:a|another|more)|^\s*(?:yes|yeah|yep|yup|sure)/i.test(text)) { c.wantMore = true; c.itemsDone = false; log.notes.push('Sure, let’s add another product.'); }
    else if (/everything|that'?s\s+(?:all|it)|nothing\s+else|^\s*(?:no|nope|nah|done|none|all)\b/i.test(text)) { c.itemsDone = true; }
  }
  if (/(?:^|\b)(?:roughly|approx(?:imately)?|about|around|circa|c\.)\s*[£]?\s*\d|~\s*\d/i.test(text) && (log.set.length || log.changed.length)) log.notes.push('You said “roughly”, so I’ve used that figure exactly as given. If you have the exact number, tell me, because the checks use it as written.');
  autoFill(c, log.notes);
  c.started = true;
  c.asked = nextAsk(c);
  autoFill(c, log.notes);
  c.asked = nextAsk(c);
  log.understood = log.intent === 'confirm' || log.set.length > 0 || log.changed.length > 0 || before !== JSON.stringify(c.b) + '|' + c.itemsDone + '|' + c.wantMore;
  return log;
}
function mergeEx(a, b) {
  const out = { b: Object.assign({}, b.b, a.b), item: Object.assign({}, b.item, a.item), rel: a.rel.concat(b.rel), sets: a.sets.concat(b.sets), flags: Object.assign({}, b.flags, a.flags), itemTarget: a.itemTarget != null ? a.itemTarget : b.itemTarget, carrier: a.carrier || b.carrier, intent: a.intent || b.intent };
  return out;
}
/* Interpret a short reply in the context of the question just asked. */
function answerFor(ask, text, c, today) {
  const ex = { b: {}, item: {}, rel: [], sets: [], flags: {}, itemTarget: null, carrier: null, intent: null };
  if (!ask) return ex;
  const t = text.trim();
  const I = ask.itemIdx;
  switch (ask.key) {
    case 'seller': { const v = parseField('seller', t, today); if (v && !/\d{4,}|appointment|pallet|carton|warehouse|\bkg\b|£/i.test(v) && !yesNo(v) && v.split(' ').length <= 8 && !cityOf(v).originCity && !cityOf(v).destCity) ex.b.seller = v; break; }
    case 'originCity': { const v = parseField('originCity', t); if (v) ex.b.originCity = v; break; }
    case 'destCity': { const v = parseField('destCity', t); if (v) { ex.b.destCity = v; ex.b.destCountry = DESTS[v]; } break; }
    case 'destType': { const v = destTypeOf(t); if (v) ex.b.destType = v; break; }
    case 'appointment': { const v = yesNo(t); if (v) ex.b.appointment = v; break; }
    case 'readyDate': { const v = dateOf(t, today); if (v) ex.b.readyDate = v; break; }
    case 'priority': { const v = priorityOf(t); if (v) ex.b.priority = v; break; }
    case 'item.price': case 'item.upc': case 'item.cartons': case 'item.weight': {
      const f = { 'item.price': 'price', 'item.upc': 'upc', 'item.cartons': 'cartons', 'item.weight': 'unitWeight' }[ask.key];
      let v = firstNumber(t);
      if (v !== undefined && f === 'unitWeight' && /\d\s*(?:g|gram|grams|gr)\b/i.test(t) && !/kg|kilo/i.test(t)) v = v / 1000;
      if (v !== undefined) ex.item[f] = v;
      ex.itemTarget = I;
      break;
    }
    case 'item.hs': {
      if (SKIP.test(t) || /don'?t know/i.test(t)) { ex.flags.skipHS = true; break; }
      const v = parseField('item.hs', t); if (v) ex.item.hs = v;
      else if (/^\d{1,5}$/.test(t.replace(/[\s.]/g, ''))) ex.item.hs = t.replace(/[\s.]/g, '');
      ex.itemTarget = I; break;
    }
    case 'item.coo': {
      if (SKIP.test(t) || /not sure|don'?t know/i.test(t)) { ex.flags.skipCOO = true; break; }
      const v = cooOf(t); if (v) ex.item.coo = v;
      ex.itemTarget = I; break;
    }
    case 'basics': {
      // Split a free-text answer into pieces and place each one by what it is.
      const segs = t.split(/[,;\n]|\band\b/i).map(x => x.trim()).filter(Boolean);
      const left = [];
      segs.forEach(sg => {
        let used = false;
        const dt = destTypeOf(sg); if (dt && c.b.destType == null) { ex.b.destType = dt; used = true; }
        const dv = dateOf(sg, today); if (dv && !c.b.readyDate) { ex.b.readyDate = dv; used = true; }
        const pr = priorityOf(sg); if (pr && c.b.priority == null && !dv) { ex.b.priority = pr; used = true; }
        const cc = cityOf(sg);
        if (cc.originCity && !c.b.originCity) { ex.b.originCity = cc.originCity; used = true; }
        if (cc.destCity && !c.b.destCity) { ex.b.destCity = cc.destCity; ex.b.destCountry = DESTS[cc.destCity]; used = true; }
        else if (cc.destCountry && !c.b.destCountry) { ex.b.destCountry = cc.destCountry; used = true; }
        if (ask.missing.indexOf('appointment') >= 0 && (/appointment|slot/i.test(sg) || /^(?:yes|no|yeah|yep|nope)\b/i.test(sg))) { const yn = yesNo(sg); if (yn) { ex.b.appointment = yn; used = true; } }
        if (!used) left.push(sg);
      });
      if (ask.missing.indexOf('seller') >= 0) {
        const name = left.find(x => !/\d/.test(x) && x.split(/\s+/).length <= 6 && !yesNo(x) && !/\b(?:warehouse|business|address|appointment|collect|deliver|ready|ship|pallets?|cartons?|from|to)\b/i.test(x));
        if (name) ex.b.seller = name.replace(/^(?:hi|hello)[\s,]*/i, '').replace(/^(?:it'?s|its|we(?:'| a)re|i(?:'| a)m|this is|my (?:company|business) is|called|named)\s+/i, '').trim() || undefined;
        if (!ex.b.seller) delete ex.b.seller;
      }
      break;
    }
    case 'item.details': {
      if (/don'?t know|not sure|unknown/i.test(t) && /hs|code|country|origin/i.test(t) || /don'?t know the hs code or country/i.test(t)) { ex.flags.skipHS = true; ex.flags.skipCOO = true; }
      ex.itemTarget = I;
      break;
    }
    case 'totals': {
      const v = firstNumber(t);
      if (v !== undefined) {
        if (ask.missing.length === 1 && /^[\s£]*\d[\d,]*(?:\.\d+)?\s*(?:kg|kgs)?[\s.]*$/.test(t)) ex.b[ask.missing[0]] = v;
        else if (/£/.test(t) && ask.missing.indexOf('declaredValue') >= 0 && /^[\s£]*\d[\d,]*(?:\.\d+)?[\s.]*$/.test(t)) ex.b.declaredValue = v;
      }
      break;
    }
    default: break;
  }
  return ex;
}

/* ---------- reply text ---------- */
function ackText(log) {
  const parts = [];
  const T = {
    seller: v => v, originCity: v => 'collecting from ' + v, destCity: v => 'delivering to ' + v, destType: v => 'delivery type: ' + v, readyDate: v => 'ready on ' + v,
    priority: v => 'priority: ' + v, pallets: v => v + ' pallet' + (v === '1' ? '' : 's'), cartons: v => v + ' carton' + (v === '1' ? '' : 's'), grossWeight: v => v + ' gross',
    declaredValue: v => v + ' declared', appointment: v => v === 'Yes' ? 'delivery appointment booked' : 'no delivery appointment',
    desc: v => v, qty: v => Number(v).toLocaleString('en-GB') + ' units', price: v => v + ' each', upc: v => v + ' per carton', unitWeight: v => v + ' each',
    hs: v => 'HS code ' + v, coo: v => 'made in ' + v
  };
  const phrase = s => (T[s.field] ? T[s.field](s.to) : s.label + ' ' + s.to);
  const book = log.set.filter(s => !s.item && s.field !== 'carrier');
  const byItem = {};
  log.set.filter(s => s.item).forEach(s => { (byItem[s.item] = byItem[s.item] || []).push(s); });
  const bits = book.map(phrase);
  Object.keys(byItem).forEach(k => {
    const list = byItem[k], hasDesc = list.some(s => s.field === 'desc');
    const ord = ['desc', 'qty', 'price', 'upc', 'cartons', 'unitWeight', 'hs', 'coo'];
    const ordered = list.slice().sort((x, y) => ord.indexOf(x.field) - ord.indexOf(y.field));
    bits.push((hasDesc ? '' : k + ': ') + ordered.map(phrase).join(', '));
  });
  if (bits.length) parts.push('Got it: ' + bits.join('; ') + '.');
  log.changed.forEach(ch => parts.push('Updated ' + (ch.item ? ch.item + ' ' : '') + ch.label + ' from ' + ch.from + ' to ' + ch.to + '.'));
  log.set.filter(s => s.field === 'carrier').forEach(s => parts.push('Switched to ' + s.to + '.'));
  log.notes.forEach(n => parts.push(n));
  return parts.join(' ');
}
function sheetFields(b) {
  const f = (label, value) => ({ label, value: value == null || value === '' ? null : value });
  const s = sums(b);
  return [
    f('Seller', b.seller),
    f('Collection', b.originCity ? b.originCity + ', United Kingdom' : null),
    f('Delivery', b.destCity ? b.destCity + ', ' + b.destCountry : (b.destCountry ? b.destCountry + ' (city needed)' : null)),
    f('Delivery type', b.destType),
    f('Delivery appointment', b.appointment),
    f('Ready to ship', b.readyDate ? dmy(b.readyDate) : null),
    f('Priority', b.priority),
    f('Pallets', b.pallets),
    f('Cartons', b.cartons),
    f('Gross weight', b.grossWeight != null ? nf(b.grossWeight, 2) + ' kg' : null),
    f('Declared value', b.declaredValue != null ? gbp(b.declaredValue) : null)
  ];
}
function isComplete(c) { return c.started && c.asked === null; }

/* ---------- AI-assisted extraction (used when Claude is available) ---------- */
function aiPrompt(c, text, askText) {
  const b = c.b;
  const cur = {
    seller: b.seller, originCity: b.originCity, destCity: b.destCity, destCountry: b.destCountry, destType: b.destType,
    readyDate: b.readyDate ? dmy(b.readyDate) : null, priority: b.priority, pallets: b.pallets, cartons: b.cartons,
    declaredValue: b.declaredValue, grossWeight: b.grossWeight, appointment: b.appointment,
    items: b.items.map(i => ({ sku: i.sku, desc: i.desc, hs: i.hs, qty: i.qty, price: i.price, upc: i.upc, cartons: i.cartons, unitWeight: i.unitWeight, coo: i.coo, skipHS: i.skipHS, skipCOO: i.skipCOO }))
  };
  return [
    'You extract shipment booking details from a seller’s chat message. Return ONLY a JSON object, no prose, no code fences.',
    'The booking so far (null = not known yet):', JSON.stringify(cur),
    askText ? 'The assistant just asked the seller: “' + askText + '”. A short reply (like “3”, “yes”, “Fastest”) answers that question.' : 'This is the seller’s first message.',
    'The seller’s new message: “' + text + '”',
    'Return the complete updated booking using exactly this shape:',
    '{"seller":str|null,"originCity":str|null,"destCity":str|null,"destCountry":str|null,"destType":"Warehouse"|"Business address"|null,"readyDate":null,"priority":"Cheapest"|"Fastest"|"Most reliable"|"Balanced"|null,"pallets":num|null,"cartons":num|null,"declaredValue":num|null,"grossWeight":num|null,"appointment":"Yes"|"No"|null,"itemsDone":bool,"unsupported":str|null,"items":[{"sku":str|null,"desc":str|null,"hs":str|null,"qty":num|null,"price":num|null,"upc":num|null,"cartons":num|null,"unitWeight":num|null,"coo":str|null,"skipHS":bool,"skipCOO":bool}]}',
    'Rules:',
    '- Keep everything already known unless the seller changes it. Never invent values; use null when not stated.',
    '- originCity must be one of London, Manchester, Birmingham, Leeds. destCity one of Berlin, Frankfurt, Hamburg (Germany), Paris, Lyon (France), Amsterdam, Rotterdam (Netherlands). If the seller names a place outside these lists, set that field null and describe it in "unsupported".',
    '- coo (country of origin = where a product was made, not where it ships from) must be one of United Kingdom, China, India, Vietnam, Turkey, Germany, or null.',
    '- Relative changes: “add a pallet” means pallets = current pallets + 1; “remove a carton” means cartons − 1. Apply them to the current value.',
    '- Total cartons/pallets/weight/value for the whole booking go in the top-level fields; per-product figures go inside items. Units per carton is "upc".',
    '- “pounds”, “quid”, “GBP” and “£” always mean money, never weight. Weight is only ever in kg, g, “kilos” or “grams”. “5 pounds each” or “£5 each” is a unit price of 5 (items[].price), not a weight. “0.5kg each” is unitWeight; the weight of the whole shipment goes in grossWeight.',
    '- Worked example: “1,000 mugs, 5 pounds each, 12 per carton, 0.5kg each” gives items[0] = {"desc":"mugs","qty":1000,"price":5,"upc":12,"unitWeight":0.5} and grossWeight stays null.',
    '- Always return readyDate as null: dates are resolved by other code, never by you. Return sku only if the seller typed one, otherwise null. Never invent a SKU.\n- Money is GBP; return plain numbers. Dates are DD-MM-YYYY (today is ' + PF.dmy(PF.todayISO()) + ').',
    '- Do not do arithmetic to fill in totals the seller did not state. Do not correct mistakes in the seller’s numbers; record what they said.',
    '- If they say they don’t know a product’s HS code set skipHS true; same for country of origin and skipCOO.',
    '- Set itemsDone true only if the seller says there are no more products.',
    '- Add each new product as a new entry in items; keep existing items in the same order.'
  ].join('\n');
}
function aiParse(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'), z = s.lastIndexOf('}');
  if (a < 0 || z <= a) return null;
  try { return JSON.parse(s.slice(a, z + 1)); } catch (e) { return null; }
}
function aiToEx(o, c) {
  if (!o || typeof o !== 'object') return null;
  const ex = { b: {}, item: {}, rel: [], sets: [], flags: {}, itemTarget: null, carrier: null, intent: null, items: null, unsupported: o.unsupported || null };
  const str = v => (typeof v === 'string' && v.trim()) ? v.trim() : undefined;
  const nm = v => { const n = PF.num(v); return n === null ? undefined : n; };
  const s = str(o.seller); if (s) ex.b.seller = s;
  const oc = ORIGINS.find(x => str(o.originCity) && x.toLowerCase() === o.originCity.toLowerCase()); if (oc) ex.b.originCity = oc;
  const dc = Object.keys(DESTS).find(x => str(o.destCity) && x.toLowerCase() === o.destCity.toLowerCase()); if (dc) { ex.b.destCity = dc; ex.b.destCountry = DESTS[dc]; }
  else if (str(o.destCountry)) { const k = ['Germany', 'France', 'Netherlands'].find(x => x.toLowerCase() === o.destCountry.toLowerCase()); if (k) ex.b.destCountry = k; }
  if (o.destType === 'Warehouse' || o.destType === 'Business address') ex.b.destType = o.destType;
  // The ready date is never taken from the model: it is resolved from the text by parseDateText.
  if (PRIORITIES.indexOf(o.priority) >= 0) ex.b.priority = o.priority;
  ['pallets', 'cartons', 'declaredValue', 'grossWeight'].forEach(k => { const v = nm(o[k]); if (v !== undefined) ex.b[k] = v; });
  if (o.appointment === 'Yes' || o.appointment === 'No') ex.b.appointment = o.appointment;
  if (o.itemsDone === true) ex.flags.itemsDone = true;
  if (Array.isArray(o.items)) {
    ex.items = o.items.map(i => {
      const it = blankItem();
      it.sku = str(i.sku) || null; it.desc = str(i.desc) || null;
      const hs = i.hs == null ? null : String(i.hs).replace(/[\s.]/g, ''); it.hs = hs && /^\d+$/.test(hs) ? hs : null;
      ['qty', 'price', 'upc', 'cartons', 'unitWeight'].forEach(k => { const v = nm(i[k]); it[k] = v !== undefined ? v : null; });
      it.coo = COUNTRIES.find(x => str(i.coo) && x.toLowerCase() === i.coo.toLowerCase()) || null;
      it.skipHS = i.skipHS === true; it.skipCOO = i.skipCOO === true;
      return it;
    });
  }
  return ex;
}
function applyAI(c, ex, log) {
  const b = c.b;
  Object.keys(ex.b).forEach(k => setB(c, log, k, ex.b[k]));
  if (ex.items) {
    ex.items.forEach((n, idx) => {
      if (!b.items[idx]) { b.items.push(blankItem()); }
      ['desc', 'qty', 'price', 'upc', 'cartons', 'unitWeight', 'hs', 'coo'].forEach(k => { if (n[k] !== null) setI(c, log, idx, k, n[k]); });
      if (n.sku && !b.items[idx].sku) b.items[idx].sku = n.sku;
      if (n.skipHS && b.items[idx].hs == null) b.items[idx].skipHS = true;
      if (n.skipCOO && !b.items[idx].coo) b.items[idx].skipCOO = true;
    });
    // drop blank placeholders the AI didn't mention beyond the list
    while (b.items.length > ex.items.length && b.items[b.items.length - 1] && Object.keys(b.items[b.items.length - 1]).every(k => b.items[b.items.length - 1][k] === null || b.items[b.items.length - 1][k] === false)) b.items.pop();
  }
  if (ex.flags.itemsDone) c.itemsDone = true;
  if (c.wantMore && ex.items && ex.items.length > b.items.length - 1) c.wantMore = false;
}
function stepAI(c, text, ex, opts) {
  opts = opts || {};
  text = String(text).replace(/[\u2018\u2019]/g, "'");
  const log = { set: [], changed: [], notes: [], understood: false, intent: null, reset: false, unsupported: ex.unsupported || null };
  const before = JSON.stringify(c.b) + c.itemsDone;
  const ask = c.asked;
  const today = opts.todayISO || PF.todayISO();
  const pending = c.reask || null;
  c.reask = null;
  if (pending) { const re = applyReask(c, { b: ex.b, item: ex.item, rel: [], sets: [], flags: {}, itemTarget: null, carrier: null, intent: null, items: ex.items }, pending, text, today); if (re.b !== ex.b || re.item !== ex.item) { ex = Object.assign({}, ex, { b: re.b, item: re.item, items: null, itemTarget: re.itemTarget }); } }
  // Dates, scope and SKUs are decided by deterministic code. Whatever the model said about them is checked or dropped here.
  const dp = parseDateText(text, today);
  if (dp.iso && ((ask && (ask.key === 'readyDate' || ask.key === 'basics')) || DATE_CUE.test(text))) ex.b.readyDate = dp.iso; else delete ex.b.readyDate;
  const sc = checkScope(text);
  applyScope(ex, sc);
  log.scope = sc.messages;
  log.dateProblem = dateProblemOf(text, today, ask, ex);
  (ex.items || []).forEach((it, idx) => {
    const known = c.b.items[idx];
    if (it.sku && !(known && known.sku === it.sku) && text.toLowerCase().indexOf(String(it.sku).toLowerCase()) < 0) it.sku = null;
  });
  if (/^\s*(start over|new booking|reset)\b/i.test(text)) { log.reset = true; return log; }
  ex.rel = ex.rel || []; ex.sets = ex.sets || []; ex.flags = ex.flags || {}; ex.item = ex.item || {};
  const rej = sanitizeExtraction(c, ex, text, today, ask ? ask.key : null);
  log.rejected = rej;
  const snap = JSON.parse(JSON.stringify(c.b));
  const cm = /\b(?:use|switch to|choose|pick|go with|select|take)\s+carrier\s+([abc])\b/i.exec(text);
  if (cm) { c.b._carrier = 'Carrier ' + cm[1].toUpperCase(); log.set.push({ field: 'carrier', label: 'carrier', to: c.b._carrier, item: null }); }
  if (/\b(confirm(?: it| the booking| booking)?|book it|go ahead|proceed|lock it in)\b/i.test(text) && c.started && !ask) log.intent = 'confirm';
  applyAI(c, ex, log);
  revertInvalid(c, snap, log, rej, today);
  c.reask = rej.find(r => r.field !== 'hs') || null;
  if (ask && ask.key === 'item.more') {
    if (/another|one more|^\s*(?:yes|yeah|yep|add)/i.test(text)) { c.wantMore = true; c.itemsDone = false; log.understood = true; }
    else if (/everything|that'?s (?:all|it)|nothing else|^\s*(?:no|nope|done)/i.test(text)) { c.itemsDone = true; log.understood = true; }
  }
  if (/(?:^|\b)(?:roughly|approx(?:imately)?|about|around|circa|c\.)\s*[£]?\s*\d|~\s*\d/i.test(text) && (log.set.length || log.changed.length)) log.notes.push('You said “roughly”, so I’ve used that figure exactly as given. If you have the exact number, tell me, because the checks use it as written.');
  autoFill(c, log.notes);
  log.understood = log.understood || log.intent === 'confirm' || before !== JSON.stringify(c.b) + c.itemsDone || log.set.length > 0;
  c.started = true;
  c.asked = nextAsk(c);
  autoFill(c, log.notes);
  c.asked = nextAsk(c);
  return log;
}

export { newChat, cloneChat, step, stepAI, nextAsk, ackText, sheetFields, isComplete, aiPrompt, aiParse, aiToEx, sums, extractAll, parseField, blankItem };
