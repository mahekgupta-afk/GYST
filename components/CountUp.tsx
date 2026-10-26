'use client';
import { useEffect, useRef, useState } from 'react';

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Shows the final number, then counts up from 0 the first time it scrolls into view. */
export default function CountUp({ to, suffix = '', ms = 1100 }: { to: number; suffix?: string; ms?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(to);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined' || reduced()) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const run = () => {
      const t0 = Date.now();
      setN(0);
      timer = setInterval(() => {
        const p = Math.min(1, (Date.now() - t0) / ms);
        setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p >= 1 && timer) { clearInterval(timer); timer = undefined; }
      }, 30);
    };
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { io.disconnect(); run(); } }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); if (timer) clearInterval(timer); };
  }, [to, ms]);
  return <span ref={ref}><span aria-hidden="true">{n}{suffix}</span><span className="sr">{to}{suffix}</span></span>;
}
