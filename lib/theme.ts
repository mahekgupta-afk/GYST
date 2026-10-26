// Theme choice: "light", "dark" or "system" (follow the device). Saved in localStorage when the browser allows it.
export type Theme = 'light' | 'dark' | 'system';
export const THEME_KEY = 'gyst-theme';

/** Runs in <head> before first paint so the page never flashes the wrong theme. Kept tiny and dependency-free. */
export const themeInitScript =
  "(function(){try{var t=localStorage.getItem('" + THEME_KEY + "');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();";

export function readTheme(): Theme {
  try { const t = window.localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; }
}

/** Applies the choice to the page and remembers it. Storage can be blocked (private windows), so every access is guarded. */
export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
  try { if (t === 'system') window.localStorage.removeItem(THEME_KEY); else window.localStorage.setItem(THEME_KEY, t); } catch { /* the choice still applies for this visit */ }
}
