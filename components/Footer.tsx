'use client';
import { useEffect, useState } from 'react';
import { about } from '@/content/about';
import type { NavKey } from './Nav';

const LINKS: [NavKey, string][] = [['chat', 'Chat to book'], ['upload', 'Upload a file'], ['example', 'Try an example'], ['rulebook', 'Rulebook'], ['carriers', 'Carrier options'], ['about', 'About']];

/** Multi-column footer built from the About content and the app's own navigation. */
export default function Footer({ onGo }: { onGo: (k: NavKey) => void }) {
  // The year is read in the browser: the page is built ahead of time, so reading the clock while building is not allowed.
  const [year, setYear] = useState('');
  useEffect(() => { setYear(String(new Date().getFullYear())); }, []);
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-col footer-brand">
          <div className="footer-name">GYST Shipments</div>
          <p>{about.tagline}</p>
          <p className="footer-fine">{about.scope.items[0]}.</p>
        </div>
        <nav className="footer-col" aria-label="Quick links">
          <h2 className="footer-h">Quick links</h2>
          <ul>{LINKS.map(([k, label]) => <li key={k}><button type="button" onClick={() => onGo(k)}>{label}</button></li>)}</ul>
        </nav>
        <div className="footer-col">
          <h2 className="footer-h">{about.contact.title}</h2>
          <ul>
            <li><a href={'mailto:' + about.contact.email}>{about.contact.email}</a></li>
            <li><a href={'tel:' + about.contact.phoneLink}>{about.contact.phone}</a></li>
          </ul>
        </div>
        <div className="footer-col">
          <h2 className="footer-h">Scope and limits</h2>
          <ul className="footer-fine">{about.scope.items.slice(1, 4).map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      </div>
      <div className="footer-bar">© {year} Get Your Ship Together. Checks run in the browser using fixed rules.</div>
    </footer>
  );
}
