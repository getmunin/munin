import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';

export const metadata = {
  title: 'Munin · Audiences, tokens, and what your agent can see',
  description:
    'Why an admin key and an end-user token meet two different versions of the same API — and how to choose between them.',
};

export default function AudiencesAndTokens() {
  return (
    <>
    <GuidesSidebar />
    <main className="docs-main">
    <div className="guide-detail">
      <div className="breadcrumb">
        <Link href="/docs/guides">← All guides</Link>
        <span className="crumb-sep">{' / '}</span>
        <span>Concepts</span>
      </div>
      <header className="docs-hero">
        <div className="eyebrow">Guide · Concepts</div>
        <h1>
          Audiences, tokens, and <em>what your agent can see</em>.
        </h1>
        <p className="lede">
          Munin has one API surface, but two audiences look at it. An admin key sees everything in
          the workspace; an end-user token sees a sliver, scoped to one person. Picking the right
          credential is the difference between &ldquo;the agent can do its job&rdquo; and &ldquo;the
          agent just leaked another customer&rsquo;s order history.&rdquo;
        </p>
      </header>

      <h2 className="tag-h" id="audiences">
        Two audiences <span className="ct">admin · self_service</span>
      </h2>
      <p className="tag-blurb">
        Every skill, MCP tool, REST endpoint, and KB document is tagged with one or both audiences.
        The audience that an incoming request resolves to comes from the credential it carries.
      </p>
      <dl className="docs-attrs">
        <dt>admin</dt>
        <dd>
          The workspace operator. Can list every contact, edit every channel, mint keys, run
          back-office tools. Anything destructive or cross-tenant lives here.
        </dd>
        <dt>self_service</dt>
        <dd>
          A single end-user, acting on their own behalf through an agent. Can see their own
          conversations, place their own orders, read public KB articles. Cannot see anyone
          else&rsquo;s data, even within the same org.
        </dd>
      </dl>

      <h2 className="tag-h" id="tokens" style={{ marginTop: 56 }}>
        Three token kinds
      </h2>
      <p className="tag-blurb">
        The audience is implicit in the kind of credential the caller presents.
      </p>
      <dl className="docs-attrs">
        <dt>mn_admin_…</dt>
        <dd>
          Long-lived workspace key. Stored server-side. Audience{' '}
          <code>admin</code>. This is what your backend uses when wiring up channels, importing KB
          articles, or running back-office MCP tools. Treat it like an AWS root key — never ship it
          to a browser.
        </dd>
        <dt>mn_widget_…</dt>
        <dd>
          Channel-bound public key for the chat widget. Audience <code>self_service</code>, plus
          channel-scoped origin allowlist and optional identity HMAC. Safe to embed in the page
          source: the key only authorizes calls to the one channel it was minted for, and only
          from origins on its allowlist.
        </dd>
        <dt>mn_dlg_…</dt>
        <dd>
          Short-lived delegated token (default TTL 30 min, max 24 h). Audience{' '}
          <code>self_service</code> by default. Minted server-side via{' '}
          <code>POST /api/v1/tokens/delegated</code> with an admin key, bound to a specific{' '}
          <code>EndUser</code>. The agent runtime carries this as bearer when it calls MCP tools on
          a customer&rsquo;s behalf — voice calls, scheduled agents, anywhere outside the chat
          widget.
        </dd>
      </dl>

      <h2 className="tag-h" id="scoping" style={{ marginTop: 56 }}>
        What scoping actually means
      </h2>
      <p className="tag-blurb">
        Audience is enforced at three layers — the controller picks the surface, RLS enforces
        tenancy, and the registry filters tool visibility:
      </p>
      <dl className="docs-attrs">
        <dt>1. Controller</dt>
        <dd>
          The MCP controller resolves the actor&rsquo;s audiences and exposes only matching tools.
          An admin key sees the full toolset; a delegated token sees the{' '}
          <code>self_service</code> subset. Same endpoint, different surface.
        </dd>
        <dt>2. RLS</dt>
        <dd>
          PostgreSQL row-level security uses the GUCs set by{' '}
          <code>TenancyInterceptor</code> (<code>app.org_id</code>, <code>app.end_user_id</code>) to
          filter every row read or written. A delegated token simply cannot select another
          end-user&rsquo;s rows — the database refuses, regardless of what the code asks for.
        </dd>
        <dt>3. KB &amp; skill registry</dt>
        <dd>
          Knowledge-base documents and skills carry their own <code>audiences</code> field. A
          public refund-policy article is tagged <code>['admin', 'self_service']</code>; an internal
          escalation runbook is <code>['admin']</code> only. The agent search respects this filter
          without needing a separate query.
        </dd>
      </dl>

      <h2 className="tag-h" id="picking" style={{ marginTop: 56 }}>
        Picking the right one
      </h2>
      <dl className="docs-attrs">
        <dt>Server-to-server admin tasks</dt>
        <dd>
          Your backend wiring up Munin (creating channels, importing KB articles, monitoring
          health): <code>mn_admin_*</code>. One key per environment, rotate quarterly.
        </dd>
        <dt>Chat widget on a public page</dt>
        <dd>
          Embed <code>mn_widget_*</code> directly in the <code>&lt;script&gt;</code> tag. Add an
          origin allowlist on the channel, and identity HMAC if you want signed-in users to resume
          threads across devices.
        </dd>
        <dt>Voice call / scheduled agent / custom UI</dt>
        <dd>
          Your backend mints an <code>mn_dlg_*</code> bound to the specific{' '}
          <code>EndUser</code>, hands it to the agent runtime, and the agent calls MCP tools with
          it as bearer. The token dies on its own — no rotation, no cleanup.
        </dd>
      </dl>

      <h2 className="tag-h" id="anti-patterns" style={{ marginTop: 56 }}>
        Things to not do
      </h2>
      <dl className="docs-attrs">
        <dt>Don&rsquo;t ship admin keys to the browser</dt>
        <dd>
          An <code>mn_admin_*</code> in client code is a workspace-wide compromise. If you find
          yourself reaching for one in a frontend, you probably want a delegated token instead.
        </dd>
        <dt>Don&rsquo;t use a long-lived delegated token</dt>
        <dd>
          Delegated tokens are deliberately short-lived. If you need a session that lasts longer
          than 24 hours, mint a fresh token when the session resumes — the cost is one round-trip
          from your backend.
        </dd>
        <dt>Don&rsquo;t paper over audience with scopes</dt>
        <dd>
          Scopes refine permissions <em>within</em> an audience. They don&rsquo;t upgrade a
          self-service token into an admin one. If a tool isn&rsquo;t visible to{' '}
          <code>self_service</code>, no scope value will reveal it.
        </dd>
      </dl>
    </div>
    </main>
    </>
  );
}
