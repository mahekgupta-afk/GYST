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

/** Ask Gemini for a JSON reply. Returns the raw text; callers validate it. */
export async function askJson(prompt: string): Promise<string> {
  let last: unknown;
  const started = Date.now();
  for (const model of MODELS()) {
    if (Date.now() - started > 8000) break;     // total budget: the browser gives up after 14 s
    try {
      const res = await ai().models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json', temperature: 0, httpOptions: { timeout: 12000 } },
      });
      return res.text ?? '';
    } catch (e) {
      last = e;
      if (!SKIPPABLE.test(e instanceof Error ? e.message : '')) throw e;
    }
  }
  throw last;
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
