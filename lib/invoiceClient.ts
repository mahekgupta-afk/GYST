import { fetchJson, TimeoutError } from './net';
import { INVOICE_MAX_BYTES, INVOICE_TIMEOUT_MS, INVOICE_TYPES } from './invoice';

export type InvoiceResult = {
  isInvoice: boolean; currency: string | null; seller: string | null; destCity: string | null; destCountry: string | null;
  declaredValue: number | null; cartons: number | null; pallets: number | null; grossWeight: number | null; items: any[];
};
export type InvoiceOutcome = { ok: true; result: InvoiceResult } | { ok: false; message: string };

const BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' };
const typeOf = (f: File) => f.type || BY_EXT[(f.name.split('.').pop() || '').toLowerCase()] || '';

/** Phone photos are large: scale a big image down before sending (the text on an invoice stays readable at 1800 px). Falls back to the original. */
async function shrink(file: File): Promise<File> {
  if (!typeOf(file).startsWith('image/') || file.size < 1_200_000 || typeof createImageBitmap === 'undefined' || typeof document === 'undefined') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}

export const INVOICE_MESSAGES = {
  type: 'I can read a PNG, JPG or WebP picture, or a PDF, of an invoice. Please choose one of those, or type the details instead.',
  large: 'That file is too large (the limit is 4 MB). Please send a smaller picture or type the details instead.',
  slow: 'Reading the invoice took too long. Nothing has been changed. Please try again, or type the details instead.',
  failed: 'I couldn’t read that invoice just now. Nothing has been changed. Please try again, or type the details instead.',
  busy: 'The invoice reader is busy right now. Please try again in a minute, or type the details instead.',
  notInvoice: 'That doesn’t look like an invoice, so I haven’t used it. Please upload an invoice, or type the details instead.',
  empty: 'I couldn’t find any shipment details on that picture. Please try a clearer one, or type the details instead.',
};

export async function readInvoice(original: File): Promise<InvoiceOutcome> {
  const type = typeOf(original);
  if (!(INVOICE_TYPES as readonly string[]).includes(type)) return { ok: false, message: INVOICE_MESSAGES.type };
  if (original.size === 0) return { ok: false, message: INVOICE_MESSAGES.empty };
  const file = await shrink(original);
  if (file.size > INVOICE_MAX_BYTES) return { ok: false, message: INVOICE_MESSAGES.large };
  const form = new FormData();
  form.append('file', file.type ? file : new File([file], file.name, { type }));
  try {
    const { res, json } = await fetchJson('/api/read-invoice', { method: 'POST', body: form }, INVOICE_TIMEOUT_MS);
    if (res.status === 429) return { ok: false, message: INVOICE_MESSAGES.busy };
    if (res.status === 413) return { ok: false, message: INVOICE_MESSAGES.large };
    if (res.status === 415) return { ok: false, message: INVOICE_MESSAGES.type };
    if (!res.ok || !json || !json.result) return { ok: false, message: INVOICE_MESSAGES.failed };
    return { ok: true, result: json.result as InvoiceResult };
  } catch (e) {
    return { ok: false, message: e instanceof TimeoutError ? INVOICE_MESSAGES.slow : INVOICE_MESSAGES.failed };
  }
}
