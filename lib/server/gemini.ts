import { GoogleGenAI } from '@google/genai';

export const geminiEnabled = () => !!process.env.GEMINI_API_KEY;

// Each model has its own free-tier quota, so trying several in turn raises the ceiling.
// Override with GEMINI_MODEL (comma-separated, in order of preference).
const MODELS = () =>
  (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.8-flash').split(',').map(s => s.trim()).filter(Boolean);

let client: GoogleGenAI | null = null;
const ai = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));

// Quota, overload and "model gone" errors are worth trying the next model for.
const SKIPPABLE = /"code":\s*(429|503|404)|UNAVAILABLE|RESOURCE_EXHAUSTED/;

/** Ask Gemini for a JSON reply. Returns the raw text; callers validate it. */
export async function askJson(prompt: string): Promise<string> {
  let last: unknown;
  for (const model of MODELS()) {
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
