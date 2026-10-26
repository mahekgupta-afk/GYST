// Theme choice: "light" or "dark". Saved in localStorage when the browser allows it.
// Before anything is saved, the page follows the device's setting (see globals.css), so a first visit looks right too.
export type Theme = 'light' | 'dark';
export const THEME_KEY = 'gyst-theme';

/** Runs in <head> before first paint so the page never flashes the wrong theme. Kept tiny and dependency-free. */
export const themeInitScript =
  "(function(){try{var t=localStorage.getItem('" + THEME_KEY + "');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();";

/** The saved choice, or null if the visitor has not chosen yet. */
export function readTheme(): Theme | null {
  try { const t = window.localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : null; } catch { return null; }
}

/** What the page is showing right now: the saved choice, otherwise the device's setting. */
export function effectiveTheme(): Theme {
  const saved = readTheme();
  if (saved) return saved;
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'light'; }
}

/** Applies the choice to the page and remembers it. Storage can be blocked (private windows), so every access is guarded. */
export function applyTheme(t: Theme): void {
  document.documentElement.setAttribute('data-theme', t);
  try { window.localStorage.setItem(THEME_KEY, t); } catch { /* the choice still applies for this visit */ }
}
