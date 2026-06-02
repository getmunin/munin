import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';

export const metadata = {
  title: 'Munin · Connect OpenClaw over MCP',
  description: 'Wire the OpenClaw personal assistant to your Munin org over MCP.',
};

export default function ConnectOpenClaw() {
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
            Wire <em>OpenClaw</em> to Munin.
          </h1>
          <p className="lede">
            OpenClaw treats MCP servers as first-class skills — once registered, every Munin tool
            shows up in the assistant&rsquo;s tool list with no further wiring. The fastest path
            is the <code>openclaw mcp add</code> CLI command.
          </p>
        </header>

        <h2 className="tag-h" id="key">
          1 · Mint an API key
        </h2>
        <p className="tag-blurb">
          In the dashboard, go to{' '}
          <Link href="/dashboard/settings/api-keys">Settings → API keys</Link> and create a key.
          Scope it to what OpenClaw should be allowed to do — read-only KB, full CRM write, or
          everything. The token starts with <code>mn_live_</code> and is shown once.
        </p>

        <h2 className="tag-h" id="add-cli" style={{ marginTop: 56 }}>
          2 · Register the server (CLI)
        </h2>
        <p className="tag-blurb">
          The one-shot command writes the entry into{' '}
          <code>~/.openclaw/openclaw.json</code> for you. Prefer{' '}
          <code>streamable-http</code> — it&rsquo;s the modern Munin transport and handles
          long-running tool calls without an open SSE stream.
        </p>
        <div className="curl">
          <div className="curl-h">
            <span>shell</span>
            <span style={{ color: 'var(--docs-mute)' }}>writes ~/.openclaw/openclaw.json</span>
          </div>
          <pre>{`openclaw mcp add munin \\
  --url ${mcpUrl} \\
  --transport streamable-http \\
  --header "Authorization: Bearer mn_live_…" \\
  --timeout 20`}</pre>
        </div>

        <h2 className="tag-h" id="add-file" style={{ marginTop: 56 }}>
          Or edit openclaw.json directly
        </h2>
        <p className="tag-blurb">
          OpenClaw reads <code>~/.openclaw/openclaw.json</code>. Merge Munin under{' '}
          <code>mcp.servers</code>:
        </p>
        <div className="curl">
          <div className="curl-h">
            <span>~/.openclaw/openclaw.json</span>
            <span style={{ color: 'var(--docs-mute)' }}>merge with existing servers</span>
          </div>
          <pre>{`{
  "mcp": {
    "servers": {
      "munin": {
        "url": "${mcpUrl}",
        "transport": "streamable-http",
        "timeout": 20,
        "headers": {
          "Authorization": "Bearer mn_live_…"
        }
      }
    }
  }
}`}</pre>
        </div>
        <p className="tag-blurb">
          For OAuth instead of a static bearer, drop the <code>headers</code> block and set{' '}
          <code>&quot;auth&quot;: &quot;oauth&quot;</code>. OpenClaw will run the PKCE flow on
          first connect.
        </p>

        <h2 className="tag-h" id="verify" style={{ marginTop: 56 }}>
          3 · Verify
        </h2>
        <p className="tag-blurb">
          Run the doctor with a live probe — it opens an MCP session and lists the tools the
          server advertised:
        </p>
        <div className="curl">
          <div className="curl-h">
            <span>shell</span>
          </div>
          <pre>{`openclaw mcp doctor munin --probe
openclaw mcp list`}</pre>
        </div>
        <p className="tag-blurb">
          If the probe fails, the most common causes are a typo in the URL (the path is{' '}
          <code>/mcp</code>, not <code>/v1/mcp</code>), a revoked token, or a transport mismatch
          (use <code>streamable-http</code> against Munin, not the default <code>sse</code>).
        </p>

        <h2 className="tag-h" id="filter" style={{ marginTop: 56 }}>
          4 · Filter tools (optional)
        </h2>
        <p className="tag-blurb">
          Use <code>toolFilter</code> to keep agent prompts focused. A research-only assistant
          might want KB and CRM lookups but nothing that writes:
        </p>
        <div className="curl">
          <div className="curl-h">
            <span>~/.openclaw/openclaw.json</span>
          </div>
          <pre>{`{
  "mcp": {
    "servers": {
      "munin": {
        "url": "${mcpUrl}",
        "transport": "streamable-http",
        "headers": { "Authorization": "Bearer mn_live_…" },
        "toolFilter": {
          "include": ["kb_*", "crm_get_*", "crm_search_*"],
          "exclude": ["*_delete_*"]
        }
      }
    }
  }
}`}</pre>
        </div>

        <h2 className="tag-h" id="scope" style={{ marginTop: 56 }}>
          5 · Tighten scope
        </h2>
        <p className="tag-blurb">
          Mint a separate key per workstation or per agent so you can revoke one without disrupting
          the others. Pick the smallest scope set that lets OpenClaw do its job — read-only KB is
          plenty for a Q&amp;A assistant, full <code>conv:write</code> is only needed if you want
          OpenClaw to actually send replies on your behalf.
        </p>
      </div>
    </main>
    </>
  );
}
