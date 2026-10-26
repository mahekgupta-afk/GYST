'use client';
import { useEffect, useState } from 'react';
import { applyTheme, readTheme, type Theme } from '@/lib/theme';

const OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg> },
  { value: 'dark', label: 'Dark', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg> },
  { value: 'system', label: 'System', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg> },
];

export default function ThemeToggle() {
  // The server cannot know the saved choice, so start on "system" and read the real one once the page is in the browser.
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => { setTheme(readTheme()); }, []);
  return (
    <div className="theme" role="group" aria-label="Colour theme">
      {OPTIONS.map(o => (
        <button key={o.value} type="button" aria-pressed={theme === o.value} title={o.label + (o.value === 'system' ? ' (follow your device)' : '')}
          onClick={() => { setTheme(o.value); applyTheme(o.value); }}>
          {o.icon}<span className="lbl">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
