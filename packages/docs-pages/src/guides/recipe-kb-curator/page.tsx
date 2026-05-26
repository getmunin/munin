import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';
import { CopyPromptButton } from '../../_components/copy-prompt-button';

export const metadata = {
  title: 'Munin · KB Curator recipe',
  description:
    'Agent recipe that watches conversations for KB gaps, drafts new articles, and queues them for human review.',
};

const PROMPT = `You are the KB curator.

Goal: keep the knowledge base accurate and aligned with what end-users actually
ask. Drafts go to the curation inbox; never publish directly without review.

Workflow (run daily, 18:00 local):
1. Call conv_list_conversations(status="closed", since="24h") and pick a sample
   of resolved conversations.
2. For each, call conv_search_messages with the user's wording to confirm
   recurring questions. Group similar phrasings into one theme.
3. For each theme, call kb_search to check whether we already cover it. If an
   existing article covers ~70% of the answer, stop and note it for an edit
   instead of a new draft.
4. For real gaps (3+ distinct conversations, no good article), call
   kb_propose_curation_candidate with status="proposed". Title in the user's
   own words. Body answerable in <300 words. One concrete example with
   realistic numbers.
5. Never call kb_publish_curation_candidate yourself — leave that to a human
   reviewer in the inbox.

Constraints:
- One article per question. If it's two questions, propose two candidates.
- No marketing voice. Direct, present-tense.
- If the answer depends on the customer's plan or setup, say so explicitly.`;

export default function RecipeKbCurator() {
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
            <div className="eyebrow">Recipe · Daily</div>
            <h1>
              <em>KB Curator</em>.
            </h1>
            <p className="lede">
              Watches conversations for KB gaps, drafts new articles, queues them for review.
            </p>
          </header>

          <h2 className="tag-h" id="how">
            How it works
          </h2>
          <p className="tag-blurb">
            Once a day, the curator samples recently-closed conversations, clusters the questions
            users actually asked, and checks the knowledge base for coverage. When it finds a real
            gap — three or more distinct conversations with no matching article — it drafts a
            candidate and files it in the curation inbox for a human to approve, edit, or reject.
          </p>
          <p className="tag-blurb">
            The recipe never publishes on its own. It is opinionated about voice (direct,
            present-tense, no marketing language) and length (under 300 words per article), so the
            drafts read like the rest of your docs and not like LLM filler.
          </p>

          <h2 className="tag-h" id="meta" style={{ marginTop: 56 }}>
            At a glance
          </h2>
          <dl className="docs-attrs">
            <dt>Cadence</dt>
            <dd>Daily, end of day local time.</dd>
            <dt>Tools</dt>
            <dd>
              <code>conv_search_messages</code>, <code>conv_list_conversations</code>,{' '}
              <code>kb_search</code>, <code>kb_propose_curation_candidate</code>,{' '}
              <code>kb_publish_curation_candidate</code>
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
