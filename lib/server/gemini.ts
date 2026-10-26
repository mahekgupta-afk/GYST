import { GoogleGenAI } from '@google/genai';

export const geminiEnabled = () => !!process.env.GEMINI_API_KEY;

// Each model has its own free-tier quota, so trying several in turn raises the ceiling.
// Override with GEMINI_MODEL (comma-separated, in order of preference).
const MODELS = () =>
  (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.8-flash').split(',').map(s => s.trim()).filter(Boolean);

// Reading a picture is slower than reading a sentence, and models differ a lot in speed and load, so the invoice reader has its own
// chain: quick models first, each given a short time before the next is tried. Override with GEMINI_VISION_MODEL.
const VISION_MODELS = () =>
  (process.env.GEMINI_VISION_MODEL || 'gemini-3.1-flash-lite,gemini-3.6-flash,gemini-3-flash-preview,gemini-3.5-flash-lite,gemini-flash-lite-latest').split(',').map(s => s.trim()).filter(Boolean);

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

/** Ask Gemini to read a file (an image or PDF) and reply in JSON. Returns the raw text; callers validate it. */
export async function askJsonAboutFile(prompt: string, mimeType: string, base64: string): Promise<string> {
  let last: unknown;
  const started = Date.now();
  for (const model of VISION_MODELS()) {
    if (Date.now() - started > 28000) break;      // the browser gives up after 42 s
    try {
      const res = await ai().models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }] }],
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
