import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';
import { CopyPromptButton } from '../../_components/copy-prompt-button';

export const metadata = {
  title: 'Munin · Lead Scoring recipe',
  description:
    'Agent recipe that ranks a CRM segment by fit and intent using enrichment data, conversation tone, and recent activity.',
};

const PROMPT = `You are the lead scorer.

Goal: produce a defensible score on every contact in the target segment so
the sales team knows where to spend the next hour. The score is for humans
— it must come with a one-line rationale they can argue with.

Workflow (run weekly, Monday 07:00 local):
1. Call crm_list_contacts_in_segment(segmentId) for the named target segment.
   Page through everyone.
2. For each contact, gather signal:
   - call crm_get_contact for the enriched fields (role, seniority, industry,
     size band, aiSummary)
   - call crm_list_activities(contactId, limit=20) for recent emails, calls,
     visits, support touches
   - if you have time, call conv_search_messages(contactId) to read the last
     few messages from that contact for tone
3. Score on two axes, 0-100 each:
   - fit: how well the company + role match the ideal customer profile
     (define ICP in the segment description and reference it)
   - intent: how strong the recent signal is — opens, replies, pricing-page
     visits, sentiment trending positive
4. Combine into a band: hot (fit ≥70 AND intent ≥70), warm (one ≥70),
   nurture (neither), cold (intent <20 or no activity 60d).
5. Call crm_set_ai_summary(contactId, summary) with: "<band>: <one-line
   rationale tying score to two specific facts>".

Constraints:
- Never call crm_change_stage or move a deal. The score is advisory.
- Cite at least one concrete activity or enrichment fact in every rationale.
  "high intent" alone isn't enough — say which behaviour.
- A contact with no enrichment yet is cold by default; flag for the enricher
  rather than scoring on missing data.`;

export default function RecipeLeadScoring() {
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
              <em>Lead Scoring</em>.
            </h1>
            <p className="lede">
              Ranks a target segment by fit and intent, leaves a one-line rationale a salesperson
              can argue with.
            </p>
          </header>

          <h2 className="tag-h" id="how">
            How it works
          </h2>
          <p className="tag-blurb">
            Once a week, the scorer walks a target segment and pulls together everything the CRM
            knows about each contact — enrichment fields, recent activities, the tone of their last
            few messages. It produces two scores: fit, against an ICP defined in the segment, and
            intent, from observed behaviour.
          </p>
          <p className="tag-blurb">
            The scores combine into a band — hot, warm, nurture, cold — and a one-sentence
            rationale that cites at least one concrete fact. The output is written back as the
            contact&rsquo;s AI summary, so it shows up wherever the sales team already looks. The
            recipe never moves deals or stages on its own.
          </p>

          <h2 className="tag-h" id="meta" style={{ marginTop: 56 }}>
            At a glance
          </h2>
          <dl className="docs-attrs">
            <dt>Cadence</dt>
            <dd>Weekly, Monday morning local time.</dd>
            <dt>Tools</dt>
            <dd>
              <code>crm_list_contacts_in_segment</code>, <code>crm_get_contact</code>,{' '}
              <code>crm_list_activities</code>, <code>conv_search_messages</code>,{' '}
              <code>crm_set_ai_summary</code>
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
