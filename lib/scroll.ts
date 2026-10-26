// Smooth scroll to a section by id, leaving room for the sticky header (the sections carry scroll-margin-top).
// If a long smooth scroll has not arrived after a moment (a busy page can interrupt it), jump there.
const reduced = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function scrollToId(id: string): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(id);
  if (!el || !el.scrollIntoView) return;
  el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  if (reduced()) return;
  window.setTimeout(() => {
    const t = document.getElementById(id);
    const navH = parseFloat(document.documentElement.style.getPropertyValue('--nav-h')) || 70;
    if (t && Math.abs(t.getBoundingClientRect().top - (navH + 12)) > 40) t.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, 1100);
}

/** After the results view changes (a booking opens, or the list comes back), bring the top of the results into view once it has drawn. */
export function showResults(): void {
  if (typeof window === 'undefined') return;
  window.setTimeout(() => scrollToId('start'), 0);
}
