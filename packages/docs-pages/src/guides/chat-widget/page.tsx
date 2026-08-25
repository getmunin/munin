import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';
import { stripTrailingSlashes } from '@getmunin/types';

export const metadata = {
  title: 'Munin · Chat widget',
  description: 'Drop-in browser chat widget for Munin. Embed snippet, options, identity verification.',
};

export default function WidgetGuide() {
  const host = stripTrailingSlashes(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001');
  return (
    <>
    <GuidesSidebar />
    <main className="docs-main">
    <div className="guide-detail">
      <div className="breadcrumb">
        <Link href="/docs/guides">← All guides</Link>
        <span className="crumb-sep">{' / '}</span>
        <span>Embeds</span>
      </div>
      <header className="docs-hero">
        <div className="eyebrow">Guide · Embeds</div>
        <h1>
          Drop-in <em>chat widget</em>.
        </h1>
        <p className="lede">
          One <code style={{ fontFamily: 'var(--munin-mono)' }}>&lt;script&gt;</code>{' '}
          tag on your site gives visitors a chat launcher that opens a Munin conversation. The
          widget runs inside a Shadow DOM, so your host page&rsquo;s CSS can&rsquo;t bleed in and
          ours can&rsquo;t bleed out.
        </p>
      </header>

      <h2 className="tag-h" id="quick-start">
        Quick start <span className="ct">paste &amp; ship</span>
      </h2>
      <p className="tag-blurb">
        Mint a widget key from Settings → Channels, pick the channel, copy the embed snippet, paste it on
        every page where the launcher should appear.
      </p>
      <div className="curl">
        <div className="curl-h">
          <span>Embed snippet</span>
          <span style={{ color: 'var(--docs-mute)' }}>paste in &lt;body&gt;</span>
        </div>
        <pre>{`<script src="${host}/widget.js"
        data-munin-host="${host}"
        data-widget-key="mn_widget_…"
        data-channel-id="cch_…"
        data-munin-fonts="inherit"
        defer></script>`}</pre>
      </div>

      <h2 className="tag-h" id="required" style={{ marginTop: 56 }}>
        Required attributes
      </h2>
      <dl className="docs-attrs">
        <dt>data-munin-host</dt>
        <dd>
          Origin of your Munin backend. The widget calls the REST API and the realtime WebSocket against
          this host. No trailing slash.
        </dd>
        <dt>data-widget-key</dt>
        <dd>
          Channel-bound API key starting with <code>mn_widget_</code>. Shown once when you create or
          rotate a widget channel. Safe to embed on the public page — the key only authorizes the channel
          it was minted for.
        </dd>
        <dt>data-channel-id</dt>
        <dd>
          The channel the visitor will talk to. Must match the channel the widget key was minted for.
        </dd>
      </dl>

      <h2 className="tag-h" id="options" style={{ marginTop: 56 }}>
        Optional attributes
      </h2>
      <p className="tag-blurb">Add any of these to the script tag to customize the widget.</p>
      <dl className="docs-attrs">
        <dt>data-munin-fonts</dt>
        <dd>
          <code>&quot;bundled&quot;</code> (default) ships subset Instrument Serif + JetBrains Mono with
          the widget — adds ~60 KB and matches the dashboard typography pixel-for-pixel. Set to{' '}
          <code>&quot;inherit&quot;</code> to download no fonts and render every string in whatever
          font-family your page already applies to <code>&lt;body&gt;</code>, so the panel blends into
          your own type stack. Sizes, weights and italics stay as designed either way.
        </dd>
        <dt>data-munin-org-name</dt>
        <dd>Header title shown in the panel. Defaults to <code>&quot;Chat&quot;</code>.</dd>
        <dt>data-munin-eyebrow</dt>
        <dd>Small uppercase label above the welcome greeting, e.g. &ldquo;Acme Support · powered by Munin&rdquo;.</dd>
        <dt>data-munin-theme-color</dt>
        <dd>
          Hex accent color for the unread badge, send button, links, and visitor bubbles. Defaults to{' '}
          <code>#0066FF</code>. Text drawn on top of it flips between ink and paper automatically,
          whichever contrasts better.
        </dd>
        <dt>data-munin-launcher-color</dt>
        <dd>
          Hex fill of the round launcher bubble. Defaults to the widget&rsquo;s near-black chrome tone
          (fixed regardless of light/dark mode), so a brand-colored bubble is an explicit opt-in. The chat
          glyph inside follows with whichever of ink/paper contrasts better.
        </dd>
        <dt>data-munin-launcher-icon-color</dt>
        <dd>
          Hex color of the chat glyph inside the launcher, overriding the automatic contrast pick. Use
          it on its own to recolor the glyph while keeping the default bubble.
        </dd>
        <dt>data-munin-header-color</dt>
        <dd>
          Hex fill of the panel&rsquo;s top bar (org name + close button). Defaults to the same near-black
          chrome as the launcher; the text/icon color follows the same automatic contrast pick.
        </dd>
        <dt>data-munin-color-scheme</dt>
        <dd>
          <code>&quot;auto&quot;</code>{' '}
          (default) follows the visitor&rsquo;s OS/browser preference and updates live if they flip
          it; <code>&quot;light&quot;</code> or <code>&quot;dark&quot;</code>{' '}
          pins the panel regardless of their OS setting. The launcher bubble, header bar and voice-call
          screen keep their fixed near-black chrome in every mode unless you set the color attributes
          above &mdash; only the panel body (welcome/chat/composer/cards) inverts.
        </dd>
        <dt>data-munin-position</dt>
        <dd>
          <code>&quot;bottom-right&quot;</code> (default) or <code>&quot;bottom-left&quot;</code>.
        </dd>
        <dt>data-munin-size</dt>
        <dd>
          Panel size: <code>&quot;compact&quot;</code>, <code>&quot;standard&quot;</code> (default), or{' '}
          <code>&quot;generous&quot;</code>.
        </dd>
        <dt>data-munin-greeting</dt>
        <dd>
          First line on the welcome screen. The widget splits on the first sentence so the second clause
          renders in italic, matching &ldquo;Hi there.{' '}
          <em>How can we help?</em>&rdquo;. Set <code>--munin-greeting-emphasis: normal</code> on{' '}
          <code>[data-munin-widget]</code> from your own stylesheet to keep it upright.
        </dd>
        <dt>data-munin-show-history</dt>
        <dd>
          Set to <code>&quot;false&quot;</code> to hide the past-conversation list on the welcome screen.
        </dd>
      </dl>

      <h2 className="tag-h" id="identity" style={{ marginTop: 56 }}>
        Identity verification <span className="ct">optional</span>
      </h2>
      <p className="tag-blurb">
        If you want to bind a chat thread to a known user (so they resume their conversation on the next
        visit, even from a different device), compute a server-side HMAC with the channel&rsquo;s
        identity secret and pass it as <code>data-user-hash</code>:
      </p>
      <div className="curl">
        <div className="curl-h">
          <span>Node.js</span>
          <span style={{ color: 'var(--docs-mute)' }}>compute on every request</span>
        </div>
        <pre>{`import crypto from 'node:crypto';
const userHash = crypto
  .createHmac('sha256', process.env.MUNIN_IDENTITY_SECRET)
  .update(externalId)
  .digest('hex');`}</pre>
      </div>
      <p className="tag-blurb" style={{ marginTop: 16 }}>
        Then on the script tag:
      </p>
      <div className="curl">
        <div className="curl-h">
          <span>With identity</span>
          <span style={{ color: 'var(--docs-mute)' }}>visitor binds to externalId</span>
        </div>
        <pre>{`<script src="${host}/widget.js"
        data-munin-host="${host}"
        data-widget-key="mn_widget_…"
        data-channel-id="cch_…"
        data-external-id="user_42"
        data-user-hash="<hex digest>"
        defer></script>`}</pre>
      </div>
      <p className="tag-blurb" style={{ marginTop: 16 }}>
        Without identity, the widget identifies the visitor by a UUID kept in <code>localStorage</code>{' '}
        (with a cookie fallback) — refreshes resume the same thread, but a different browser starts fresh.
      </p>
      <p className="tag-blurb" style={{ marginTop: 16 }}>
        Both <code>localStorage</code> and the fallback cookie are scoped to the exact host by default, so a
        conversation started on <code>www.example.com</code> does <em>not</em> carry over to{' '}
        <code>app.example.com</code>. To share one thread across sibling subdomains, set{' '}
        <code>data-munin-cookie-domain=&quot;.example.com&quot;</code>{' '}
        on every page&rsquo;s embed — the session and visitor cookies are then written with that{' '}
        <code>Domain</code>{' '}
        and the anonymous thread is claimed when the visitor signs in on the app. The value must be
        a suffix of the page&rsquo;s host, or it&rsquo;s ignored.
      </p>

      <h3 className="tag-h" id="identify-after-load" style={{ marginTop: 32 }}>
        Identify after script load (SPAs)
      </h3>
      <p className="tag-blurb">
        If sign-in happens <em>after</em> the widget loads — typical for single-page apps where login is a
        route change, not a full reload — call <code>window.mn.widget.identify(externalId, userHash)</code>{' '}
        once the user is known. The widget POSTs to <code>/v1/widget/identify</code>, reconnects its WebSocket
        under the new identity, and the backend migrates the current chat: the anonymous end-user becomes
        the verified one, the contact&rsquo;s <code>externalId</code> is updated, and the conversation
        history stays put.
      </p>
      <div className="curl">
        <div className="curl-h">
          <span>Browser</span>
          <span style={{ color: 'var(--docs-mute)' }}>after the user signs in</span>
        </div>
        <pre>{`// userHash is the same server-signed HMAC as data-user-hash above —
// compute it once the externalId is known and hand it to the widget.
const go = () => window.mn.widget.identify(externalId, userHash);

window.mn?.widget?.ready
  ? go()
  : document.addEventListener('munin:widget-ready', go, { once: true });`}</pre>
      </div>
      <p className="tag-blurb" style={{ marginTop: 16 }}>
        The widget installs its namespace when it mounts and fires{' '}
        <code>munin:widget-ready</code>, so gate on <code>window.mn.widget.ready</code> or that event
        rather than polling. The analytics tracker has its own{' '}
        <code>window.mn.analytics.identify()</code> with a different hash and a different secret — the
        two never share a call. Idempotent — calling it twice with the
        same <code>externalId</code> is a no-op. Calling it with a
        different <code>externalId</code>{' '}
        on a session that&rsquo;s already verified returns 403; mint a fresh session if you genuinely
        need to swap identities mid-flight.
      </p>

      <h2 className="tag-h" id="programmatic" style={{ marginTop: 56 }}>
        Programmatic open/close
      </h2>
      <p className="tag-blurb">
        Once the deferred script has executed, <code>window.mn.widget</code> exposes{' '}
        <code>open()</code>, <code>close()</code>, <code>toggle()</code>, and{' '}
        <code>isOpen()</code>{' '}
        so you can drive the panel from your own nav, a &ldquo;Chat with us&rdquo; link, or a
        proactive prompt on a timer — instead of relying on the launcher bubble alone.
      </p>
      <div className="curl">
        <div className="curl-h">
          <span>Browser</span>
          <span style={{ color: 'var(--docs-mute)' }}>anywhere after the script tag runs</span>
        </div>
        <pre>{`document.getElementById('chat-with-us').addEventListener('click', () => {
  window.mn.widget.toggle();
});`}</pre>
      </div>
      <p className="tag-blurb" style={{ marginTop: 16 }}>
        The script tag has <code>defer</code>, so <code>window.mn.widget</code>{' '}
        isn&rsquo;t installed until the page has parsed — safe to call from a click handler, not safe
        to call synchronously from an inline <code>&lt;script&gt;</code>{' '}
        placed above the widget tag. It&rsquo;s a single global: on a page with two widget embeds it
        stays bound to whichever mounted first, and the second logs a console warning rather than
        silently stealing it.
      </p>

      <h2 className="tag-h" id="visitor" style={{ marginTop: 56 }}>
        Visitor profile
      </h2>
      <p className="tag-blurb">
        Pre-populate the visitor&rsquo;s name, email, and arbitrary metadata so they show up immediately
        on the contact row. Useful for logged-in customers.
      </p>
      <dl className="docs-attrs">
        <dt>data-munin-visitor-name</dt>
        <dd>Display name, max 120 chars.</dd>
        <dt>data-munin-visitor-email</dt>
        <dd>Email address. Validated client-side; re-validated by the server on every request.</dd>
        <dt>data-munin-visitor-meta</dt>
        <dd>
          Flat JSON object of string/number/boolean key-values, max 4 KB, e.g.{' '}
          <code>{`'{"plan":"pro","accountId":"acc_42"}'`}</code>. Lands on{' '}
          <code>conv_contacts.metadata</code>.
        </dd>
        <dt>data-munin-meta-&lt;key&gt;</dt>
        <dd>
          Sugar form of the above — every <code>data-munin-meta-*</code> attribute becomes a metadata
          key. <code>data-munin-meta-plan=&quot;pro&quot;</code> ≡ <code>{`{"plan":"pro"}`}</code>.
        </dd>
      </dl>

      <h2 className="tag-h" id="behavior" style={{ marginTop: 56 }}>
        What it does
      </h2>
      <dl className="docs-attrs">
        <dt>Welcome screen</dt>
        <dd>
          Shown on launcher open: greeting, &ldquo;Start a conversation&rdquo; CTA, and the
          visitor&rsquo;s past conversations. Identity-verified visitors see every thread bound to their{' '}
          <code>externalId</code>; anonymous visitors see only threads from session-IDs remembered locally.
        </dd>
        <dt>AI greeting</dt>
        <dd>
          When the visitor clicks &ldquo;Start a conversation&rdquo;, the widget creates the thread
          server-side and the AI runner generates an opening turn from the system prompt. The visitor
          sees the three-dot indicator while the LLM is working, then the greeting lands as a real{' '}
          <code>agent</code> message stored in the conversation.
        </dd>
        <dt>Email capture</dt>
        <dd>
          After the first agent turn, an inline card prompts the visitor to share their email so the
          operator can follow up if the visitor closes the tab. Submitted via{' '}
          <code>PATCH /v1/widget/visitor</code>, persisted on both <code>conv_contacts</code> and{' '}
          <code>end_users</code>.
        </dd>
        <dt>Typing indicator</dt>
        <dd>
          The runner emits realtime <code>typing</code>{' '}
          events while it&rsquo;s generating, with a 3-second keepalive so the indicator stays alive
          through long replies. Server auto-clears after 5 seconds of silence; widget auto-clears
          locally after 5 seconds as a fallback.
        </dd>
        <dt>Handover to a human</dt>
        <dd>
          When an operator takes the conversation (manual claim or agent-requested escalation), the
          widget&rsquo;s chat subtitle flips from &ldquo;Munin AI · instant&rdquo; to the operator&rsquo;s
          name, and subsequent agent bubbles are tagged <code>human</code> instead of <code>AI</code>.
        </dd>
      </dl>

      <h2 className="tag-h" id="security" style={{ marginTop: 56 }}>
        Security
      </h2>
      <dl className="docs-attrs">
        <dt>Origin allowlist</dt>
        <dd>
          Each widget channel has an <code>originAllowlist</code>. The widget&rsquo;s requests carry an{' '}
          <code>Origin</code> header; the server rejects requests from any origin not on the list. No
          allowlist = allow all origins (useful for staging). Set it before going to production.
        </dd>
        <dt>Identity verification</dt>
        <dd>
          The HMAC pairs an <code>externalId</code>{' '}
          to a digest signed with the channel&rsquo;s identity secret. Without this, a visitor
          can&rsquo;t claim someone else&rsquo;s identity — they get an anonymous session bound to
          their local sessionId.
        </dd>
        <dt>Require verified identity</dt>
        <dd>
          Toggle on the channel config to reject anonymous traffic entirely. Useful for in-app embeds
          where every visitor is signed in.
        </dd>
        <dt>Shadow DOM</dt>
        <dd>
          The widget tree lives in an open shadow root. Host-page CSS doesn&rsquo;t reach in, and the
          widget&rsquo;s styles don&rsquo;t reach out. Custom fonts are registered at the document level
          so they cross the shadow boundary cleanly.
        </dd>
      </dl>
    </div>
    </main>
    </>
  );
}
