// Reading a file with Gemini: models are raced, each told to think little, and a slow or failing one never holds the read up.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Call = { model: string; config: any; abort: () => boolean };
const state = vi.hoisted(() => ({ calls: [] as any[], behave: {} as Record<string, (c: any) => Promise<{ text: string }>> }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class { models = { generateContent: (req: any) => { state.calls.push(req); return (state.behave[req.model] || (() => Promise.resolve({ text: '{"ok":true}' })))(req); } }; },
}));
import { askJsonAboutFile } from '../lib/server/gemini';

const MODELS = ['m1', 'm2', 'm3'];
const never = (req: any) => new Promise<{ text: string }>((_res, rej) => req.config.abortSignal.addEventListener('abort', () => rej(new Error('aborted'))));
const after = (ms: number, text: string) => (req: any) => new Promise<{ text: string }>((res, rej) => { const t = setTimeout(() => res({ text }), ms); req.config.abortSignal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }); });
const fail = (msg: string) => () => Promise.reject(new Error(msg));
const run = () => askJsonAboutFile('read it', 'image/png', 'AAAA');

beforeEach(() => { vi.useFakeTimers(); state.calls.length = 0; state.behave = {}; process.env.GEMINI_API_KEY = 'test'; process.env.GEMINI_VISION_MODEL = MODELS.join(','); });
afterEach(() => { vi.useRealTimers(); delete process.env.GEMINI_VISION_MODEL; });

describe('askJsonAboutFile', () => {
  it('sends the file and prompt, and asks the model to think as little as possible', async () => {
    state.behave.m1 = () => Promise.resolve({ text: '{"a":1}' });
    expect(await run()).toBe('{"a":1}');
    const req = state.calls[0];
    expect(req.contents[0].parts).toEqual([{ text: 'read it' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' } }]);
    expect(req.config).toMatchObject({ responseMimeType: 'application/json', temperature: 0, thinkingConfig: { thinkingLevel: 'minimal' } });
  });
  it('a model that fails at once is replaced straight away by the next', async () => {
    state.behave.m1 = fail('{"error":{"code":503,"message":"high demand"}}');
    state.behave.m2 = () => Promise.resolve({ text: 'from m2' });
    expect(await run()).toBe('from m2');
    expect(state.calls.map(c => c.model)).toEqual(['m1', 'm2']);
  });
  it('a slow model does not hold the read up: the next joins after a few seconds and the first good answer wins', async () => {
    state.behave.m1 = never;
    state.behave.m2 = after(3000, 'from m2');
    const p = run();
    await vi.advanceTimersByTimeAsync(4999);
    expect(state.calls.map(c => c.model)).toEqual(['m1']);                     // not yet
    await vi.advanceTimersByTimeAsync(2);
    expect(state.calls.map(c => c.model)).toEqual(['m1', 'm2']);
    await vi.advanceTimersByTimeAsync(3100);
    expect(await p).toBe('from m2');
  });
  it('once there is an answer, the models still running are cancelled', async () => {
    state.behave.m1 = never; state.behave.m2 = after(100, 'fast');
    const p = run();
    await vi.advanceTimersByTimeAsync(5200);
    await vi.advanceTimersByTimeAsync(200);
    expect(await p).toBe('fast');
    expect(state.calls[0].config.abortSignal.aborted).toBe(true);
    expect(state.calls.length).toBe(2);                                         // m3 was never started
  });
  it('an empty reply counts as a failure and the next model is tried', async () => {
    state.behave.m1 = () => Promise.resolve({ text: '   ' });
    state.behave.m2 = () => Promise.resolve({ text: 'real' });
    expect(await run()).toBe('real');
  });
  it('a model that does not accept the think-less setting is asked again without it', async () => {
    state.behave.m1 = (req: any) => req.config.thinkingConfig ? Promise.reject(new Error('{"error":{"code":400,"status":"INVALID_ARGUMENT","message":"thinking level not supported"}}')) : Promise.resolve({ text: 'plain' });
    expect(await run()).toBe('plain');
    expect(state.calls.map(c => [c.model, !!c.config.thinkingConfig])).toEqual([['m1', true], ['m1', false]]);
  });
  it('when every model fails, the read fails with the last error', async () => {
    for (const m of MODELS) state.behave[m] = fail('boom ' + m);
    await expect(run()).rejects.toThrow('boom m3');
    expect(state.calls.map(c => c.model)).toEqual(MODELS);
  });
  it('gives up at the deadline when the models never answer, leaving time for the page to say so', async () => {
    for (const m of MODELS) state.behave[m] = never;
    const p = run().catch(e => e as Error);
    await vi.advanceTimersByTimeAsync(36100);
    expect(((await p) as Error).message).toBeTruthy();
    expect(state.calls.every(c => c.config.abortSignal.aborted)).toBe(true);
  });
  it('the deadline fits inside the page and server limits', async () => {
    const route = (await import('node:fs')).readFileSync('app/api/read-invoice/route.ts', 'utf8');
    const client = (await import('node:fs')).readFileSync('lib/invoice.ts', 'utf8');
    expect(Number(/maxDuration = (\d+)/.exec(route)![1])).toBeGreaterThanOrEqual(40);
    expect(Number(/INVOICE_TIMEOUT_MS = (\d+)/.exec(client)![1])).toBeGreaterThan(36000);
  });
});
