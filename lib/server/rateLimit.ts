// Small in-memory limiter. It is per server instance, which is enough to stop one visitor
// from using up a free Gemini quota. Swap for Upstash if you need a hard global limit.
const hits = new Map<string, number[]>();
let day = new Date().toDateString();
let dayCount = 0;

export function allow(ip: string, perMinute = 15): boolean {
  const now = Date.now();
  if (new Date().toDateString() !== day) { day = new Date().toDateString(); dayCount = 0; }
  const cap = Number(process.env.GEMINI_DAILY_CAP || 400);
  if (dayCount >= cap) return false;
  const recent = (hits.get(ip) || []).filter(t => now - t < 60_000);
  if (recent.length >= perMinute) { hits.set(ip, recent); return false; }
  recent.push(now); hits.set(ip, recent); dayCount++;
  if (hits.size > 5000) hits.clear();
  return true;
}
export const clientIp = (req: Request) => (req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
