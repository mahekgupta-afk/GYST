// @vitest-environment jsdom
// In the app, a suggested fix shows a before → after preview and changes nothing until it is confirmed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import App from '../components/App';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn(); window.scrollTo = vi.fn() as any;
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"enabled":false}', { status: 200 }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const openExample = async (id: string) => {
  render(<App />);
  fireEvent.click(within(screen.getByRole('navigation', { name: 'App' })).getByRole('button', { name: 'Try an example' }));
  fireEvent.click(await screen.findByRole('link', { name: 'Open ' + id }));
};
const suggested = () => screen.getByRole('button', { name: /Set declared value to £5,100/ });

describe('suggested fixes in the app', () => {
  it('click shows a preview with before and after, and the booking is not changed yet', async () => {
    await openExample('EX-003');
    expect(screen.getAllByText(/Declared value doesn.t match/i).length).toBeGreaterThan(0);
    fireEvent.click(suggested());
    const box = screen.getByRole('group', { name: /Preview: Set declared value/ });
    expect(box.textContent).toContain('Nothing has changed yet');
    expect(within(box).getByText('4000')).toBeTruthy();                       // before
    expect(within(box).getByText('5100')).toBeTruthy();                       // after
    expect(box.textContent).toMatch(/Fixed: R-02/);
    expect(screen.getAllByText(/Declared value doesn.t match/i).length).toBeGreaterThan(0);   // still open
  });
  it('Cancel leaves everything as it was', async () => {
    await openExample('EX-003');
    fireEvent.click(suggested());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: /Preview:/ })).toBeNull();
    expect(screen.getAllByText(/Declared value doesn.t match/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Started with/)).not.toBeNull();
    expect(document.body.textContent).not.toContain('Reset to original');      // nothing was changed or logged
  });
  it('Apply fix changes the booking, re-runs the checks and logs the change', async () => {
    await openExample('EX-003');
    fireEvent.click(suggested());
    fireEvent.click(screen.getByRole('button', { name: 'Apply fix' }));
    await waitFor(() => expect(screen.queryByText(/Declared value doesn.t match/i)).toBeNull());
    expect(screen.queryByRole('group', { name: /Preview:/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reset to original' })).toBeTruthy();
    expect(document.body.textContent).toContain('Total declared value (£)');       // the change log shows the field
  });
  it('R-01 offers no automatic fix, only a field for the user to fill in', async () => {
    await openExample('EX-003');
    expect(screen.getByLabelText(/HS code for TOTE-01/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Set HS code to/ })).toBeNull();
  });
});
