import { GoogleGenAI } from '@google/genai';

export const geminiEnabled = () => !!process.env.GEMINI_API_KEY;

// Each model has its own free-tier quota, so trying several in turn raises the ceiling.
// Override with GEMINI_MODEL (comma-separated, in order of preference).
const MODELS = () =>
  (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.8-flash').split(',').map(s => s.trim()).filter(Boolean);

// Reading a picture is slower than reading a sentence, and models differ a lot in speed and load, so the invoice reader has its own
// chain: quick models first, each given a short time before the next is tried. Override with GEMINI_VISION_MODEL.
const VISION_MODELS = () =>
  (process.env.GEMINI_VISION_MODEL || 'gemini-3.6-flash,gemini-3-flash-preview,gemini-3.1-flash-lite,gemini-flash-lite-latest,gemini-3.5-flash-lite').split(',').map(s => s.trim()).filter(Boolean);

let client: GoogleGenAI | null = null;
const ai = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));

// Quota, overload and "model gone" errors are worth trying the next model for.
const SKIPPABLE = /"code":\s*(429|503|504|404)|UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|aborted|timed? ?out/i;

export const TEXT_TIMEOUT_MS = 4000;

// Health of the text reader. After a failure the built-in parser carries on alone for a while, so a broken key or model costs
// the seller nothing: GET /api/parse-message reports enabled:false and POST answers at once instead of waiting.
const COOLDOWN_MS = 5 * 60 * 1000;
let downUntil = 0, reported = false;
export const geminiHealthy = () => Date.now() >= downUntil;
/** Print the real error the first time only; later failures are counted silently. */
function noteFailure(e: unknown) {
  downUntil = Date.now() + COOLDOWN_MS;
  if (reported) return;
  reported = true;
  console.error('[parse-message] Gemini call failed, using the built-in parser for the next 5 minutes. Real error:', e instanceof Error ? (e.stack || e.message).slice(0, 800) : e);
}
export function noteSuccess() { downUntil = 0; }

/**
 * Ask Gemini for a JSON reply, giving up after 4 s in total (one AbortController covers every model tried). Returns the raw text;
 * callers validate it. Any failure is logged once and re-thrown so the route can fall back to the built-in parser.
 */
export async function askJson(prompt: string): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TEXT_TIMEOUT_MS);
  const call = (model: string, quick: boolean) => ai().models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: 'application/json', temperature: 0, abortSignal: ctl.signal, httpOptions: { timeout: TEXT_TIMEOUT_MS }, ...(quick ? { thinkingConfig: { thinkingLevel: 'minimal' as any } } : {}) },
  });
  let last: unknown = new Error('no_model');
  try {
    for (const model of MODELS()) {
      if (ctl.signal.aborted) break;
      try {
        let res;
        try { res = await call(model, true); }
        catch (e) { if (!ctl.signal.aborted && /INVALID_ARGUMENT|thinking/i.test(e instanceof Error ? e.message : '')) res = await call(model, false); else throw e; }
        if (!res.text || !res.text.trim()) throw new Error('empty reply');
        noteSuccess();
        return res.text;
      } catch (e) {
        last = e;
        if (ctl.signal.aborted || !SKIPPABLE.test(e instanceof Error ? e.message : '')) break;
      }
    }
    throw ctl.signal.aborted ? new Error('timed out after ' + TEXT_TIMEOUT_MS + ' ms (last error: ' + (last instanceof Error ? last.message : last) + ')') : last;
  } catch (e) {
    noteFailure(e);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask Gemini to read a file (an image or PDF) and reply in JSON. Returns the raw text; callers validate it.
 *
 * Speed varies a great deal from model to model and minute to minute, so the models are RACED: the first starts at once and
 * the next ones join every few seconds (or at once if the ones running have all failed). The first good answer wins and the
 * rest are cancelled. Each model is told to think as little as it can: reading text off a picture needs no deliberation, and
 * that cuts a read from 10 to 20 seconds down to about 4.
 */
const STAGGER_MS = 5000, DEADLINE_MS = 36000, CALL_TIMEOUT_MS = 32000;
export async function askJsonAboutFile(prompt: string, mimeType: string, base64: string): Promise<string> {
  const models = VISION_MODELS();
  const contents = [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }] }];
  const call = async (model: string, signal: AbortSignal, quick: boolean): Promise<string> => {
    const res = await ai().models.generateContent({
      model, contents,
      config: { responseMimeType: 'application/json', temperature: 0, abortSignal: signal, httpOptions: { timeout: CALL_TIMEOUT_MS }, ...(quick ? { thinkingConfig: { thinkingLevel: 'minimal' as any } } : {}) },
    });
    if (!res.text || !res.text.trim()) throw new Error('empty reply');
    return res.text;
  };
  // A model that does not accept the "think less" setting is asked again without it.
  const attempt = async (model: string, signal: AbortSignal) => {
    try { return await call(model, signal, true); }
    catch (e) { if (!signal.aborted && /INVALID_ARGUMENT|thinking/i.test(e instanceof Error ? e.message : '')) return call(model, signal, false); throw e; }
  };
  return new Promise<string>((resolve, reject) => {
    const all = new AbortController();
    let launched = 0, failed = 0, done = false, last: unknown = new Error('no_model');
    let stagger: ReturnType<typeof setInterval> | undefined, deadline: ReturnType<typeof setTimeout> | undefined;
    const end = (fn: () => void) => { if (done) return; done = true; clearInterval(stagger); clearTimeout(deadline); all.abort(); fn(); };
    const launch = () => {
      if (done || launched >= models.length) return;
      const model = models[launched++];
      attempt(model, all.signal).then(
        text => end(() => resolve(text)),
        e => {
          if (done) return;
          last = e; failed++;
          if (failed >= models.length) end(() => reject(last));
          else if (failed === launched) launch();                  // everything running has failed: start the next one now
        });
    };
    stagger = setInterval(launch, STAGGER_MS);
    deadline = setTimeout(() => end(() => reject(last)), DEADLINE_MS);
    launch();
  });
}
