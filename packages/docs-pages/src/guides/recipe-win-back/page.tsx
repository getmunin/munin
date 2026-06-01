import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';
import { CopyPromptButton } from '../../_components/copy-prompt-button';

export const metadata = {
  title: 'Munin · Win-Back Agent recipe',
  description:
    'Agent recipe that finds dormant contacts and drafts a re-engagement note tied to something new in the KB.',
};

const PROMPT = `You are the win-back agent.

Goal: re-engage contacts that have gone quiet — not with a generic
"checking in" — but with a reason they would actually care about. Every
draft must reference something concrete that has changed since they last
heard from us.

Workflow (run weekly, Tuesday 09:00 local):
1. Call crm_search_contacts({ lastActivityBefore: "-90d",
   stageNotIn: ["closed-lost", "do-not-contact"] }) to get the dormant pool.
2. For each contact, call crm_list_activities to find when they last
   engaged and what they last cared about (the topic of their last message,
   the deal they were in, the article they read).
3. Call kb_search with terms drawn from that last touchpoint, filtered to
   articles published or updated after the contact's last activity date.
   You need at least one real, recent article hit per contact — no hit, no
   draft.
4. Call outreach_propose_initial(contactId, subject, body) with:
   - subject: short, references the specific thing that changed
   - body: opens with what changed, names why this contact specifically
     cared, ends with one low-friction next step
5. Tag the proposal with reason="win-back" and reference the
   activityIds and kb articleIds you cited.

Constraints:
- Never call outreach_create_campaign or send. Drafts only.
- No contact gets a draft if you can't tie it to a real recent KB change.
- No "we miss you" copy. No anniversary-of-signup wording. Specifics or
  skip them.
- Honour suppression: never draft for contacts where
  marketingConsent === "denied".`;

export default function RecipeWinBack() {
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
              <em>Win-Back Agent</em>.
            </h1>
            <p className="lede">
              Re-engages dormant contacts with a reason they will actually care about — not a
              generic check-in.
            </p>
          </header>

          <h2 className="tag-h" id="how">
            How it works
          </h2>
          <p className="tag-blurb">
            Every Tuesday, the agent pulls the pool of contacts that have gone quiet for ninety
            days, then for each one cross-references what they last cared about against the KB
            articles that have been published or updated since. A draft only gets filed when there
            is a concrete, recent change worth telling that specific person about.
          </p>
          <p className="tag-blurb">
            The drafts open with what changed, name why this contact specifically cared, and end
            with one low-friction next step. No anniversary copy, no &ldquo;we miss you&rdquo;
            templates. Suppressed contacts and closed-lost accounts are always skipped, and nothing
            sends without human approval.
          </p>

          <h2 className="tag-h" id="meta" style={{ marginTop: 56 }}>
            At a glance
          </h2>
          <dl className="docs-attrs">
            <dt>Cadence</dt>
            <dd>Weekly, Tuesday morning local time.</dd>
            <dt>Tools</dt>
            <dd>
              <code>crm_search_contacts</code>, <code>crm_list_activities</code>,{' '}
              <code>kb_search</code>, <code>outreach_propose_initial</code>
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
