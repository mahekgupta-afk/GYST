// The invoice route: input checks, and that a good read goes through the guard. The AI reader itself is replaced by a stub.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ask = vi.fn();
let enabled = true;
vi.mock('../lib/server/gemini', () => ({ geminiEnabled: () => enabled, askJsonAboutFile: (...a: any[]) => ask(...a) }));
let ipCounter = 0;
vi.mock('../lib/server/rateLimit', () => ({ allow: () => true, clientIp: () => 'ip-' + ipCounter++ }));

import { POST } from '../app/api/read-invoice/route';

const send = (file?: File | null, extra: Record<string, string> = {}) => {
  const form = new FormData();
  if (file) form.append('file', file);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return POST(new Request('http://x/api/read-invoice', { method: 'POST', body: form }));
};
const png = (n = 10) => new File([new Uint8Array(n).fill(1)], 'inv.png', { type: 'image/png' });
beforeEach(() => { ask.mockReset(); enabled = true; });

describe('/api/read-invoice', () => {
  it('is off when no AI key is set', async () => {
    enabled = false;
    expect((await send(png())).status).toBe(503);
    expect(ask).not.toHaveBeenCalled();
  });
  it('rejects a request with no file, a wrong type, an empty file and an oversized file, without calling the reader', async () => {
    expect((await send(null, { x: '1' })).status).toBe(400);
    expect((await send(new File(['x'], 'a.txt', { type: 'text/plain' }))).status).toBe(415);
    expect((await send(new File([], 'a.png', { type: 'image/png' }))).status).toBe(400);
    expect((await send(png(4 * 1024 * 1024 + 1))).status).toBe(413);
    expect(ask).not.toHaveBeenCalled();
  });
  it('accepts PNG, JPEG, WebP and PDF', async () => {
    ask.mockResolvedValue(JSON.stringify({ isInvoice: false, transcript: '' }));
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']) expect((await send(new File(['x'], 'f', { type }))).status).toBe(200);
  });
  it('passes the file to the reader and returns only guarded values', async () => {
    ask.mockResolvedValue(JSON.stringify({ isInvoice: true, currency: 'GBP', transcript: 'Acme Ltd Qty 10 GBP 5.00', seller: 'Acme Ltd', destCity: 'Paris', destCountry: 'France', declaredValue: 99999, pallets: 4,
      items: [{ desc: 'Mugs', qty: 10, price: 5, sku: 'NOPE-1' }] }));
    const res = await send(png());
    const { result } = await res.json();
    expect(ask.mock.calls[0][1]).toBe('image/png');
    expect(result.seller).toBe('Acme Ltd');
    expect(result.declaredValue).toBeNull();          // not printed, so dropped
    expect(result.pallets).toBeNull();
    expect(result.items[0]).toMatchObject({ qty: 10, price: 5, sku: null });
  });
  it('reports an unreadable or failed read without leaking details', async () => {
    ask.mockResolvedValue('not json');
    expect((await send(png())).status).toBe(502);
    ask.mockRejectedValue(new Error('secret upstream detail'));
    const res = await send(png());
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });
});
