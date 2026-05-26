import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';
import { CopyPromptButton } from '../../_components/copy-prompt-button';

export const metadata = {
  title: 'Munin · Content Marketer recipe',
  description:
    'Agent recipe that mines customer conversations for FAQs and drafts CMS entries that answer them.',
};

const PROMPT = `You are a content marketer.

Goal: turn recurring questions in customer conversations into published CMS
articles that answer them clearly.

Workflow (run weekly, Monday 09:00 local):
1. Call conv_search_messages on themes that came up repeatedly in the last
   seven days. Keep the customers' verbatim phrasing.
2. For each theme, call kb_search to see whether we already have an internal
   article. If yes, mine it for the answer; if no, draft from the
   conversations.
3. Call cms_list_collections to find the right content type (e.g. "blog-post",
   "help-article"). If unsure, stop and ask.
4. Call cms_create_entry with status="draft". Title should match how
   customers phrase the question; H2s should be the sub-questions that came
   up most. Include one anonymised quote per post.
5. Never call cms_publish_entry directly — file the draft and let a human
   review it in the CMS.

Constraints:
- One post per theme per quarter; if we've covered it, propose an update.
- No marketing language, no exclamation marks. Plain English.
- 700-1200 words per post.`;

export default function RecipeContentMarketer() {
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
              <em>Content Marketer</em>.
            </h1>
            <p className="lede">
              Mines conversations for FAQs and drafts CMS entries that answer them.
            </p>
          </header>

          <h2 className="tag-h" id="how">
            How it works
          </h2>
          <p className="tag-blurb">
            Once a week, the marketer scans the last seven days of conversations for recurring
            customer questions and uses them — verbatim phrasing and all — as the basis for new CMS
            entries. Existing knowledge-base articles feed the body; the conversation themselves
            feed the H2s and the anonymised quotes.
          </p>
          <p className="tag-blurb">
            Drafts land in the CMS with <code>status="draft"</code> for human review. The recipe
            never publishes, and it stays out of marketing voice: plain English, no exclamation
            marks, 700–1200 words.
          </p>

          <h2 className="tag-h" id="meta" style={{ marginTop: 56 }}>
            At a glance
          </h2>
          <dl className="docs-attrs">
            <dt>Cadence</dt>
            <dd>Weekly, Monday morning local time.</dd>
            <dt>Tools</dt>
            <dd>
              <code>conv_search_messages</code>, <code>kb_search</code>,{' '}
              <code>cms_list_collections</code>, <code>cms_create_entry</code>,{' '}
              <code>cms_publish_entry</code>
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
