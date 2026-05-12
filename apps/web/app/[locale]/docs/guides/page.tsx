import { Link } from '@/i18n/navigation';
import { GuidesSidebar } from '../_components/guides-sidebar';
import { GUIDES, GUIDE_GROUPS, guidesByCategory } from './_lib/guides';

export const metadata = {
  title: 'Munin · Guides',
  description: 'Long-form articles that explain a single piece of Munin end-to-end.',
};

export default function GuidesIndex() {
  const featured = GUIDES.find((g) => g.featured);
  const byCategory = guidesByCategory();
  return (
    <>
    <GuidesSidebar />
    <main className="docs-main">
      <header className="docs-hero">
        <div className="eyebrow">Section · Guides</div>
        <h1>
          How things <em>actually</em> work.
        </h1>
        <p className="lede">
          Long-form articles that explain a single piece of Munin end-to-end — the chat widget, the
          hand-over flow, the audiences model. Pair them with the reference docs on the other tabs.
        </p>
      </header>

      {featured && (
        <Link className="guide-feature" href={`/docs/guides/${featured.slug}`}>
          <div className="feat-l">
            <div className="feat-eyebrow">
              Featured ·{' '}
              {GUIDE_GROUPS.find((g) => g.id === featured.category)?.label ?? featured.category}
            </div>
            <h2 className="feat-title">{featured.title}</h2>
            <p className="feat-kick">{featured.kicker}</p>
            <div className="feat-meta">
              <span>{featured.minutes} min read</span>
              <span>·</span>
              <span>updated {featured.updated}</span>
              <span className="feat-go">Read the article →</span>
            </div>
          </div>
          <div className="feat-r" aria-hidden="true">
            <div className="feat-marks">
              <span className="mk mk-a">&lt;script&gt;</span>
              <span className="mk mk-b">munin.push</span>
              <span className="mk mk-c">identify</span>
              <span className="mk mk-d">handover</span>
            </div>
          </div>
        </Link>
      )}

      {GUIDE_GROUPS.map((grp) => {
        const list = (byCategory.get(grp.id) ?? []).filter((g) => !g.featured);
        if (list.length === 0) return null;
        return (
          <section key={grp.id} id={`guides-${grp.id}`} style={{ marginTop: 56 }}>
            <h2 className="tag-h">
              {grp.label} <span className="ct">{list.length} articles</span>
            </h2>
            <p className="tag-blurb">{grp.blurb}</p>
            <div className="guide-grid">
              {list.map((g) => (
                <Link key={g.slug} className="guide-card" href={`/docs/guides/${g.slug}`}>
                  <div className="gc-eyebrow">{grp.label}</div>
                  <h3>{g.title}</h3>
                  <p className="gc-kick">{g.kicker}</p>
                  <div className="gc-foot">
                    <span>{g.minutes} min</span>
                    <span>·</span>
                    <span>updated {g.updated}</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </main>
    </>
  );
}
