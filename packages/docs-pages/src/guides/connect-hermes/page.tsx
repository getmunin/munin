import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';

export const metadata = {
  title: 'Munin · Connect Hermes Agent over MCP',
  description: "Wire Nous Research's Hermes Agent to your Munin org over MCP.",
};

export default function ConnectHermes() {
  const mcpUrl = (process.env.NEXT_PUBLIC_MCP_URL ?? 'http://localhost:3001/mcp').replace(/\/+$/, '');
  return (
    <>
    <GuidesSidebar />
    <main className="docs-main">
      <div className="guide-detail">
        <div className="breadcrumb">
          <Link href="/docs/guides">← All guides</Link>
          <span className="crumb-sep">{' / '}</span>
          <span>Clients</span>
        </div>
        <header className="docs-hero">
          <div className="eyebrow">Guide · Clients</div>
          <h1>
            Wire <em>Hermes Agent</em> to Munin.
          </h1>
          <p className="lede">
            Hermes Agent reads MCP servers from a YAML config block. Add Munin and the agent picks
            up every tool the calling key has scope for — KB hybrid search, CRM lookups, conversation
            drafts, CMS writes — on its next reload.
          </p>
        </header>

        <h2 className="tag-h" id="key">
          1 · Mint an API key
        </h2>
        <p className="tag-blurb">
          In the dashboard, go to{' '}
          <Link href="/dashboard/settings/api-keys">Settings → API keys</Link> and create a key.
          Pick scopes that match what Hermes should be allowed to do — read-only KB for an
          answer-bot, full CRM write for a sales agent. The token starts with{' '}
          <code>mn_admin_</code> and is shown once.
        </p>

        <h2 className="tag-h" id="add" style={{ marginTop: 56 }}>
          2 · Add Munin to the Hermes config
        </h2>
        <p className="tag-blurb">
          Hermes reads MCP servers from <code>~/.hermes/config.yaml</code> under the{' '}
          <code>mcp_servers</code> block. Merge the Munin entry in alongside any servers you
          already have.
        </p>
        <div className="curl">
          <div className="curl-h">
            <span>~/.hermes/config.yaml</span>
            <span style={{ color: 'var(--docs-mute)' }}>merge with existing servers</span>
          </div>
          <pre>{`mcp_servers:
  munin:
    url: "${mcpUrl}"
    headers:
      Authorization: "Bearer mn_admin_…"
    enabled: true
    timeout: 120
    connect_timeout: 60`}</pre>
        </div>
        <p className="tag-blurb">
          If you would rather use OAuth instead of a static token, drop the <code>headers</code>{' '}
          block and set <code>auth: oauth</code>. Hermes runs the MCP SDK&rsquo;s OAuth 2.1 PKCE
          flow on first connect and persists the token to{' '}
          <code>~/.hermes/mcp-tokens/munin.json</code> for refresh.
        </p>

        <h2 className="tag-h" id="reload" style={{ marginTop: 56 }}>
          3 · Reload without restarting
        </h2>
        <p className="tag-blurb">
          From an active Hermes session, run the slash command:
        </p>
        <div className="curl">
          <div className="curl-h">
            <span>hermes</span>
          </div>
          <pre>{`/reload-mcp`}</pre>
        </div>
        <p className="tag-blurb">
          Hermes re-reads the config, reconnects to every server in the block, and refreshes the
          tool list in-place.
        </p>

        <h2 className="tag-h" id="verify" style={{ marginTop: 56 }}>
          4 · Verify
        </h2>
        <p className="tag-blurb">
          Ask Hermes <em>&ldquo;What MCP tools do you have for Munin?&rdquo;</em>. It should list
          the tools matching the key&rsquo;s scopes — admin keys see everything, narrower scopes
          see only their slice. If nothing shows up, common causes are a typo in the URL (the
          path is <code>/mcp</code>, not <code>/v1/mcp</code>), a revoked token, or a YAML
          indent error in <code>~/.hermes/config.yaml</code>.
        </p>

        <h2 className="tag-h" id="filter" style={{ marginTop: 56 }}>
          5 · Filter tools (optional)
        </h2>
        <p className="tag-blurb">
          If you only want a slice of Munin&rsquo;s tool surface exposed to a given agent, use the{' '}
          <code>tools.include</code> / <code>tools.exclude</code> lists. A read-only research agent
          might want only KB and CRM lookups:
        </p>
        <div className="curl">
          <div className="curl-h">
            <span>~/.hermes/config.yaml</span>
          </div>
          <pre>{`mcp_servers:
  munin:
    url: "${mcpUrl}"
    headers:
      Authorization: "Bearer mn_admin_…"
    tools:
      include:
        - "kb_*"
        - "crm_get_contact"
        - "crm_search_contacts"`}</pre>
        </div>

        <h2 className="tag-h" id="scope" style={{ marginTop: 56 }}>
          6 · Tighten scope
        </h2>
        <p className="tag-blurb">
          Mint a separate key per workstation or per agent so you can revoke one without disrupting
          the others. Pick the smallest scope set that lets the agent do its job — read-only KB is
          plenty for a Q&amp;A assistant, full <code>conv:write</code> is only needed if Hermes
          should actually send replies on your behalf.
        </p>
      </div>
    </main>
    </>
  );
}
