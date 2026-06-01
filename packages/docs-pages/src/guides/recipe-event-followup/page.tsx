import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';
import { CopyPromptButton } from '../../_components/copy-prompt-button';

export const metadata = {
  title: 'Munin · Event Follow-up recipe',
  description:
    'Agent recipe that bulk-loads an event attendee list into the CRM and drafts personalised post-event openers.',
};

const PROMPT = `You are the event follow-up agent.

Goal: turn the attendee list from a conference, meetup, or webinar into
personalised opener emails — each one tied to what was actually discussed
at the booth or in the session — and have them ready for review by the
salesperson who was there.

Trigger: an on-demand run with the attendee list (CSV or JSON) and a short
event brief written by the salesperson. The brief should name the event,
the booth talking points used, and any standout interactions.

Workflow:
1. Parse the attendee list. Normalise emails. Tag the source: eventName,
   eventDate.
2. Call crm_bulk_create_contacts with the parsed list. Existing contacts
   are returned with their ids; new ones are created. Don't overwrite
   existing role/seniority fields.
3. For each contact, call crm_get_contact to read the current state and
   crm_list_activities to spot existing relationships ("we already have a
   deal with them" changes the opener).
4. Decide the opener angle per contact:
   - genuine new prospect → "thanks for stopping by the booth, here's the
     one thing we said we'd send"
   - existing customer attendee → "good to see you in person, here's the
     change we mentioned"
   - lapsed prospect → "good to reconnect, we shipped X since we last
     talked"
5. Call crm_set_ai_summary with one line tying the contact to the event
   ("met at <event>, asked about <topic>").
6. Call outreach_propose_initial(contactId, subject, body). Cite something
   from the event brief in every draft so the salesperson knows you read it.

Constraints:
- Never call outreach_create_campaign or send. Drafts only.
- If two attendees share an email (common with company-domain catch-alls),
  only one gets a draft — flag the duplicate in its summary.
- Skip contacts with marketingConsent === "denied" — log them as skipped.
- Never invent what someone discussed at the booth. If the brief doesn't
  cover them specifically, use the booth's general talking point.`;

export default function RecipeEventFollowup() {
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
              <em>Event Follow-up</em>.
            </h1>
            <p className="lede">
              Bulk-loads an attendee list and drafts personalised openers tied to what was actually
              discussed at the booth.
            </p>
          </header>

          <h2 className="tag-h" id="how">
            How it works
          </h2>
          <p className="tag-blurb">
            The salesperson who worked the booth hands the agent two things: the attendee list and
            a short event brief — what was on the booth wall, the topics that came up most, any
            standout conversations. The agent loads the list into the CRM in bulk, then walks each
            attendee and chooses the right angle for the follow-up: new prospect, existing customer,
            or lapsed relationship.
          </p>
          <p className="tag-blurb">
            Every draft cites something from the event brief, so the salesperson can verify the
            recipe read it. Existing CRM data is respected — role and seniority fields are never
            overwritten — and consent flags are honoured. Nothing sends without approval.
          </p>

          <h2 className="tag-h" id="meta" style={{ marginTop: 56 }}>
            At a glance
          </h2>
          <dl className="docs-attrs">
            <dt>Cadence</dt>
            <dd>On-demand, run after the event.</dd>
            <dt>Tools</dt>
            <dd>
              <code>crm_bulk_create_contacts</code>, <code>crm_get_contact</code>,{' '}
              <code>crm_list_activities</code>, <code>crm_set_ai_summary</code>,{' '}
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
