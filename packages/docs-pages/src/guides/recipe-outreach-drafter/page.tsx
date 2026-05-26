import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';
import { CopyPromptButton } from '../../_components/copy-prompt-button';

export const metadata = {
  title: 'Munin · Outreach Drafter recipe',
  description:
    'Agent recipe that builds outbound campaigns from a brief and drafts personalised opener emails for human approval.',
};

const PROMPT = `You are the outreach drafter.

Goal: take a campaign brief from a human, target a CRM segment, and queue
personalised opener emails for HITL approval.

Brief format the human will give you:
- offer (e.g. "30-min demo of conversation routing")
- segment (segment name or natural-language ICP)
- volume (e.g. "50 contacts")
- tone (e.g. "warm, peer-to-peer")

Workflow:
1. Call crm_list_segments and pick the matching one. If no segment fits, stop
   and ask the human to create one — never invent ad-hoc filters.
2. Call crm_list_contacts_in_segment. The result already enforces suppression
   and consent floors, so trust it. If the count is more than 2x the
   requested volume, ask the human to narrow.
3. Call outreach_create_campaign with enabled=false. Name it after the
   offer + date.
4. For each contact (up to volume), call crm_get_contact and pick one
   specific hook from their profile or recent activity. If you can't find
   one, drop the contact.
5. Call outreach_propose_initial per contact. Subject: six words or fewer,
   lowercase. Body: hook, one-line value prop, soft CTA, sign-off — four
   lines total.

Constraints:
- Never enable the campaign or auto-send. HITL only.
- One personalisation hook per email. If you can't find one, drop them.
- No "I hope this finds you well". No "circling back". No "quick question".`;

export default function RecipeOutreachDrafter() {
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
            <div className="eyebrow">Recipe · On-demand</div>
            <h1>
              <em>Outreach Drafter</em>.
            </h1>
            <p className="lede">
              Builds outbound campaigns from a brief, drafts personalised opener emails for review.
            </p>
          </header>

          <h2 className="tag-h" id="how">
            How it works
          </h2>
          <p className="tag-blurb">
            You hand the drafter a brief — offer, target segment, volume, tone. It picks the
            matching CRM segment (refusing to invent ad-hoc filters), creates a disabled campaign,
            and drafts one personalised opener per contact. Each opener pulls a hook from the
            contact&rsquo;s profile or recent activity; contacts without a hook are dropped rather
            than padded with filler.
          </p>
          <p className="tag-blurb">
            The campaign stays disabled, the proposals sit in the outreach queue, and a human
            approves or rewrites each one before anything goes out. Subject lines are short and
            lowercase; bodies are four lines flat.
          </p>

          <h2 className="tag-h" id="meta" style={{ marginTop: 56 }}>
            At a glance
          </h2>
          <dl className="docs-attrs">
            <dt>Cadence</dt>
            <dd>On demand, when a human files a brief.</dd>
            <dt>Tools</dt>
            <dd>
              <code>crm_list_segments</code>, <code>crm_list_contacts_in_segment</code>,{' '}
              <code>crm_get_contact</code>, <code>outreach_create_campaign</code>,{' '}
              <code>outreach_propose_initial</code>
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
