import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';

export const metadata = {
  title: 'Munin · Connect Gemini over MCP',
  description: 'Wire the Gemini CLI to your Munin org over MCP.',
};

export default function ConnectGemini() {
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
            Wire <em>Gemini</em> to Munin.
          </h1>
          <p className="lede">
            The Gemini CLI reads remote MCP servers from <code>settings.json</code>. Add Munin
            and Gemini gains every tool the calling key has scope for — KB hybrid search, CRM
            lookups, conversation drafts, CMS writes.
          </p>
        </header>

        <h2 className="tag-h" id="key">
          1 · Mint an API key
        </h2>
        <p className="tag-blurb">
          From the dashboard, go to{' '}
          <Link href="/dashboard/settings/api-keys">Settings → API keys</Link>. Pick scopes that
          match what Gemini should be allowed to do. The token starts with <code>mn_live_</code>{' '}
          and is shown once.
        </p>

        <h2 className="tag-h" id="add-cli" style={{ marginTop: 56 }}>
          2 · Add the server (CLI)
        </h2>
        <p className="tag-blurb">
          The fastest way is the one-shot CLI command — it writes the entry into the project
          (or user-level) settings for you:
        </p>
        <div className="curl">
          <div className="curl-h">
            <span>shell</span>
            <span style={{ color: 'var(--docs-mute)' }}>writes ~/.gemini/settings.json</span>
          </div>
          <pre>{`gemini mcp add --transport http munin ${mcpUrl} \\
  -H "Authorization: Bearer mn_live_…"`}</pre>
        </div>

        <h2 className="tag-h" id="add-file" style={{ marginTop: 56 }}>
          Or edit settings.json directly
        </h2>
        <p className="tag-blurb">
          Gemini CLI reads <code>~/.gemini/settings.json</code> (user scope) or{' '}
          <code>.gemini/settings.json</code> in the project root. Merge Munin into{' '}
          <code>mcpServers</code>. Use <code>httpUrl</code> for the streamable HTTP transport
          (<code>url</code> is reserved for SSE).
        </p>
        <div className="curl">
          <div className="curl-h">
            <span>settings.json</span>
            <span style={{ color: 'var(--docs-mute)' }}>merge with existing servers</span>
          </div>
          <pre>{`{
  "mcpServers": {
    "munin": {
      "httpUrl": "${mcpUrl}",
      "headers": {
        "Authorization": "Bearer mn_live_…"
      }
    }
  }
}`}</pre>
        </div>

        <h2 className="tag-h" id="verify" style={{ marginTop: 56 }}>
          3 · Verify
        </h2>
        <p className="tag-blurb">
          Run <code>gemini mcp list</code> — it prints every connected server and the tools it
          discovered. If Munin doesn&rsquo;t show, re-run with <code>--verbose</code> to see the
          handshake error. Then prompt Gemini in a session with{' '}
          <em>&ldquo;List the Munin tools you can call&rdquo;</em> as a smoke test.
        </p>
        <p className="tag-blurb">
          If the list is empty, the most common causes are a stale config (restart the{' '}
          <code>gemini</code> shell), a wrong path (it&rsquo;s <code>/mcp</code>, not{' '}
          <code>/v1/mcp</code>), or a revoked token.
        </p>

        <h2 className="tag-h" id="scope" style={{ marginTop: 56 }}>
          4 · Tighten scope
        </h2>
        <p className="tag-blurb">
          Mint a separate key per workstation, with the smallest scope that lets the model do its
          job — read-only KB is plenty for a Q&amp;A assistant, full <code>conv:write</code> is
          needed only if Gemini should actually send replies.
        </p>
      </div>
    </main>
    </>
  );
}
