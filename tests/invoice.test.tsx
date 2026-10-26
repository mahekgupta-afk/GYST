// @vitest-environment jsdom
// Reading an invoice in the chat: the reader copies, the shared validators and rulebook decide, and the chat asks only for what is missing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import App from '../components/App';
import { C, PF } from '../lib/pf';
import { guardInvoice } from '../lib/server/invoiceGuard';

const TRANSCRIPT = 'INVOICE Northfield Goods Ltd Ship to Berlin Germany SKU MUG-01 Ceramic coffee mug 350ml qty 1080 price GBP 5.00 amount GBP 5,400.00 HS 691200 Total GBP 5,400.00 Made in United Kingdom';
const good = (over: any = {}) => ({ isInvoice: true, currency: 'GBP', transcript: TRANSCRIPT, seller: 'Northfield Goods Ltd', destCity: 'Berlin', destCountry: 'Germany', declaredValue: 5400, cartons: null, pallets: null, grossWeight: null,
  items: [{ sku: 'MUG-01', desc: 'Ceramic coffee mug 350ml', hs: '691200', qty: 1080, price: 5, upc: null, cartons: null, unitWeight: null, coo: 'United Kingdom' }], ...over });

describe('guardInvoice: the reader may copy, never invent', () => {
  it('keeps values that are printed on the document', () => {
    const g = guardInvoice(good());
    expect(g.declaredValue).toBe(5400);
    expect(g.items[0]).toMatchObject({ sku: 'MUG-01', hs: '691200', qty: 1080, price: 5 });
  });
  it('drops numbers that are not in the printed text (a total it worked out itself, a guessed pallet count)', () => {
    const g = guardInvoice(good({ pallets: 3, grossWeight: 620, declaredValue: 5500, items: [{ ...good().items[0], cartons: 90, upc: 12, unitWeight: 0.5 }] }));
    expect(g.pallets).toBeNull();
    expect(g.grossWeight).toBeNull();
    expect(g.declaredValue).toBeNull();
    expect(g.items[0]).toMatchObject({ cartons: null, upc: null, unitWeight: null, qty: 1080 });
  });
  it('drops a SKU or HS code that is not printed', () => {
    const g = guardInvoice(good({ items: [{ ...good().items[0], sku: 'ZZ-99', hs: '999999' }] }));
    expect(g.items[0].sku).toBeNull();
    expect(g.items[0].hs).toBeNull();
  });
  it('treats a document with no transcript, or not marked as an invoice, as not an invoice', () => {
    expect(guardInvoice(good({ transcript: '' })).isInvoice).toBe(false);
    expect(guardInvoice(good({ isInvoice: false })).isInvoice).toBe(false);
  });
  it('keeps printed zero and negative values so the shared validators can refuse them with a message', () => {
    const g = guardInvoice(good({ transcript: TRANSCRIPT + ' -5 0', items: [{ ...good().items[0], qty: 0, price: -5 }] }));
    expect(g.items[0].qty).toBe(0);
    expect(g.items[0].price).toBe(-5);
  });
  it('caps the number of lines and ignores fields it was not asked for', () => {
    const many = Array.from({ length: 40 }, () => good().items[0]);
    const g: any = guardInvoice({ ...good({ items: many }), priority: 'Fastest', readyDate: '2030-01-01', destType: 'Warehouse' }, 25);
    expect(g.items).toHaveLength(25);
    expect(g.priority).toBeUndefined(); expect(g.readyDate).toBeUndefined(); expect(g.destType).toBeUndefined();
  });
});

describe('an invoice through the chat engine', () => {
  it('fills in the booking, keeps the printed SKU, and asks for what is missing', () => {
    const c = C.newChat();
    const log = C.stepAI(c, 'Invoice uploaded: x.png', C.aiToEx(guardInvoice(good()), c), { document: true });
    expect(c.b).toMatchObject({ seller: 'Northfield Goods Ltd', destCity: 'Berlin', destCountry: 'Germany', declaredValue: 5400 });
    expect(c.b.items[0]).toMatchObject({ sku: 'MUG-01', desc: 'Ceramic coffee mug 350ml', qty: 1080, price: 5, hs: '691200', coo: 'United Kingdom' });
    expect(c.b.readyDate).toBeNull();            // an invoice date is not a collection date
    expect(c.b.priority).toBeNull();
    expect(log.understood).toBe(true);
    expect(c.asked).toBeTruthy();                // still asks the seller for the rest
    expect(c.asked.key).toBe('basics');
    expect(c.asked.missing).toEqual(expect.arrayContaining(['route', 'destType', 'readyDate', 'priority']));
  });
  it('typed text still drops a SKU the seller did not type', () => {
    const c = C.newChat();
    C.stepAI(c, 'ship 100 mugs', C.aiToEx({ items: [{ sku: 'MUG-01', desc: 'mugs', qty: 100 }] }, c));
    expect(c.b.items[0].sku).toBeNull();
  });
  it('an invoice line with zero quantity is refused by the shared validators, not stored', () => {
    const c = C.newChat();
    const log = C.stepAI(c, 'Invoice uploaded: x.png', C.aiToEx(guardInvoice(good({ transcript: TRANSCRIPT + ' 0', items: [{ ...good().items[0], qty: 0 }] })), c), { document: true });
    expect(c.b.items[0]?.qty ?? null).toBeNull();
    expect(log.rejected.some((r: any) => r.field === 'qty')).toBe(true);
  });
  it('the rulebook, not the reader, judges the result: a carton-maths mistake on the invoice is flagged', () => {
    const c = C.newChat();
    C.stepAI(c, 'Invoice uploaded: x.png', C.aiToEx(guardInvoice(good({ transcript: TRANSCRIPT + ' 12 100', items: [{ ...good().items[0], upc: 12, cartons: 100 }] })), c), { document: true });
    const b = c.b; b.pallets = 3; b.cartons = 100; b.grossWeight = 700; b.appointment = 'Yes';
    expect(PF.evaluate(b).issues.map((i: any) => i.rule)).toContain('R-03');
  });
});

