import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';

export const metadata = {
  title: 'Munin · Connect ChatGPT over MCP',
  description: 'Add Munin as a custom MCP app in ChatGPT.',
};

export default function ConnectChatGPT() {
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
            Wire <em>ChatGPT</em> to Munin.
          </h1>
          <p className="lede">
            ChatGPT&rsquo;s custom MCP apps (previously called Connectors) let you point it at any
            remote MCP server. Add Munin and the assistant can search the KB, look up contacts,
            read deals, draft replies, and publish CMS entries — gated by the scopes on the key
            you mint.
          </p>
        </header>

        <h2 className="tag-h" id="availability">
          Availability
        </h2>
        <p className="tag-blurb">
          Custom MCP apps require <strong>Developer Mode</strong>, which ships on ChatGPT{' '}
          <strong>Plus</strong>, <strong>Pro</strong>, <strong>Business</strong>,{' '}
          <strong>Enterprise</strong>, and <strong>Edu</strong>. Plus and Pro accounts get
          read/fetch tools only; write-capable tools require Business, Enterprise, or Edu.
        </p>

        <h2 className="tag-h" id="key" style={{ marginTop: 56 }}>
          1 · Mint an API key
        </h2>
        <p className="tag-blurb">
          From the dashboard, go to{' '}
          <Link href="/dashboard/settings/api-keys">Settings → API keys</Link> and create one.
          Scope it to what ChatGPT should be allowed to do. The token starts with{' '}
          <code>mn_admin_</code> and is shown once.
        </p>

        <h2 className="tag-h" id="developer-mode" style={{ marginTop: 56 }}>
          2 · Enable Developer Mode
        </h2>
        <p className="tag-blurb">
          Open <em>Settings → Connectors → Advanced</em> (workspace admins use{' '}
          <em>Workspace Settings → Permissions &amp; Roles</em>) and turn <strong>Developer Mode</strong>{' '}
          on. The option to add a custom MCP app only appears after this is enabled.
        </p>

        <h2 className="tag-h" id="add" style={{ marginTop: 56 }}>
          3 · Add the custom app
        </h2>
        <p className="tag-blurb">
          Back in <em>Settings → Connectors</em>, click <em>Create</em>. Fill in:
        </p>
        <dl className="docs-attrs">
          <dt>Name</dt>
          <dd>Munin (or anything you want to see in the tool picker).</dd>
          <dt>Description</dt>
          <dd>Optional. Helps your team disambiguate if you operate multiple Munin orgs.</dd>
          <dt>MCP server URL</dt>
          <dd>
            <code>{mcpUrl}</code>
          </dd>
          <dt>Authentication</dt>
          <dd>
            No authentication is the default for the form, but Munin requires a bearer token. Pick{' '}
            <em>Custom</em> and add an <code>Authorization</code> header with value{' '}
            <code>Bearer mn_admin_…</code>.
          </dd>
          <dt>I trust this application</dt>
          <dd>
            ChatGPT requires explicit confirmation before letting you save a custom app. Tick the
            box once you&rsquo;ve verified the URL is correct.
          </dd>
        </dl>
        <p className="tag-blurb">
          Save. ChatGPT runs the MCP handshake immediately and lists the tools it discovered. If
          the handshake fails it surfaces the error verbatim — usually a 401 (wrong token), a 404
          (wrong path — it&rsquo;s <code>/mcp</code>, not <code>/v1/mcp</code>), or a TLS
          issue.
        </p>

        <h2 className="tag-h" id="enable" style={{ marginTop: 56 }}>
          4 · Enable per conversation
        </h2>
        <p className="tag-blurb">
          Adding the app doesn&rsquo;t auto-attach it to every chat. In the composer, open the
          tools menu and toggle <em>Munin</em> on. ChatGPT will then call Munin tools when it
          decides they&rsquo;re relevant — or you can name a tool directly in the prompt.
        </p>

        <h2 className="tag-h" id="scope" style={{ marginTop: 56 }}>
          5 · Tighten scope
        </h2>
        <p className="tag-blurb">
          Issue a separate Munin key per ChatGPT user or workspace, with the smallest scope that
          gets the job done. Revocations take effect on the next request — no need to remove the
          app on the ChatGPT side.
        </p>
      </div>
    </main>
    </>
  );
}
