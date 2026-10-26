import { askJsonAboutFile, geminiEnabled } from '@/lib/server/gemini';
import { allow, clientIp } from '@/lib/server/rateLimit';
import { guardInvoice } from '@/lib/server/invoiceGuard';
import { C } from '@/lib/pf';
import { INVOICE_MAX_BYTES, INVOICE_MAX_ITEMS, INVOICE_PROMPT, INVOICE_TYPES } from '@/lib/invoice';

export const maxDuration = 45;   // seconds; the browser gives up after 42

/**
 * Reads an invoice (image or PDF) and returns the booking details printed on it. The file is read in memory and
 * sent to the AI reader; it is never written anywhere. The client turns the result into booking fields with
 * aiToEx and the shared validators and rulebook do all the checking.
 */
export async function POST(req: Request) {
  if (!geminiEnabled()) return Response.json({ error: 'disabled' }, { status: 503 });
  if (!allow(clientIp(req), 6)) return Response.json({ error: 'rate_limited' }, { status: 429 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return Response.json({ error: 'bad_request' }, { status: 400 });
  if (!(INVOICE_TYPES as readonly string[]).includes(file.type)) return Response.json({ error: 'unsupported_type' }, { status: 415 });
  if (file.size === 0) return Response.json({ error: 'empty' }, { status: 400 });
  if (file.size > INVOICE_MAX_BYTES) return Response.json({ error: 'too_large' }, { status: 413 });
  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');
    const raw = C.aiParse(await askJsonAboutFile(INVOICE_PROMPT, file.type, base64));
    if (!raw) return Response.json({ error: 'unreadable' }, { status: 502 });
    return Response.json({ result: guardInvoice(raw, INVOICE_MAX_ITEMS) });
  } catch (e) {
    console.error('invoice error:', e instanceof Error ? e.message.slice(0, 300) : e);
    return Response.json({ error: 'upstream' }, { status: 502 });
  }
}