describe('in the chat', () => {
  const reply = (body: any, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  let calls: string[];
  let urls = 0;
  const setup = (invoiceReply: () => Promise<Response>, aiEnabled = true) => {
    calls = [];
    Element.prototype.scrollIntoView = vi.fn(); window.scrollTo = vi.fn() as any;
    URL.createObjectURL = vi.fn(() => 'blob:preview-' + ++urls) as any; URL.revokeObjectURL = vi.fn() as any;
    vi.stubGlobal('fetch', vi.fn((url: string) => { calls.push(String(url)); return String(url).includes('read-invoice') ? invoiceReply() : reply({ enabled: aiEnabled }); }));
  };
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  const attach = (name = 'inv.png', type = 'image/png') => {
    const input = screen.getByLabelText('Invoice file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], name, { type })] } });
  };
  const send = () => fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  const lastBot = () => [...document.querySelectorAll('.msg.bot')].at(-1)!.textContent!;

  it('shows no attach button when the reader is not available', async () => {
    setup(() => reply({}), false);
    render(<App />);
    await waitFor(() => expect(calls.some(u => u.includes('parse-message'))).toBe(true));
    expect(screen.queryByLabelText('Attach an invoice')).toBeNull();
  });

  it('reads an invoice, fills in the sheet and asks only for what is missing', async () => {
    setup(() => reply({ result: guardInvoice(good()) }));
    render(<App />);
    const btn = await screen.findByLabelText('Attach an invoice');
    expect(btn.hasAttribute('disabled')).toBe(false);
    attach(); send();
    await waitFor(() => expect(lastBot()).toContain('Here is what I read from your invoice'));
    const bot = lastBot();
    expect(bot).toContain('Please check it is right');
    expect(bot).toMatch(/I still need/);
    expect(bot).not.toMatch(/business name/);                                     // the seller was read from the invoice
    const sheet = document.querySelector('.right')!.textContent!;
    expect(sheet).toContain('Northfield Goods Ltd');
    expect(sheet).toContain('Berlin');
    expect(document.querySelector('.log')!.textContent).toContain('Invoice attached: inv.png');
    expect(calls.filter(u => u.includes('read-invoice'))).toHaveLength(1);
  });

  it('refuses an invoice in another currency and changes nothing', async () => {
    setup(() => reply({ result: guardInvoice(good({ currency: 'EUR' })) }));
    render(<App />);
    await screen.findByLabelText('Attach an invoice'); attach(); send();
    await waitFor(() => expect(lastBot()).toContain('This invoice is in EUR'));
    expect(document.querySelector('.right')!.textContent).not.toContain('Northfield');
  });

  it('says so when the file is not an invoice', async () => {
    setup(() => reply({ result: guardInvoice(good({ isInvoice: false })) }));
    render(<App />);
    await screen.findByLabelText('Attach an invoice'); attach(); send();
    await waitFor(() => expect(lastBot()).toContain('doesn’t look like an invoice'));
  });

  it('says which destination it cannot book', async () => {
    setup(() => reply({ result: guardInvoice(good({ destCity: 'Warsaw', destCountry: 'Poland' })) }));
    render(<App />);
    await screen.findByLabelText('Attach an invoice'); attach(); send();
    await waitFor(() => expect(lastBot()).toContain('delivers to Warsaw, Poland'));
  });

  it('a failed read keeps the booking and says what to do', async () => {
    setup(() => reply({ error: 'upstream' }, 502));
    render(<App />);
    await screen.findByLabelText('Attach an invoice'); attach(); send();
    await waitFor(() => expect(lastBot()).toContain('couldn’t read that invoice'));
    expect(lastBot()).toContain('Nothing has been changed');
  });

  it('refuses a file type it cannot read, without sending it', async () => {
    setup(() => reply({}));
    render(<App />);
    await screen.findByLabelText('Attach an invoice'); attach('notes.txt', 'text/plain'); send();
    await waitFor(() => expect(lastBot()).toContain('PNG, JPG or WebP'));
    expect(calls.some(u => u.includes('read-invoice'))).toBe(false);
  });

  it('is not stored: nothing but the reader and the AI-status check is called', async () => {
    setup(() => reply({ result: guardInvoice(good()) }));
    render(<App />);
    await screen.findByLabelText('Attach an invoice'); attach(); send();
    await waitFor(() => expect(lastBot()).toContain('Here is what I read'));
    expect(calls.filter(u => !u.includes('parse-message') && !u.includes('read-invoice'))).toEqual([]);
  });

  describe('review before sending', () => {
    const read = () => calls.filter(u => u.includes('read-invoice')).length;
    it('choosing a picture shows a preview and does NOT send it', async () => {
      setup(() => reply({ result: guardInvoice(good()) }));
      render(<App />);
      await screen.findByLabelText('Attach an invoice'); attach('inv.png');
      const img = await screen.findByAltText('Preview of inv.png') as HTMLImageElement;
      expect(img.getAttribute('src')).toMatch(/^blob:preview-/);
      expect(screen.getByRole('button', { name: 'Remove attachment' })).toBeTruthy();
      await new Promise(r => setTimeout(r, 50));
      expect(read()).toBe(0);
      expect(document.querySelector('.log')!.textContent).not.toContain('Invoice attached');
    });
    it('the X removes it without sending, and releases the preview address', async () => {
      setup(() => reply({}));
      render(<App />);
      await screen.findByLabelText('Attach an invoice'); attach();
      const img = await screen.findByAltText('Preview of inv.png');
      const url = img.getAttribute('src');
      fireEvent.click(screen.getByRole('button', { name: 'Remove attachment' }));
      expect(screen.queryByAltText('Preview of inv.png')).toBeNull();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
      expect(read()).toBe(0);
      expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);
    });
    it('choosing a different picture replaces the first and releases its address', async () => {
      setup(() => reply({}));
      render(<App />);
      await screen.findByLabelText('Attach an invoice'); attach('one.png');
      const first = (await screen.findByAltText('Preview of one.png')).getAttribute('src');
      attach('two.png');
      await screen.findByAltText('Preview of two.png');
      expect(screen.queryByAltText('Preview of one.png')).toBeNull();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(first);
    });
    it('Send is off with nothing to send, and on with text or with an attachment', async () => {
      setup(() => reply({}));
      render(<App />);
      await screen.findByLabelText('Attach an invoice');
      const btn = () => screen.getByRole('button', { name: 'Send' });
      expect(btn().hasAttribute('disabled')).toBe(true);
      fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'hello' } });
      expect(btn().hasAttribute('disabled')).toBe(false);
      fireEvent.change(screen.getByLabelText('Your message'), { target: { value: '' } });
      attach();
      await screen.findByAltText('Preview of inv.png');
      expect(btn().hasAttribute('disabled')).toBe(false);
    });
    it('Send reads the invoice once, then clears the preview and releases its address; the same file can be chosen again', async () => {
      setup(() => reply({ result: guardInvoice(good()) }));
      render(<App />);
      await screen.findByLabelText('Attach an invoice'); attach('inv.png');
      const url = (await screen.findByAltText('Preview of inv.png')).getAttribute('src');
      send();
      await waitFor(() => expect(lastBot()).toContain('Here is what I read'));
      expect(read()).toBe(1);
      expect(screen.queryByAltText('Preview of inv.png')).toBeNull();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
      expect((screen.getByLabelText('Invoice file') as HTMLInputElement).value).toBe('');
      attach('inv.png');                                                        // the same file again
      await screen.findByAltText('Preview of inv.png');
    });
    it('an attachment with a typed message sends the invoice first, then the message', async () => {
      setup(() => reply({ result: guardInvoice(good()) }));
      render(<App />);
      await screen.findByLabelText('Attach an invoice'); attach();
      await screen.findByAltText('Preview of inv.png');
      fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'ready date 5 Nov, cheapest' } });
      send();
      await waitFor(() => expect(document.querySelectorAll('.msg.user').length).toBe(2));
      const users = [...document.querySelectorAll('.msg.user')].map(e => e.textContent);
      expect(users).toEqual(['Invoice attached: inv.png', 'ready date 5 Nov, cheapest']);
      await waitFor(() => expect((screen.getByLabelText('Your message') as HTMLTextAreaElement).value).toBe(''));
      expect(read()).toBe(1);
    });
    it('a PDF shows a file tile instead of a thumbnail', async () => {
      setup(() => reply({}));
      render(<App />);
      await screen.findByLabelText('Attach an invoice'); attach('inv.pdf', 'application/pdf');
      await waitFor(() => expect(document.querySelector('.attachdoc')!.textContent).toBe('PDF'));
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });
    it('Enter sends the attachment too', async () => {
      setup(() => reply({ result: guardInvoice(good()) }));
      render(<App />);
      await screen.findByLabelText('Attach an invoice'); attach();
      await screen.findByAltText('Preview of inv.png');
      fireEvent.keyDown(screen.getByLabelText('Your message'), { key: 'Enter' });
      await waitFor(() => expect(lastBot()).toContain('Here is what I read'));
    });
  });
});
