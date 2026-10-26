// /api/parse-message: the AI is optional. A failure or a hang never reaches the seller, is logged once with the real error,
// and switches the AI off for a while so the built-in parser answers at once.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({ behave: null as null | ((req: any) => Promise<{ text: string }>), calls: 0 }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class { models = { generateContent: (req: any) => { state.calls++; return state.behave!(req); } }; },
}));

const post = (route: any, text = 'add a pallet') => route.POST(new Request('http://x/api/parse-message', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.' + Math.floor(Math.random() * 200) }, body: JSON.stringify({ booking: { items: [] }, text }) }));

let errors: any[];
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); state.calls = 0; errors = []; vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a); }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete process.env.GEMINI_API_KEY; });

describe('GET /api/parse-message', () => {
  it('says {"enabled": false} when there is no key', async () => {
    delete process.env.GEMINI_API_KEY;
    const route = await import('../app/api/parse-message/route');
    expect(await (await route.GET()).json()).toEqual({ enabled: false });
  });
  it('says enabled with a key, and disabled after a failure', async () => {
    process.env.GEMINI_API_KEY = 'k';
    state.behave = () => Promise.reject(new Error('{"error":{"code":401,"message":"API key not valid"}}'));
    const route = await import('../app/api/parse-message/route');
    expect(await (await route.GET()).json()).toEqual({ enabled: true });
    expect((await post(route)).status).toBe(502);
    expect(await (await route.GET()).json()).toEqual({ enabled: false });
  });
});

describe('POST /api/parse-message', () => {
  it('a failing call returns 502 at once, prints the real error once, and later calls do not reach Gemini', async () => {
    process.env.GEMINI_API_KEY = 'k';
    state.behave = () => Promise.reject(new Error('{"error":{"code":401,"message":"API key not valid"}}'));
    const route = await import('../app/api/parse-message/route');
    expect((await post(route)).status).toBe(502);
    expect((await post(route)).status).toBe(503);
    expect(state.calls).toBe(1);
    expect(errors.length).toBe(1);
    expect(String(errors[0].join(' '))).toContain('API key not valid');
  });
  it('a call that hangs is cut off after 4 s with an AbortController', async () => {
    process.env.GEMINI_API_KEY = 'k';
    let signal: AbortSignal | undefined;
    state.behave = req => new Promise((_res, rej) => { signal = req.config.abortSignal; signal!.addEventListener('abort', () => rej(new Error('aborted'))); });
    const route = await import('../app/api/parse-message/route');
    const p = post(route);
    await vi.advanceTimersByTimeAsync(3900);
    expect(signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    const res = await p;
    expect(signal!.aborted).toBe(true);
    expect(res.status).toBe(502);
    expect(errors[0].join(' ')).toMatch(/timed out after 4000 ms/);
  });
  it('asks the model to think as little as it can', async () => {
    process.env.GEMINI_API_KEY = 'k';
    let cfg: any;
    state.behave = req => { cfg = req.config; return Promise.resolve({ text: '{"booking":{}}' }); };
    const route = await import('../app/api/parse-message/route');
    await post(route);
    expect(cfg.thinkingConfig).toEqual({ thinkingLevel: 'minimal' });
    expect(cfg.httpOptions.timeout).toBe(4000);
  });
});
