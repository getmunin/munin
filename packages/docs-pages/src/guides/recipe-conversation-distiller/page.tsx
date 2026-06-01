import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';
import { CopyPromptButton } from '../../_components/copy-prompt-button';

export const metadata = {
  title: 'Munin · Conversation Distiller recipe',
  description:
    'Agent recipe that reads recent conversations for recurring themes and drafts CMS entries that answer them.',
};

const PROMPT = `You are the conversation distiller.

Goal: surface the themes that keep coming up in customer conversations —
recurring questions, repeated complaints, frequent feature asks, common
objections — and turn each one into a long-form CMS draft an editor can
finish.

Workflow (run weekly, Friday 15:00 local):
1. Call conv_list_conversations(status="closed", since="7d") for last week's
   closed threads.
2. For each, call conv_search_messages on representative phrases the customer
   used. Cluster by theme — not just by topic tag. A complaint about onboarding
   and a question about onboarding are different themes.
3. For every theme with three or more distinct conversations, call kb_search
   to see if a help article already covers it. If yes, skip — that's the KB
   curator's job.
4. For genuine gaps, decide the right CMS surface:
   - questions and how-to topics → help-article entry
   - complaints, sentiment patterns, feature asks → blog/changelog draft
     framed as "here's what we heard, here's where we are"
5. Call cms_create_entry(status="draft") with the theme as title, the
   customers' actual phrasing as the opening hook, and a structure an editor
   can finish — never a polished post.

Constraints:
- Never call cms_publish_entry. Drafts only.
- Quote real customers (anonymised). One real quote beats three paraphrases.
- If two themes are obviously the same with different wording, file one entry,
  not two.
- Tag every draft with the source conversation ids so the editor can verify.`;

export default function RecipeConversationDistiller() {
  return (
    <>
      <GuidesSidebar />
      <main className="docs-main">
        <div className="guide-detail">
          <div className="breadcrumb">
            <Link href="/docs/guides">← All guides</Link>
            <span className="crumb-sep">{' / '}</span>
            <span>Recipes</span>
          </div>
          <header className="docs-hero">
            <div className="eyebrow">Recipe · Weekly</div>
            <h1>
              <em>Conversation Distiller</em>.
            </h1>
            <p className="lede">
              Reads last week&rsquo;s threads for the themes that keep coming up — questions,
              complaints, feature asks — and drafts a CMS entry for each.
            </p>
          </header>

          <h2 className="tag-h" id="how">
            How it works
          </h2>
          <p className="tag-blurb">
            Every Friday, the distiller reads last week&rsquo;s closed conversations and clusters
            them by theme. Themes broader than FAQs: a complaint about onboarding, a recurring
            feature ask, a shared misconception about pricing. Each theme that shows up in three or
            more distinct conversations becomes a CMS draft.
          </p>
          <p className="tag-blurb">
            The recipe picks the right surface — help article, blog draft, changelog note — based on
            what the theme actually is. It quotes real customers (anonymised), tags every draft with
            the source conversation ids, and leaves the polish to an editor. Nothing ever publishes
            on its own.
          </p>

          <h2 className="tag-h" id="meta" style={{ marginTop: 56 }}>
            At a glance
          </h2>
          <dl className="docs-attrs">
            <dt>Cadence</dt>
            <dd>Weekly, Friday afternoon local time.</dd>
            <dt>Tools</dt>
            <dd>
              <code>conv_list_conversations</code>, <code>conv_search_messages</code>,{' '}
              <code>kb_search</code>, <code>cms_create_entry</code>
            </dd>
          </dl>

          <h2 className="tag-h" id="prompt" style={{ marginTop: 56 }}>
            System prompt
          </h2>
          <CopyPromptButton prompt={PROMPT} />
          <p className="tag-blurb" style={{ marginTop: 16 }}>
            After pasting, point the agent&rsquo;s MCP at <code>munin</code>.
          </p>
        </div>
      </main>
    </>
  );
}
