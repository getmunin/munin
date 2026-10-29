import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';
import { DashboardLink } from '../../_components/dashboard-link';
import { stripTrailingSlashes } from '@getmunin/types';

export const metadata = {
  title: 'Munin · Connect Claude over MCP',
  description: 'Wire Claude Desktop and Claude.ai to your Munin org over MCP.',
};

export default function ConnectClaude() {
  const mcpUrl = stripTrailingSlashes(process.env.NEXT_PUBLIC_MCP_URL ?? 'http://localhost:3001/mcp');
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
            Connectors UI. Point either surface at your Munin org, sign in with your Munin account,
            and the assistant gains every tool your role allows — KB search, CRM lookups,
            conversation drafts, CMS writes, the lot. There is no API key to mint or paste.
          </p>
        </header>

        <h2 className="tag-h" id="availability">
          Availability
        </h2>
        <p className="tag-blurb">
          Custom connectors ship on the <strong>Free</strong>, <strong>Pro</strong>,{' '}
          <strong>Max</strong>, <strong>Team</strong>, and <strong>Enterprise</strong> plans, on
          both Claude.ai (web) and the Claude Desktop apps for macOS and Windows. The Free plan
          allows one custom connector.
        </p>

        <h2 className="tag-h" id="add" style={{ marginTop: 56 }}>
          1 · Add Munin as a custom connector
        </h2>
        <p className="tag-blurb">
          On Free, Pro, and Max, open Claude Desktop or Claude.ai and go to{' '}
          <em>Customize → Connectors → Add custom connector</em>. On Team and Enterprise, an
          Owner adds it once for the organization under{' '}
          <em>Organization settings → Connectors → Add → Custom</em>, and each member then
          connects with their own Munin account. Fill in:
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
            OAuth. Leave the client ID and secret under <em>Advanced settings</em> blank — Munin
            supports dynamic client registration, so Claude registers itself. If your dialog asks
            instead, pick <em>Sign in now</em> and <em>Register automatically</em>.
          </dd>
        </dl>

        <h2 className="tag-h" id="sign-in" style={{ marginTop: 56 }}>
          2 · Sign in and approve
        </h2>
        <p className="tag-blurb">
          Click <em>Connect</em>. Claude opens Munin in a new window: sign in, review the modules
          and scopes Claude is asking for, and click <em>Authorize</em>. The connection acts as
          you — it inherits your role and can&rsquo;t exceed it, and it can&rsquo;t manage the
          team, billing, or API keys, or delete the org. It binds to the organization you have
          open in the dashboard when you approve, so switch first if you belong to more than one.
          Once you&rsquo;re back in Claude the connector lights up and shows the tools it
          discovered.
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
          the tools your role can use. If nothing shows up, the most common causes are a typo in
          the URL (the path is <code>/mcp</code>, not <code>/v1/mcp</code>), a sign-in that
          wasn&rsquo;t completed or was later revoked — reconnect from{' '}
          <em>Customize → Connectors</em> — or the connector not enabled in the conversation.
        </p>

        <h2 className="tag-h" id="access" style={{ marginTop: 56 }}>
          5 · Manage access
        </h2>
        <p className="tag-blurb">
          Access lasts 90 days and refreshes automatically while Claude keeps using it. Revoke it
          at any time from{' '}
          <DashboardLink href="/dashboard/settings/agents">Settings → Agents</DashboardLink>, after
          which Claude has to sign in again before it can call Munin.
        </p>
        <p className="tag-blurb">
          Need narrower access than your role — a read-only answer-bot, say? Some Claude
          organizations have a <em>Request headers</em> section in the connector dialog (in
          beta). There you can choose <em>No sign-in</em> and add an <code>authorization</code>{' '}
          header with the value <code>Bearer mn_admin_…</code>, using a key from{' '}
          <DashboardLink href="/dashboard/settings/api-keys">Settings → API keys</DashboardLink>{' '}
          scoped to exactly what Claude should do. Without that section, OAuth is the only option.
        </p>
      </div>
    </main>
    </>
  );
}
