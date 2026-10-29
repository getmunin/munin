import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';
import { DashboardLink } from '../../_components/dashboard-link';
import { stripTrailingSlashes } from '@getmunin/types';

export const metadata = {
  title: 'Munin · Connect ChatGPT over MCP',
  description: 'Add Munin as a custom MCP server in ChatGPT.',
};

export default function ConnectChatGPT() {
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
            Wire <em>ChatGPT</em> to Munin.
          </h1>
          <p className="lede">
            ChatGPT can install any remote MCP server as a plugin. Add Munin, sign in with your
            Munin account, and the assistant can search the KB, look up contacts, read deals,
            draft replies, and publish CMS entries — whatever your role allows. There is no API
            key to mint or paste.
          </p>
        </header>

        <h2 className="tag-h" id="availability">
          Availability
        </h2>
        <p className="tag-blurb">
          Custom MCP servers are added from ChatGPT on the web. Which plans can add them has
          changed with OpenAI&rsquo;s rollouts, so check your plan if you don&rsquo;t see the
          option; in Business, Enterprise, and Edu workspaces, admins control who may add them.
          The separate <strong>Developer Mode</strong> toggle older guides mention is gone.
        </p>

        <h2 className="tag-h" id="add" style={{ marginTop: 56 }}>
          1 · Add the custom MCP server
        </h2>
        <p className="tag-blurb">
          Open <em>Plugins</em> on chatgpt.com, click <strong>+</strong>, and choose{' '}
          <em>Add custom MCP server</em>. Fill in:
        </p>
        <dl className="docs-attrs">
          <dt>Name</dt>
          <dd>Munin (or anything you want to see in the tool picker).</dd>
          <dt>Description</dt>
          <dd>Optional. Helps your team disambiguate if you operate multiple Munin orgs.</dd>
          <dt>Server URL</dt>
          <dd>
            <code>{mcpUrl}</code>
          </dd>
          <dt>Authentication</dt>
          <dd>
            <em>OAuth</em>. Leave the client credentials empty — Munin supports dynamic client
            registration, so ChatGPT registers itself. ChatGPT has no option to send a static
            bearer token, so an <code>mn_admin_…</code> API key can&rsquo;t be used here.
          </dd>
        </dl>
        <p className="tag-blurb">
          Confirm the risk warning with <em>I understand and want to continue</em>, then choose{' '}
          <em>Create as a plugin</em> and install it.
        </p>

        <h2 className="tag-h" id="sign-in" style={{ marginTop: 56 }}>
          2 · Sign in and approve
        </h2>
        <p className="tag-blurb">
          ChatGPT sends you to Munin: sign in, review the modules and scopes it is asking for,
          and click <em>Authorize</em>. The connection acts as you — it inherits your role and
          can&rsquo;t exceed it, and it can&rsquo;t manage the team, billing, or API keys, or
          delete the org. It binds to the organization you have open in the dashboard when you
          approve, so switch first if you belong to more than one. If the sign-in fails ChatGPT
          shows the error verbatim — usually a 404 (wrong path — it&rsquo;s <code>/mcp</code>,
          not <code>/v1/mcp</code>) or a TLS issue.
        </p>

        <h2 className="tag-h" id="enable" style={{ marginTop: 56 }}>
          3 · Use it in a conversation
        </h2>
        <p className="tag-blurb">
          Type <code>@</code> in the composer and pick <em>Munin</em>. ChatGPT will then call
          Munin tools when it decides they&rsquo;re relevant — or you can name a tool directly in
          the prompt. Tools that write ask for confirmation first by default.
        </p>

        <h2 className="tag-h" id="access" style={{ marginTop: 56 }}>
          4 · Manage access
        </h2>
        <p className="tag-blurb">
          Access lasts 90 days and refreshes automatically while ChatGPT keeps using it. Revoke it
          at any time from{' '}
          <DashboardLink href="/dashboard/settings/agents">Settings → Agents</DashboardLink> — no
          need to remove the plugin on the ChatGPT side. To keep ChatGPT away from tools you
          don&rsquo;t want it calling, turn them off on the plugin&rsquo;s details page in
          ChatGPT&rsquo;s settings.
        </p>
      </div>
    </main>
    </>
  );
}
