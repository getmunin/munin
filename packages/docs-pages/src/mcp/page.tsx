import { listAdmin, listSelfService, mcpTools } from '../_lib/mcp';
import { McpCard } from '../_components/mcp-card';
import { McpSidebar } from '../_components/mcp-sidebar';

export default function McpIndex() {
  const admin = listAdmin();
  const selfService = listSelfService();
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
            Munin exposes {mcpTools.length} tools at <code style={{ fontFamily: 'var(--munin-mono)' }}>/mcp</code>.
            Audiences gate which tokens see which tools — admin keys see everything, delegated end-user
            tokens see only self-service tools.
          </p>
        </header>

        <h2 className="tag-h">
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
