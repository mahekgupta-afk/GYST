'use client';
import { useState } from 'react';
import { PF } from '@/lib/pf';
import { about } from '@/content/about';
import { home as defaultHome, type HomeContent } from '@/content/home';
import type { NavKey } from './Nav';
import LandingTerminal from './LandingTerminal';
import Reveal from './Reveal';
import CountUp from './CountUp';
import { Icon, type IconName } from './icons';

type Go = (k: NavKey) => void;

/** Decorative shipping routes behind the headline: dashed lines that drift, and a few city dots. Pure CSS/SVG, no media files. */
function RouteLines() {
  return (
    <svg className="routes" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <g fill="none" strokeWidth="1.4" strokeLinecap="round">
        <path className="route r1" d="M-20 560 C 220 520, 300 300, 520 330 S 860 160, 1230 120" />
        <path className="route r2" d="M-20 420 C 180 440, 360 520, 560 470 S 900 380, 1230 430" />
        <path className="route r3" d="M-20 200 C 260 150, 420 260, 640 210 S 980 300, 1230 260" />
      </g>
      <g className="dots">
        <circle cx="520" cy="330" r="5" /><circle cx="860" cy="170" r="5" /><circle cx="560" cy="470" r="5" /><circle cx="640" cy="210" r="5" /><circle cx="980" cy="300" r="5" />
      </g>
    </svg>
  );
}

export function Hero({ onGo, content = defaultHome }: { onGo: Go; content?: HomeContent }) {
  const [mode, setMode] = useState<'chat' | 'upload' | 'example'>('chat');
  const pills: [typeof mode, string][] = [['chat', 'Chat to book'], ['upload', 'Upload a file'], ['example', 'Try an example']];
  return (
    <section className="landing" aria-labelledby="landing-h">
      <RouteLines />
      <div className="landing-inner">
        <div className="landing-top">
          <div className="landing-eyebrow">{content.eyebrow}</div>
          <h1 className="landing-h1" id="landing-h">{content.headline.map((l, i) => <span key={i} className="landing-line">{l}</span>)}</h1>
          <p className="landing-tagline">{content.tagline}</p>
          <p className="landing-sub">{content.sub}</p>
        </div>
        <div className="landing-copy">
          <div className="herocard" role="group" aria-label={content.heroCard.title}>
            <div className="herocard-title">{content.heroCard.title}</div>
            <div className="herocard-pills">
              {pills.map(([k, label]) => <button key={k} type="button" className="hpill" aria-pressed={mode === k} onClick={() => { setMode(k); onGo(k); }}>{label}</button>)}
            </div>
            <button type="button" className="btn herocard-go" onClick={() => onGo(mode)}>{content.heroCard.primary} →</button>
          </div>
        </div>
        <LandingTerminal />
      </div>
    </section>
  );
}

export function StatsStrip({ content = defaultHome }: { content?: HomeContent }) {
  const carriers = new Set<string>(PF.CARRIERS.map((c: any) => c.carrier)).size;
  const countries = new Set<string>(PF.CARRIERS.map((c: any) => c.dest)).size;
  const items: [number, string][] = [[PF.RULES.length, 'Fixed pre-flight rules'], [carriers, 'Carriers compared'], [countries, 'EU destination countries'], [PF.ORIGINS.length, 'UK collection cities']];
  return (
    <section className="stats" aria-label={content.stats.title}>
      <ul className="stats-grid">
        {items.map(([n, label]) => (
          <li key={label}><b className="stat-n"><CountUp to={n} /></b><span className="stat-l">{label}</span></li>
        ))}
      </ul>
    </section>
  );
}

export function WaysSection({ onGo, content = defaultHome }: { onGo: Go; content?: HomeContent }) {
  const cards: { icon: IconName; title: string; text: string; to: NavKey }[] = [
    { icon: 'chat', title: about.whatWeDo.ways[0]?.title ?? 'Chat to book', text: about.whatWeDo.ways[0]?.text ?? '', to: 'chat' },
    { icon: 'upload', title: about.whatWeDo.ways[1]?.title ?? 'Upload a file', text: about.whatWeDo.ways[1]?.text ?? '', to: 'upload' },
    { icon: 'play', title: content.ways.thirdTitle, text: content.ways.thirdText, to: 'example' },
  ];
  return (
    <section className="band" aria-labelledby="ways-h">
      <div className="band-inner">
        <Reveal><h2 className="band-h" id="ways-h">{content.ways.title}</h2></Reveal>
        <ul className="cardgrid">
          {cards.map((c, i) => (
            <li key={c.title}>
              <Reveal className="icard" delay={i * 80}>
                <span className="icard-icon"><Icon name={c.icon} /></span>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
                <button type="button" className="knowmore" onClick={() => onGo(c.to)}>{content.ways.more} <span aria-hidden="true">→</span><span className="sr"> about {c.title}</span></button>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const CHECK_ICONS: IconName[] = ['hash', 'money', 'box', 'scale', 'alert', 'calendar', 'globe', 'clock'];
export function ChecksSection({ content = defaultHome }: { content?: HomeContent }) {
  return (
    <section className="band band-alt" aria-labelledby="checks-h">
      <div className="band-inner">
        <Reveal><h2 className="band-h" id="checks-h">{content.checks.title}</h2></Reveal>
        <ul className="cardgrid cardgrid-4">
          {about.whatWeCheck.items.map((text, i) => (
            <li key={i}>
              <Reveal className="icard icard-sm" delay={(i % 4) * 70}>
                <span className="icard-icon"><Icon name={CHECK_ICONS[i % CHECK_ICONS.length]} /></span>
                <h3>{content.checks.short[i] ?? 'Check ' + (i + 1)}</h3>
                <p>{text}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const FEATURE_ICONS: IconName[] = ['shield', 'route', 'edit', 'file'];
export function FeaturesSection({ content = defaultHome }: { content?: HomeContent }) {
  return (
    <section className="band" aria-labelledby="features-h">
      <div className="band-inner">
        <Reveal><h2 className="band-h" id="features-h">{content.features.title}</h2></Reveal>
        <ul className="featrow">
          {content.features.items.map((f, i) => (
            <li key={f.title}>
              <Reveal className="feat" delay={i * 80}>
                <span className="feat-icon"><Icon name={FEATURE_ICONS[i % FEATURE_ICONS.length]} size={26} /></span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
