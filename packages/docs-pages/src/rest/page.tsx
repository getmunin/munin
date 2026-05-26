import {
  listEndpoints,
  groupByTag,
  tagSlug,
  prettifyTag,
  type EndpointEntry,
} from '../_lib/openapi';
import { RestEndpoint } from '../_components/rest-endpoint';
import { RestSidebar } from '../_components/rest-sidebar';

export interface RestIndexProps {
  extraEndpoints?: EndpointEntry[];
}

export default function RestIndex({ extraEndpoints }: RestIndexProps = {}) {
  const groups = groupByTag([...listEndpoints(), ...(extraEndpoints ?? [])]);
  return (
    <>
      <RestSidebar groups={groups} />
      <main className="docs-main">
        <header className="docs-hero">
          <div className="eyebrow">Section · REST</div>
          <h1>
            The HTTP <em>surface area</em>.
          </h1>
          <p className="lede">
            Endpoints across conversations, CRM, KB, CMS, outreach and admin. Authenticate with a
            session cookie, an admin API key, or a delegated end-user token.
          </p>
        </header>
        {groups.map((g) => (
          <section key={g.tag} id={'tag-' + tagSlug(g.tag)}>
            <h2 className="tag-h">
              {prettifyTag(g.tag)} <span className="ct">{g.endpoints.length} endpoints</span>
            </h2>
            {g.endpoints.map((ep) => (
              <RestEndpoint key={ep.id} ep={ep} />
            ))}
          </section>
        ))}
      </main>
    </>
  );
}
