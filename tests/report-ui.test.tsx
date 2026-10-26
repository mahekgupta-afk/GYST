// @vitest-environment jsdom
// The report buttons in the app: one booking, and the whole upload.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import App from '../components/App';

// jsPDF's save() is created inside each document, so the library is wrapped: documents are real, but saving goes to a spy.
const hooks = vi.hoisted(() => ({ save: (_n: string) => {} }));
vi.mock('jspdf', async importOriginal => {
  const real: any = await importOriginal();
  const Wrapped = function (...a: any[]) { const d = new real.jsPDF(...a); d.save = (n: string) => hooks.save(n); return d; } as any;
  return { ...real, jsPDF: Wrapped };
});

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn(); window.scrollTo = vi.fn() as any;
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"enabled":false}', { status: 200 }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const example = async () => { render(<App />); fireEvent.click(within(screen.getByRole('navigation', { name: 'App' })).getByRole('button', { name: 'Try an example' })); await screen.findByRole('link', { name: 'Open EX-001' }); };

describe('check report buttons', () => {
  it('the whole-file report downloads one PDF named after the file', async () => {
    const save = vi.fn(); hooks.save = save;
    await example();
    fireEvent.click(screen.getByRole('button', { name: 'Download check report (PDF)' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toBe('gyst-check-report-Example-data.pdf');
  });
  it('a booking report downloads one PDF named after the booking', async () => {
    const save = vi.fn(); hooks.save = save;
    await example();
    fireEvent.click(screen.getByRole('link', { name: 'Open EX-003' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download check report (PDF)' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toBe('gyst-check-report-EX-003.pdf');
  });
  it('if the PDF cannot be created it says so and the page keeps working', async () => {
    hooks.save = () => { throw new Error('boom'); };
    await example();
    fireEvent.click(screen.getByRole('link', { name: 'Open EX-003' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download check report (PDF)' }));
    expect(await screen.findByText('The PDF could not be created. Please try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download check report (PDF)' }).hasAttribute('disabled')).toBe(false);
  });
});
