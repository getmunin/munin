import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';

export const metadata = {
  title: 'Munin · Connect your own system',
  description:
    'Answer customers from a system Munin has never heard of — a proprietary CRM, a subscription database — by pointing the agent at an MCP server you host.',
};

export default function ConnectYourOwnSystem() {
  return (
    <>
      <GuidesSidebar />
      <main className="docs-main">
        <div className="guide-detail">
          <div className="breadcrumb">
            <Link href="/docs/guides">← All guides</Link>
            <span className="crumb-sep">{' / '}</span>
            <span>Integrations</span>
          </div>
          <header className="docs-hero">
            <div className="eyebrow">Guide · Integrations</div>
            <h1>
              Connect <em>your own</em> system.
            </h1>
            <p className="lede">
              A customer emails asking about their subscription. The answer lives in a CRM you wrote
              yourself, that no vendor adapter will ever cover. You don&rsquo;t need to export it,
              mirror it, or sync it into Munin — you put a small MCP server in front of it and the
              agent reads it live, mid-conversation.
            </p>
          </header>

          <h2 className="tag-h" id="customer-facing">
            First, the thing people get wrong{' '}
            <span className="ct">this is a customer-facing surface</span>
          </h2>
          <p className="tag-blurb">
            Tools from the server you connect are offered to the agent <em>while it answers your
            customers</em> on chat, email and SMS. This is not a toolbox for your own admin agent.
            Point it at a general-purpose MCP server you happen to use internally — a database MCP,
            a GitHub MCP, an internal ops MCP — and you have handed those capabilities to whoever
            writes into your support inbox.
          </p>
          <p className="tag-blurb">
            Munin&rsquo;s protection is that a connection exposes <strong>nothing by default</strong>.
            You name the individual tools customers may reach; a server with an empty allow-list
            stays connected and completely silent. Before adding a tool, ask: would I be comfortable
            if any member of the public could call this, about themselves, with no further checks?
            If you want extra tools for your <em>own</em> agent, add that MCP server to your client
            (Claude, ChatGPT) next to Munin instead — that is what{' '}
            <Link href="/docs/guides/connect-claude">Connect Claude</Link> is for.
          </p>

          <h2 className="tag-h" id="model" style={{ marginTop: 56 }}>
            The model <span className="ct">live reads, nothing stored</span>
          </h2>
          <p className="tag-blurb">
            Munin stores the connection — a URL and an encrypted bearer token — and nothing else. No
            contact import, no nightly sync, no copy of your data. Every answer is a request to your
            server at the moment the agent needs it, so a subscription cancelled ninety seconds ago
            is already cancelled in the reply.
          </p>
          <dl className="docs-attrs">
            <dt>What you build</dt>
            <dd>
              An MCP server over streamable HTTP with a handful of read tools. Any MCP SDK works;
              the reference implementation is about eighty lines.
            </dd>
            <dt>What Munin sends</dt>
            <dd>
              A bearer token you minted, plus a signed assertion naming the customer the agent is
              currently serving.
            </dd>
            <dt>What the agent gets</dt>
            <dd>
              Your tools, namespaced <code>ext_&lt;connection&gt;_*</code>, alongside its built-in
              ones — but only the ones you explicitly allow.
            </dd>
            <dt>When your server is down</dt>
            <dd>
              The agent answers without those tools. A broken connector never breaks a conversation.
            </dd>
          </dl>

          <h2 className="tag-h" id="connect" style={{ marginTop: 56 }}>
            1 · Connect the server
          </h2>
          <p className="tag-blurb">
            In the dashboard, <em>Integrations → Customer self-service MCP server</em>. Paste the
            endpoint URL. The bearer token is entered in the dashboard through a one-time credential
            link, never pasted into a chat with an agent.
          </p>

          <h2 className="tag-h" id="test" style={{ marginTop: 56 }}>
            2 · Test, and read the exposure line
          </h2>
          <p className="tag-blurb">
            Munin connects and lists every tool your server offers. The result will say{' '}
            <code>0 exposed to customers</code>. That is correct — a fresh connection exposes
            nothing.
          </p>

          <h2 className="tag-h" id="allow" style={{ marginTop: 56 }}>
            3 · Choose what customers may reach
          </h2>
          <p className="tag-blurb">
            Open <em>Choose tools</em>{' '}
            on the connection&rsquo;s menu. Munin asks your server what it offers and lists every
            tool with a checkbox; tick the ones customers may call. This is the safety mechanism: a
            server you misconfigured, or pointed at the wrong system, stays silent until a human
            deliberately ticks something. Agents do the same thing with{' '}
            <code>connectors_list_server_tools</code> and <code>connectors_set_allowed_tools</code>.
          </p>
          <dl className="docs-attrs">
            <dt>Not marked read-only</dt>
            <dd>
              Any tool your server hasn&rsquo;t marked <code>readOnlyHint</code> is flagged in the
              picker — a customer asking a question could change data on your side.
            </dd>
            <dt>Muting a server</dt>
            <dd>Empty the allow-list to silence it while keeping the credential and the URL.</dd>
          </dl>

          <h2 className="tag-h" id="identity" style={{ marginTop: 56 }}>
            Who is asking <span className="ct">and how much to trust it</span>
          </h2>
          <p className="tag-blurb">
            Your tools must not take an <code>email</code> or <code>customerId</code>{' '}
            argument. An argument is something a confused or manipulated model can fill in with
            somebody else&rsquo;s identity. Instead every call carries an{' '}
            <code>X-Munin-Identity</code>{' '}
            header — a short-lived ES256 JWT you verify against a public per-org JWKS document —
            naming the person the agent is serving and, crucially, <em>how well that name is
            known</em>.
          </p>
          <dl className="docs-attrs">
            <dt>
              <code>authenticated</code>
            </dt>
            <dd>
              Your backend vouched for them: an identity-verified widget session, or a delegated
              token you minted after logging them in. Treat as signed in.
            </dd>
            <dt>
              <code>channel_asserted</code>
            </dt>
            <dd>
              Taken from the channel envelope — an email <code>From:</code> header, an SMS sender, a
              caller ID. <strong>All spoofable.</strong>{' '}
              Anyone can send mail claiming to be someone. Fine for order status; not sufficient on
              its own for anything you wouldn&rsquo;t put on a postcard.
            </dd>
            <dt>
              <code>self_reported</code>
            </dt>
            <dd>An address typed into a chat by an anonymous visitor. Worthless as identity.</dd>
          </dl>
          <p className="tag-blurb">
            Provenance describes the turn happening right now, not the person&rsquo;s history. If a
            customer once signed in through the widget and someone later emails pretending to be
            them, that email arrives as <code>channel_asserted</code> — never{' '}
            <code>authenticated</code>. Decide per tool what the minimum is and enforce it
            server-side; for anything sensitive, do your own step-up first.
          </p>

          <h2 className="tag-h" id="next" style={{ marginTop: 56 }}>
            The full contract <span className="ct">with a server you can fork</span>
          </h2>
          <p className="tag-blurb">
            The complete specification — bearer auth, assertion verification, tool-shape rules,
            latency budgets, and a working reference server — lives in the skill your agent reads:{' '}
            <Link href="/docs/skills/connectors/connect-custom-mcp-server">
              Connect a custom MCP server
            </Link>
            . For the built-in vendors — Shopify, Magento, Gastroplanner — see{' '}
            <Link href="/docs/skills/connectors/connect-external-system">
              Connect an external system
            </Link>
            .
          </p>
        </div>
      </main>
    </>
  );
}
