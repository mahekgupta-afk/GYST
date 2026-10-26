import { about as defaultContent, type AboutContent } from '@/content/about';

// Initials for a team circle: the ones given in the content file, otherwise taken from the name.
const initialsOf = (name: string, given?: string) =>
  (given && given.trim()) || name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

/** The About section. It only renders `content` (content/about.ts by default): change the words there, not here. */
export default function About({ content = defaultContent }: { content?: AboutContent }) {
  const c = content;
  return (
    <section className="card section about" id="about" aria-labelledby="about-h">
      <h2 id="about-h">{c.heading}</h2>
      <p className="about-tag">{c.tagline}</p>

      <h3>{c.whatWeDo.title}</h3>
      <p>{c.whatWeDo.intro}</p>
      <ul className="about-ways">
        {c.whatWeDo.ways.map((w, i) => (
          <li key={i} className="about-way"><h4>{w.title}</h4><p>{w.text}</p></li>
        ))}
      </ul>

      <h3>{c.why.title}</h3>
      <p>{c.why.text}</p>

      <h3>{c.howItWorks.title}</h3>
      <ol className="about-steps">{c.howItWorks.steps.map((t, i) => <li key={i}>{t}</li>)}</ol>

      <div className="about-grid">
        <div><h3>{c.whatWeCheck.title}</h3><ul>{c.whatWeCheck.items.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
        <div><h3>{c.scope.title}</h3><ul>{c.scope.items.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
      </div>

      <h3>{c.team.title}</h3>
      <p>{c.team.intro}</p>
      <ul className="about-team">
        {c.team.members.map((m, i) => (
          <li key={i} className="about-person">
            <span className="about-avatar" aria-hidden="true">{initialsOf(m.name, m.initials)}</span>
            <span><b>{m.name}</b><br /><span className="muted">{m.role}</span></span>
          </li>
        ))}
      </ul>

      <h3>{c.contact.title}</h3>
      <dl className="about-contact">
        <div><dt>{c.contact.emailLabel || 'Email'}</dt><dd><a href={'mailto:' + c.contact.email}>{c.contact.email}</a></dd></div>
        <div><dt>{c.contact.phoneLabel || 'Telephone'}</dt><dd><a href={'tel:' + c.contact.phoneLink}>{c.contact.phone}</a></dd></div>
      </dl>
    </section>
  );
}
