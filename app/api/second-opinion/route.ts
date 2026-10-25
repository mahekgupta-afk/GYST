import { z } from 'zod';
import { askJson, geminiEnabled } from '@/lib/server/gemini';
import { allow, clientIp } from '@/lib/server/rateLimit';

const Body = z.object({
  items: z.array(z.object({ sku: z.string().nullable().optional(), description: z.string().nullable().optional() })).max(50),
});

/** Advisory only. Not one of the ten rules. */
export async function POST(req: Request) {
  if (!geminiEnabled()) return Response.json({ error: 'disabled' }, { status: 503 });
  if (!allow(clientIp(req), 6)) return Response.json({ error: 'rate_limited' }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'bad_request' }, { status: 400 });
  const prompt =
    'You check export item descriptions for dangerous goods. Rule: lithium batteries (including devices with built-in lithium batteries), aerosols and flammable liquids cannot ship as ordinary freight. ' +
    'Be conservative: only flag an item when it is genuinely likely to be restricted. Ordinary food and cooking oils (olive oil, tea, jam), ceramics, textiles, paper, tools and similar goods are fine and must have concern null. A flammable liquid means a low flash point liquid such as petrol, solvents, lighter fluid, nail polish remover or alcohol-based products. ' +
    'For each item, say whether it is likely restricted. Return ONLY a JSON array like [{"sku":"X","concern":null}] where concern is null when fine, or a short plain-English reason when it may be restricted. Items: ' +
    JSON.stringify(parsed.data.items);
  try {
    const raw = await askJson(prompt);
    const a = raw.indexOf('['), z2 = raw.lastIndexOf(']');
    const arr = JSON.parse(raw.slice(a, z2 + 1));
    const flagged = (Array.isArray(arr) ? arr : []).filter((x: any) => x && x.concern).map((x: any) => ({ sku: String(x.sku ?? 'Item'), concern: String(x.concern) }));
    return Response.json({ flagged });
  } catch (e) {
    console.error('gemini error:', e instanceof Error ? e.message.slice(0, 300) : e);
    return Response.json({ error: 'upstream' }, { status: 502 });
  }
}
