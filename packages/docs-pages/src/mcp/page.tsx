import { mcpTools, type McpTool } from '../_lib/mcp';
import { McpCard } from '../_components/mcp-card';
import { McpSidebar } from '../_components/mcp-sidebar';
import { Link } from '../i18n-navigation';

export interface McpIndexProps {
  extraTools?: McpTool[];
}

export default function McpIndex({ extraTools }: McpIndexProps = {}) {
  const all = [...mcpTools, ...(extraTools ?? [])];
  const admin = all.filter((t) => t.audiences.includes('admin'));
  const selfService = all.filter((t) => t.audiences.includes('self_service'));
  return (
    <>
      <McpSidebar admin={admin} selfService={selfService} />
      <main className="docs-main">
        <header className="docs-hero">
          <div className="eyebrow">Section · MCP Tools</div>
          <h1>
            Tools your <em>agent</em> can call.
          </h1>
          <p className="lede">
            Munin exposes {all.length} tools at <code style={{ fontFamily: 'var(--munin-mono)' }}>/mcp</code>.
            Audiences gate which tokens see which tools — admin keys see everything, delegated end-user
            tokens see only self-service tools.
          </p>
        </header>

        <h2 className="tag-h" id="connect">
          Connect a client
        </h2>
        <p className="tag-blurb">
          Wire your favourite model to Munin in a couple of minutes.
        </p>
        <ul className="mcp-clients">
          <li>
            <Link href="/docs/guides/connect-claude">
              <span className="name">Claude</span>
              <span className="sub">Desktop &amp; Web</span>
            </Link>
          </li>
          <li>
            <Link href="/docs/guides/connect-chatgpt">
              <span className="name">ChatGPT</span>
              <span className="sub">Custom Connector</span>
            </Link>
          </li>
          <li>
            <Link href="/docs/guides/connect-gemini">
              <span className="name">Gemini</span>
              <span className="sub">CLI &amp; Studio</span>
            </Link>
          </li>
        </ul>

        <h2 className="tag-h" style={{ marginTop: 56 }}>
          Admin tools <span className="ct">{admin.length}</span>
        </h2>
        <p className="tag-blurb">
          Available to admin API keys and admin sessions. Includes everything that writes or that reads
          across the org.
        </p>
        <div className="mcp-grid">
          {admin.map((t) => (
            <McpCard key={t.name} tool={t} />
          ))}
        </div>

        <h2 className="tag-h" style={{ marginTop: 56 }}>
          Self-service tools <span className="ct">{selfService.length}</span>
        </h2>
        <p className="tag-blurb">
          Visible to delegated end-user tokens. Scoped to one principal and read-only or contributor at most.
        </p>
        <div className="mcp-grid">
          {selfService.map((t) => (
            <McpCard key={'ss_' + t.name} tool={t} />
          ))}
        </div>
      </main>
    </>
  );
}
