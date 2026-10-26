import { z } from 'zod';
import { askJson, geminiEnabled } from '@/lib/server/gemini';
import { allow, clientIp } from '@/lib/server/rateLimit';
import { C } from '@/lib/pf';
import { dropInventedTotals } from '@/lib/server/guard';

export const maxDuration = 20;   // seconds; the browser gives up after 15

export async function GET() {
  return Response.json({ enabled: geminiEnabled() });
}

const Body = z.object({
  booking: z.record(z.string(), z.unknown()),
  text: z.string().min(1).max(2000),
  askText: z.string().max(500).nullable().optional(),
});

/**
 * Turns a seller's message into booking fields. Returns the model's JSON untouched;
 * the client sanitises it with aiToEx and the deterministic engine does all the checking.
 * Any non-200 response makes the client fall back to the built-in parser.
 */
export async function POST(req: Request) {
  if (!geminiEnabled()) return Response.json({ error: 'disabled' }, { status: 503 });
  if (!allow(clientIp(req))) return Response.json({ error: 'rate_limited' }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'bad_request' }, { status: 400 });
  const { booking, text, askText } = parsed.data;
  try {
    const raw = await askJson(C.aiPrompt({ b: booking }, text, askText ?? null));
    const obj = C.aiParse(raw);
    if (!obj) return Response.json({ error: 'unreadable' }, { status: 502 });
    return Response.json({ result: dropInventedTotals(obj, booking, text) });
  } catch (e) {
    console.error('gemini error:', e instanceof Error ? e.message.slice(0, 300) : e);
    return Response.json({ error: 'upstream' }, { status: 502 });
  }
}
