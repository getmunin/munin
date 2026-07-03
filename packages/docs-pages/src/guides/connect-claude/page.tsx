import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';

export const metadata = {
  title: 'Munin · Connect Claude over MCP',
  description: 'Wire Claude Desktop and Claude.ai to your Munin org over MCP.',
};

export default function ConnectClaude() {
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
            Wire <em>Claude</em> to Munin.
          </h1>
          <p className="lede">
            Both Claude Desktop and Claude.ai add remote MCP servers through the same Custom
            Connectors UI. Point either surface at your Munin org and the assistant gains every tool
            the calling key has scope for — KB search, CRM lookups, conversation drafts, CMS writes,
            the lot.
          </p>
        </header>

        <h2 className="tag-h" id="availability">
          Availability
        </h2>
        <p className="tag-blurb">
          Custom connectors ship on the <strong>Free</strong>, <strong>Pro</strong>,{' '}
          <strong>Max</strong>, <strong>Team</strong>, and <strong>Enterprise</strong> plans, on
          both Claude.ai (web) and the Claude Desktop apps for macOS and Windows.
        </p>

        <h2 className="tag-h" id="key" style={{ marginTop: 56 }}>
          1 · Mint an API key
        </h2>
        <p className="tag-blurb">
          In the dashboard, go to <Link href="/dashboard/settings/api-keys">Settings → API keys</Link>{' '}
          and create a key. Scope it to what Claude should be allowed to do — read-only KB access,
          full CRM write, or everything. The token starts with <code>mn_admin_</code>. You&rsquo;ll
          only see it once.
        </p>

        <h2 className="tag-h" id="add" style={{ marginTop: 56 }}>
          2 · Add Munin as a custom connector
        </h2>
        <p className="tag-blurb">
          Open Claude Desktop or Claude.ai, then{' '}
          <em>Settings → Connectors → Add custom connector</em>. Fill in:
        </p>
        <dl className="docs-attrs">
          <dt>Name</dt>
          <dd>Munin (or whatever you want to see in the connector list).</dd>
          <dt>Remote MCP server URL</dt>
          <dd>
            <code>{mcpUrl}</code>
          </dd>
          <dt>Authentication</dt>
          <dd>
            Bearer token. Paste your <code>mn_admin_…</code> key.
          </dd>
        </dl>
        <p className="tag-blurb">
          Save. Claude runs the MCP handshake immediately; if it succeeds the connector lights up
          and shows the tools it discovered.
        </p>

        <h2 className="tag-h" id="enable" style={{ marginTop: 56 }}>
          3 · Enable per conversation
        </h2>
        <p className="tag-blurb">
          Adding the connector doesn&rsquo;t auto-attach it to every chat. In the composer, open the{' '}
          <strong>+</strong> button → <em>Connectors</em>, and toggle Munin on. Claude will then
          call Munin tools when it decides they&rsquo;re relevant — or you can name a tool directly
          in the prompt.
        </p>

        <h2 className="tag-h" id="verify" style={{ marginTop: 56 }}>
          4 · Verify
        </h2>
        <p className="tag-blurb">
          Ask Claude <em>&ldquo;What MCP tools do you have for Munin?&rdquo;</em>. It should list
          the tools that match the key&rsquo;s scopes — admin keys see everything, narrower scopes
          see only their slice. If nothing shows up, the most common causes are a typo in the URL
          (the path is <code>/mcp</code>, not <code>/v1/mcp</code>), a token that was revoked,
          or the connector not enabled in the conversation.
        </p>

        <h2 className="tag-h" id="scope" style={{ marginTop: 56 }}>
          5 · Tighten scope
        </h2>
        <p className="tag-blurb">
          Every Munin key is single-org. Issue a separate key per machine so you can revoke one
          without disrupting the others, and pick the smallest scope set that lets the assistant
          do its job — read-only KB is plenty for an answer-bot, full <code>conv:write</code> is
          needed only if you want Claude to actually send replies on your behalf.
        </p>
      </div>
    </main>
    </>
  );
}
