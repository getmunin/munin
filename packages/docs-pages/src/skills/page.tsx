import { Link } from '../i18n-navigation';
import { groupByModule, wordCount } from '../_lib/skills';
import { SkillsSidebar } from '../_components/skills-sidebar';

export default function SkillsIndex() {
  const groups = groupByModule();
  return (
    <>
      <SkillsSidebar groups={groups} />
      <main className="docs-main">
        <header className="docs-hero">
          <div className="eyebrow">Section · Skills Library</div>
          <h1>
            How your agent <em>works</em>.
          </h1>
          <p className="lede">
            Markdown procedures the agent can read at runtime, written by humans who know the domain.
          </p>
        </header>
        {groups.map((g) => (
          <section key={g.module}>
            <h2 className="tag-h">
              {g.module} <span className="ct">{g.skills.length}</span>
            </h2>
            <div className="skill-grid">
              {g.skills.map((s) => (
                <Link key={s.uri} className="skill-card" href={`/docs/skills/${s.module}/${s.slug}`}>
                  <div className="uri">
                    <span className="scheme">skill://</span>
                    {s.module}/{s.slug}
                  </div>
                  <h3>{s.title}</h3>
                  <p className="desc">{s.description}</p>
                  <div className="foot">
                    <span>{wordCount(s.content).toLocaleString()} words</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </main>
    </>
  );
}
