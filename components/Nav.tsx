'use client';
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './ThemeToggle';

export type NavKey = 'chat' | 'upload' | 'example' | 'rulebook' | 'carriers' | 'about';

export const NAV_ITEMS: { key: Exclude<NavKey, 'about'>; label: string }[] = [
  { key: 'chat', label: 'Chat to book' },
  { key: 'upload', label: 'Upload a file' },
  { key: 'example', label: 'Try an example' },
  { key: 'rulebook', label: 'Rulebook' },
  { key: 'carriers', label: 'Carrier options' },
];

/**
 * Sticky header. Left: the five main views, then About. Right: New booking and the Light/Dark switch.
 * Under 700px the left group and the right-hand links are hidden by CSS and the Menu button takes over;
 * the Menu list is only in the page while it is open, so each item exists once at any time.
 */
export default function Nav({ current, onGo, onNew }: { current: NavKey; onGo: (k: NavKey) => void; onNew: () => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    const away = (e: Event) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', away);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', away); };
  }, [open]);

  const cur = (k: NavKey) => (current === k ? 'true' : undefined);
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };

  return (
    <nav className="topnav" aria-label="App">
      <div className="nav">
        <div className="brandrow">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>
          </span>
          <span className="wordmark">UK to EU shipments</span>
        </div>
        <ul className="navlinks">
          {NAV_ITEMS.map(i => (
            <li key={i.key}><button type="button" className="navlink" aria-current={cur(i.key)} onClick={() => onGo(i.key)}>{i.label}</button></li>
          ))}
          <li><a className="navlink" href="#about" aria-current={cur('about')} onClick={e => { e.preventDefault(); onGo('about'); }}>About</a></li>
        </ul>
        <div className="navright" ref={wrap}>
          <button ref={btn} type="button" className="navmenu-btn" aria-expanded={open} aria-controls="nav-menu" onClick={() => setOpen(o => !o)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>Menu
          </button>
          <button type="button" className="btn small ghost navnew" onClick={onNew}>New booking</button>
          <ThemeToggle />
          {open ? (
            <ul id="nav-menu" className="navmenu" aria-label="Menu">
              {NAV_ITEMS.map(i => (
                <li key={i.key}><button type="button" className="navlink" aria-current={cur(i.key)} onClick={pick(() => onGo(i.key))}>{i.label}</button></li>
              ))}
              <li><button type="button" className="navlink" onClick={pick(onNew)}>New booking</button></li>
              <li><a className="navlink" href="#about" aria-current={cur('about')} onClick={e => { e.preventDefault(); pick(() => onGo('about'))(); }}>About</a></li>
            </ul>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
