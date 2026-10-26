// @vitest-environment jsdom
// Opening a booking from the upload list takes you to its problems and fixes, not to the top of the whole page.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import App from '../components/App';

let spy: any, scrollTo: any;
beforeEach(() => {
  spy = vi.fn(); Element.prototype.scrollIntoView = spy; scrollTo = vi.fn(); window.scrollTo = scrollTo as any;
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"enabled":false}', { status: 200 }))));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const openExample = async () => {
  render(<App />);
  fireEvent.click(within(screen.getByRole('navigation', { name: 'App' })).getByRole('button', { name: 'Try an example' }));
  for (let i = 0; i < 100 && !screen.queryByRole('link', { name: 'Open EX-003' }); i++) await act(async () => { await vi.advanceTimersByTimeAsync(20); await new Promise(r => setImmediate(r)); });
};
const lastTarget = () => (spy.mock.contexts.at(-1) as Element).id;
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(10); });

describe('opening a booking from the list', () => {
  it('clicking a red row brings the booking’s problems and fixes into view, and does not jump to the top of the page', async () => {
    await openExample();
    spy.mockClear(); scrollTo.mockClear();
    fireEvent.click(screen.getByRole('link', { name: 'Open EX-003' }));
    await settle();
    expect(screen.getByText(/What.s wrong and how to fix it/)).toBeTruthy();       // the correction view is showing
    expect(lastTarget()).toBe('start');
    expect(spy.mock.calls.at(-1)[0]).toMatchObject({ block: 'start' });
    expect(scrollTo).not.toHaveBeenCalled();                                           // the old behaviour: window.scrollTo({ top: 0 })
  });
  it('an amber row and the keyboard (Enter) do the same', async () => {
    await openExample();
    spy.mockClear();
    fireEvent.keyDown(screen.getByRole('link', { name: 'Open EX-002' }), { key: 'Enter' });
    await settle();
    expect(lastTarget()).toBe('start');
    expect(scrollTo).not.toHaveBeenCalled();
  });
  it('Next, Previous and Back to all bookings keep the results in view too', async () => {
    await openExample();
    fireEvent.click(screen.getByRole('link', { name: 'Open EX-002' })); await settle();
    for (const name of ['Next', 'Previous', 'Back to all bookings']) {
      spy.mockClear();
      fireEvent.click(screen.getByRole('button', { name })); await settle();
      expect(lastTarget(), name).toBe('start');
    }
    expect(screen.getByRole('link', { name: 'Open EX-003' })).toBeTruthy();            // back on the list
  });
  it('if the smooth scroll has not arrived a moment later, it jumps there', async () => {
    await openExample();
    spy.mockClear();
    fireEvent.click(screen.getByRole('link', { name: 'Open EX-003' })); await settle();
    const before = spy.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(spy.mock.calls.length).toBeGreaterThan(before);                       // (an earlier scroll from loading the example also checks in)
    expect(spy.mock.calls.at(-1)[0].behavior).toBe('auto');
    expect(lastTarget()).toBe('start');
  });
});
