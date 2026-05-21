import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';

export const metadata = {
  title: 'Munin · Skills vs. tools vs. REST',
  description:
    "Three surfaces that look interchangeable on a slide, and aren't. A short guide to picking the right one.",
};

export default function SkillsVsToolsVsRest() {
  return (
    <>
    <GuidesSidebar />
    <main className="docs-main">
    <div className="guide-detail">
      <div className="breadcrumb">
        <Link href="/docs/guides">← All guides</Link>
        <span className="crumb-sep">/</span>
        <span>Concepts</span>
      </div>
      <header className="docs-hero">
        <div className="eyebrow">Guide · Concepts</div>
        <h1>
          Skills vs. tools vs. <em>REST</em>.
        </h1>
        <p className="lede">
          Three ways something can show up in Munin&rsquo;s API. They overlap enough that people
          treat them as synonyms, then wonder why their agent retries a stripe refund five times in
          a row. They aren&rsquo;t the same shape, and they aren&rsquo;t the same audience.
        </p>
      </header>

      <h2 className="tag-h" id="rest">
        REST <span className="ct">the load-bearing layer</span>
      </h2>
      <p className="tag-blurb">
        The HTTP API at <code>/api/v1/*</code>. Every business operation Munin can perform lives
        here first — channels, conversations, contacts, KB, agents. It&rsquo;s how the dashboard
        talks to the backend, how integrations push data in, and how every other surface in this
        article gets its work done underneath.
      </p>
      <dl className="docs-attrs">
        <dt>Shape</dt>
        <dd>
          Conventional REST: nouns as resources, verbs as methods, Zod-validated JSON bodies, RLS
          on every read. OpenAPI-described so you can generate clients.
        </dd>
        <dt>Audience</dt>
        <dd>
          Mostly <code>admin</code>. A small slice (the widget endpoints, end-user
          conversations) accepts <code>self_service</code> credentials.
        </dd>
        <dt>When to use</dt>
        <dd>
          Anything your own code calls. Backend integrations, scheduled jobs, the dashboard, scripts.
          If a human or a deterministic program is making the request, REST is the right surface.
        </dd>
      </dl>

      <h2 className="tag-h" id="tools" style={{ marginTop: 56 }}>
        MCP tools <span className="ct">REST, shaped for an LLM</span>
      </h2>
      <p className="tag-blurb">
        Tools are the same operations as REST, exposed through the Model Context Protocol. Each
        tool is a typed function the agent can call — a name, a JSON-schema input, a description
        the model reads to decide whether to invoke it.
      </p>
      <dl className="docs-attrs">
        <dt>Shape</dt>
        <dd>
          One JSON-RPC endpoint at <code>/mcp</code>, served at{' '}
          <code>mcp.getmunin.com</code>. The tool list is filtered by the caller&rsquo;s audience.
          Inputs are validated by the same Zod schemas as REST.
        </dd>
        <dt>Audience</dt>
        <dd>
          Whatever the bearer token resolves to. An admin key sees the back-office toolset
          (channel setup, key rotation, KB writes). A delegated token sees the self-service subset
          (read your own conversations, place your own order).
        </dd>
        <dt>When to use</dt>
        <dd>
          Anywhere an LLM is the caller. The Munin agent runtime, Claude Desktop, anything that
          speaks MCP. The descriptions matter: they&rsquo;re the prompt the model reads to pick a
          tool, not internal documentation.
        </dd>
      </dl>

      <h2 className="tag-h" id="skills" style={{ marginTop: 56 }}>
        Skills <span className="ct">prose the agent loads on demand</span>
      </h2>
      <p className="tag-blurb">
        Skills are Markdown files. They&rsquo;re not functions the agent calls; they&rsquo;re
        procedures it <em>reads</em>. A skill explains how to do something with the tools that
        already exist — &ldquo;onboarding a new chat channel,&rdquo; &ldquo;handling a refund
        request,&rdquo; &ldquo;triaging a low-confidence intent.&rdquo;
      </p>
      <dl className="docs-attrs">
        <dt>Shape</dt>
        <dd>
          A <code>.md</code> file with YAML frontmatter (title, description, audiences) and a body
          written like a runbook — short, imperative, ordered. Indexed at startup and loaded into
          the agent&rsquo;s context only when its description matches the situation.
        </dd>
        <dt>Audience</dt>
        <dd>
          Tagged the same way tools are. An <code>admin</code>-only skill won&rsquo;t surface in
          a self-service agent&rsquo;s skill list, so it can&rsquo;t accidentally follow a runbook
          that calls tools it doesn&rsquo;t have access to.
        </dd>
        <dt>When to use</dt>
        <dd>
          When the &ldquo;how&rdquo; is non-obvious, multi-step, or worth standardizing. Skills are
          how you encode institutional knowledge: which channel to use for what, what order to
          touch endpoints in, when to escalate.
        </dd>
      </dl>

      <h2 className="tag-h" id="contrast" style={{ marginTop: 56 }}>
        How they relate
      </h2>
      <p className="tag-blurb">
        REST is the load-bearing layer; tools are REST with a coat of LLM-readable paint; skills
        are documentation about how to use the tools well. A skill that lists three tool calls in
        order is a skill that turns into a deterministic workflow if you read it strictly — but
        the whole point of writing it as a skill is that the agent can deviate when reality does.
      </p>
      <dl className="docs-attrs">
        <dt>REST → tools</dt>
        <dd>
          Most tools wrap a REST endpoint with the same auth and validation. A new business
          operation gets added to REST first; the tool is a thin shim with an LLM-friendly
          description.
        </dd>
        <dt>Tools → skills</dt>
        <dd>
          Skills reference tools by name. A &ldquo;refund a customer&rdquo; skill cites{' '}
          <code>commerce_get_order</code>, <code>commerce_refund_payment</code>, and{' '}
          <code>conv_send_message</code> — and explains when to use each.
        </dd>
        <dt>Skills are not tools</dt>
        <dd>
          The agent can&rsquo;t &ldquo;invoke&rdquo; a skill. It loads the text and follows the
          procedure with judgment. If you find yourself reaching for skill-as-API, you actually
          want a tool that wraps the workflow.
        </dd>
      </dl>

      <h2 className="tag-h" id="picking" style={{ marginTop: 56 }}>
        Picking the right one
      </h2>
      <dl className="docs-attrs">
        <dt>My backend code needs to do X</dt>
        <dd>
          REST. You&rsquo;re writing deterministic code — types, retries, your own error handling.
          Tools and skills add overhead you don&rsquo;t need.
        </dd>
        <dt>The agent needs to perform an operation</dt>
        <dd>
          Tool. Add or extend the MCP tool that wraps the underlying REST call, with a description
          aimed at the model.
        </dd>
        <dt>The agent keeps doing the right thing the wrong way</dt>
        <dd>
          Skill. The tools are right; the procedure is unclear. Write the runbook.
        </dd>
        <dt>The agent retries a deterministic workflow</dt>
        <dd>
          Tool, not skill. If a sequence of steps must happen in order with the same inputs every
          time, encapsulate it as a single tool. Don&rsquo;t make the model rediscover the
          sequence on every turn.
        </dd>
      </dl>
    </div>
    </main>
    </>
  );
}
