import { Link } from '@/i18n/navigation';
import { listEndpoints } from './_lib/openapi';
import { mcpTools } from './_lib/mcp';
import { skills } from './_lib/skills';

export default function DocsHome() {
  const restCount = listEndpoints().length;
  const mcpCount = mcpTools.length;
  const skillCount = skills.length;
  return (
    <main className="docs-main">
      <header className="docs-hero">
        <div className="eyebrow">Section · Get started</div>
        <h1>
          Build against <em>Munin</em>.
        </h1>
        <p className="lede">
          Three surfaces, one install. The REST API for HTTP integrators, MCP for the agents you operate,
          and Skills for the procedures those agents read at runtime. Pick the door that matches what
          you&rsquo;re building.
        </p>
      </header>

      <h2 className="tag-h" id="surfaces">
        The three surfaces <span className="ct">read these in order</span>
      </h2>
      <div className="gs-grid">
        <Link className="gs-card" href="/docs/rest">
          <div className="gs-num">01</div>
          <h3>
            REST <em>API</em>
          </h3>
          <p className="gs-when">
            When you&rsquo;re integrating Munin from another HTTP service — a backoffice, a webhook
            receiver, a sync job.
          </p>
          <ul className="gs-bullets">
            <li>{restCount} endpoints across conversations, CRM, KB, CMS, outreach, admin</li>
            <li>Bearer tokens, session cookies, or delegated end-user tokens</li>
            <li>
              OpenAPI 3.1 spec at <code>/api/v1/openapi.json</code>
            </li>
          </ul>
          <span className="gs-go">Browse endpoints →</span>
        </Link>

        <Link className="gs-card" href="/docs/mcp">
          <div className="gs-num">02</div>
          <h3>
            <em>MCP</em> Tools
          </h3>
          <p className="gs-when">
            When you&rsquo;re wiring an LLM agent to act on Munin — read articles, reply in
            conversations, look up people.
          </p>
          <ul className="gs-bullets">
            <li>
              {mcpCount} Model Context Protocol tools served at <code>/mcp</code>
            </li>
            <li>Audiences gate visibility: admin keys see everything, end-user tokens see only self-service</li>
            <li>Each tool ships with its JSON Schema and a scope list</li>
          </ul>
          <span className="gs-go">Browse tools →</span>
        </Link>

        <Link className="gs-card" href="/docs/skills">
          <div className="gs-num">03</div>
          <h3>
            <em>Skills</em> Library
          </h3>
          <p className="gs-when">
            When you want your agent to <em>do things well</em>, not just call tools — the runbooks
            humans write to encode how Munin should be operated.
          </p>
          <ul className="gs-bullets">
            <li>{skillCount} markdown procedures bundled with Munin</li>
            <li>
              Read at runtime via <code>skill://module/name</code>
            </li>
            <li>Cover triage, bulk imports, escalations, locale rollouts, more</li>
          </ul>
          <span className="gs-go">Browse skills →</span>
        </Link>
      </div>

      <h2 className="tag-h" id="auth" style={{ marginTop: 64 }}>
        Authentication <span className="ct">three ways in</span>
      </h2>
      <p className="tag-blurb">
        All three surfaces share the same auth model. Pick the credential that matches who&rsquo;s calling.
      </p>
      <div className="gs-auth">
        <div className="gs-auth-row">
          <span className="gs-auth-name">Admin API key</span>
          <span className="gs-auth-when">
            Server-to-server. Full access to the org. Generated in Settings → Tokens.
          </span>
          <code className="gs-auth-code">Authorization: Bearer mun_admin_…</code>
        </div>
        <div className="gs-auth-row">
          <span className="gs-auth-name">Delegated user token</span>
          <span className="gs-auth-when">
            Acting on behalf of one end-user. Self-service tools only. Issued by your auth server.
          </span>
          <code className="gs-auth-code">Authorization: Bearer mun_user_…</code>
        </div>
        <div className="gs-auth-row">
          <span className="gs-auth-name">Session cookie</span>
          <span className="gs-auth-when">
            Browser-side calls from a logged-in operator. Same scopes as the operator.
          </span>
          <code className="gs-auth-code">Cookie: munin_session=…</code>
        </div>
      </div>

      <h2 className="tag-h" id="first-call" style={{ marginTop: 64 }}>
        Your first call
      </h2>
      <p className="tag-blurb">
        A friendly endpoint that confirms your token works and tells you who Munin thinks you are.
      </p>
      <div className="curl" style={{ marginTop: 0 }}>
        <div className="curl-h">
          <span>cURL · GET /api/v1/whoami</span>
          <span style={{ color: 'var(--docs-mute)' }}>copy &amp; run</span>
        </div>
        <pre>{`curl 'https://api.munin.eu/api/v1/whoami' \\
  -H 'Authorization: Bearer $MUNIN_API_KEY'`}</pre>
      </div>

      <h2 className="tag-h" id="next" style={{ marginTop: 64 }}>
        Where to go next
      </h2>
      <div className="gs-next">
        <Link className="gs-next-row" href="/docs/skills">
          <span className="gs-next-eyebrow">Skills · Library</span>
          <span className="gs-next-title">
            Read the bundled <em>runbooks</em>
          </span>
          <span className="gs-next-arrow">↗</span>
        </Link>
        <Link className="gs-next-row" href="/docs/rest">
          <span className="gs-next-eyebrow">REST · API</span>
          <span className="gs-next-title">
            Browse <em>every</em> endpoint
          </span>
          <span className="gs-next-arrow">↗</span>
        </Link>
        <Link className="gs-next-row" href="/docs/mcp">
          <span className="gs-next-eyebrow">MCP · admin</span>
          <span className="gs-next-title">
            Browse the <em>tools</em> your agent can call
          </span>
          <span className="gs-next-arrow">↗</span>
        </Link>
      </div>
    </main>
  );
}
