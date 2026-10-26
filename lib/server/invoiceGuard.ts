import { numbersIn } from './guard';

// The reader may copy, never invent. Whatever it returns is checked against its own transcript of the document:
// a number that is not in the printed text, a SKU that is not in the printed text, or a total it worked out itself is dropped
// and the seller is asked for it instead. The ten rules then judge the booking exactly as they would one typed in chat.

const TOP_NUM = ['declaredValue', 'cartons', 'pallets', 'grossWeight'] as const;
const ITEM_NUM = ['qty', 'price', 'upc', 'cartons', 'unitWeight'] as const;
const digits = (s: string) => s.replace(/[\s.\-/]/g, '');

export type GuardedInvoice = {
  isInvoice: boolean; currency: string | null;
  seller: string | null; destCity: string | null; destCountry: string | null;
  declaredValue: number | null; cartons: number | null; pallets: number | null; grossWeight: number | null;
  items: { sku: string | null; desc: string | null; hs: string | null; qty: number | null; price: number | null; upc: number | null; cartons: number | null; unitWeight: number | null; coo: string | null }[];
};

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? parseFloat(v) : null);

export function guardInvoice(raw: Record<string, any>, maxItems = 25): GuardedInvoice {
  const transcript = String(raw.transcript ?? '');
  const printed = numbersIn(transcript);
  const flat = transcript.toLowerCase();
  const flatDigits = digits(transcript);
  const seen = (n: number | null) => n !== null && printed.some(p => Math.abs(p - Math.abs(n)) < 1e-9);
  // Zero and negative numbers are kept when printed: the shared validators then refuse them with a clear message.
  const keep = (v: unknown) => { const n = num(v); return seen(n) ? n : null; };

  const out: GuardedInvoice = {
    isInvoice: raw.isInvoice === true && transcript.trim().length > 0,
    currency: str(raw.currency) ? String(raw.currency).trim().toUpperCase().slice(0, 3) : null,
    seller: str(raw.seller), destCity: str(raw.destCity), destCountry: str(raw.destCountry),
    declaredValue: null, cartons: null, pallets: null, grossWeight: null, items: [],
  };
  for (const k of TOP_NUM) out[k] = keep(raw[k]);
  const items = Array.isArray(raw.items) ? raw.items.slice(0, maxItems) : [];
  out.items = items.filter(i => i && typeof i === 'object').map((i: any) => {
    const it: any = { sku: null, desc: str(i.desc), hs: null, coo: str(i.coo) };
    const sku = str(i.sku); if (sku && flat.includes(sku.toLowerCase())) it.sku = sku;
    const hs = i.hs == null ? null : digits(String(i.hs)); if (hs && /^\d+$/.test(hs) && flatDigits.includes(hs)) it.hs = hs;
    for (const k of ITEM_NUM) it[k] = keep(i[k]);
    return it;
  });
  return out;
}
