'use client';
import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Fades and slides its content in once, as it scrolls into view. Content is fully visible until the browser has
 * loaded this script (so it never stays hidden if scripts fail), and always visible with reduced motion or without
 * IntersectionObserver.
 */
export default function Reveal({ as: Tag = 'div', className = '', delay = 0, children }: { as?: ElementType; className?: string; delay?: number; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<'visible' | 'hidden' | 'shown'>('visible');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined' || reduced()) return;
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) return;           // already on screen: leave it alone
    setState('hidden');
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setState('shown'); io.disconnect(); } }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} className={(className + ' reveal ' + (state === 'hidden' ? 'is-hidden' : state === 'shown' ? 'is-shown' : '')).trim()} style={delay ? { transitionDelay: delay + 'ms' } : undefined}>{children}</Tag>
  );
}
