import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';
import { CopyPromptButton } from '../../_components/copy-prompt-button';

export const metadata = {
  title: 'Munin · Renewal Watcher recipe',
  description:
    'Agent recipe that watches deals for upcoming renewals and drafts outreach when contracts approach end.',
};

const PROMPT = `You are the renewal watcher.

Goal: surface every renewal early enough that an account manager has time to
act — with enough context to act well.

Workflow (run daily, 07:00 local):
1. Call crm_list_deals(stage="active") and filter client-side for deals
   closing within 60 days.
2. For each deal, call crm_get_contact for the primary contact. Read their
   tags, notes, and AI summary if present.
3. Compute a health signal:
   - red: low engagement signals (no recent activity, negative tags).
   - yellow: mixed signals.
   - green: positive recent activity.
   Roll this up and call crm_set_ai_summary on the deal with a 2-3 sentence
   summary including the colour.
4. For yellow and red deals, call outreach_propose_initial drafting an
   account-management email:
   - red: direct check-in, name the concern, propose a working session.
   - yellow: lighter touch, lead with a usage observation, ask one question.
   File the draft against the existing deal owner's outreach campaign — or
   stop and ask the human if no campaign exists.
5. Green deals get a one-line AI summary and no draft.

Constraints:
- Never auto-send. Always HITL via the outreach proposal.
- No "just checking in". Lead with a fact from the account.
- Don't draft for an account that already has an open conversation thread.`;

export default function RecipeRenewalWatcher() {
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
              <em>Renewal Watcher</em>.
            </h1>
            <p className="lede">
              Watches deals for upcoming renewals and drafts outreach when contracts approach end.
            </p>
          </header>

          <h2 className="tag-h" id="how">
            How it works
          </h2>
          <p className="tag-blurb">
            Each morning, the watcher pulls active deals that close within sixty days and reads the
            primary contact&rsquo;s tags, notes, and AI summary. It rolls those signals into a
            traffic-light health score and writes a two-or-three-sentence AI summary onto the deal
            so an account manager has the picture without clicking through.
          </p>
          <p className="tag-blurb">
            Yellow and red deals get a draft outreach email — direct for red, lighter for yellow,
            always opening with a specific fact from the account. The drafts file against the deal
            owner&rsquo;s existing campaign for human approval; nothing ever sends automatically.
          </p>

          <h2 className="tag-h" id="meta" style={{ marginTop: 56 }}>
            At a glance
          </h2>
          <dl className="docs-attrs">
            <dt>Cadence</dt>
            <dd>Daily, first thing local time.</dd>
            <dt>Tools</dt>
            <dd>
              <code>crm_list_deals</code>, <code>crm_get_contact</code>,{' '}
              <code>crm_set_ai_summary</code>, <code>outreach_propose_initial</code>
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
