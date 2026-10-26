import { about as defaultContent, type AboutContent } from '@/content/about';

// Initials for a team circle: the ones given in the content file, otherwise taken from the name.
const initialsOf = (name: string, given?: string) =>
  (given && given.trim()) || name.replace(/^\s*\[placeholder\]\s*/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

/** The About section. It only renders `content` (content/about.ts by default): change the words there, not here. */
export default function About({ content = defaultContent }: { content?: AboutContent }) {
  const h = content.headings;
  return (
    <section className="card section about" id="about" aria-labelledby="about-h">
      <h2 id="about-h">{content.heading}</h2>
      <p className="about-tag">{content.tagline}</p>

      <div className="about-grid">
        <div><h3>{h.what}</h3><p>{content.what}</p></div>
        <div><h3>{h.why}</h3><p>{content.why}</p></div>
      </div>

      <h3>{h.how}</h3>
      <ol className="about-steps">{content.steps.map((t, i) => <li key={i}>{t}</li>)}</ol>

      <div className="about-grid">
        <div><h3>{h.checks}</h3><ul>{content.checks.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
        <div><h3>{h.scope}</h3><ul>{content.scope.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
      </div>

      <h3>{h.team}</h3>
      <ul className="about-team">
        {content.team.map((m, i) => (
          <li key={i} className="about-person">
            <span className="about-avatar" aria-hidden="true">{initialsOf(m.name, m.initials)}</span>
            <span><b>{m.name}</b><br /><span className="muted">{m.role}</span></span>
          </li>
        ))}
      </ul>

      <h3>{h.contact}</h3>
      <p>{content.contact}</p>
    </section>
  );
}
