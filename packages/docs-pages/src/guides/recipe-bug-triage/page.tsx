import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';
import { CopyPromptButton } from '../../_components/copy-prompt-button';

export const metadata = {
  title: 'Munin · Bug Triage recipe',
  description:
    'Agent recipe that clusters broken-behaviour phrases across conversations and files internal notes engineering can triage.',
};

const PROMPT = `You are the bug triage agent.

Goal: catch real product issues hiding in conversations and flag them as
internal notes — not noise.

Workflow (run daily, 10:00 local):
1. Call conv_list_conversations(status="open", needsHumanAttention=true) plus
   conversations closed in the last seven days.
2. Call conv_search_messages for repeated phrases that suggest broken
   behaviour: "doesn't work", "stopped working", "error", "blank screen",
   etc. Cluster results that share a verb and an object.
3. For each cluster of 4+ conversations, classify:
   - bug: multiple users describing the same broken behaviour.
   - confusion: users misreading something that works as designed.
   - request: a feature that doesn't exist.
   Only proceed with bugs.
4. For each bug cluster, pick a representative conversation and call
   conv_send_message with internal=true. Body must include:
   - what the user did
   - what they expected
   - what happened
   - the conversation IDs of the cluster
   Prefix the body with "[bug-triage] " so reviewers can filter.

Constraints:
- Never reply to the end-user. Internal notes only.
- Never flag from a single conversation. Wait for the cluster.
- If you're not sure it's a bug, classify confusion and stop.`;

export default function RecipeBugTriage() {
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
              <em>Bug Triage</em>.
            </h1>
            <p className="lede">
              Clusters broken-behaviour phrases across conversations and files internal notes
              engineering can triage.
            </p>
          </header>

          <h2 className="tag-h" id="how">
            How it works <span className="ct">internal notes only</span>
          </h2>
          <p className="tag-blurb">
            Once a day, the spotter scans open conversations and anything closed in the past week
            for phrases that suggest broken behaviour — &ldquo;doesn&rsquo;t work,&rdquo;
            &ldquo;stopped working,&rdquo; &ldquo;blank screen.&rdquo; It clusters results that
            share a verb and an object, then classifies each cluster as bug, confusion, or
            feature-request.
          </p>
          <p className="tag-blurb">
            Only bug clusters of four or more conversations get flagged. The spotter picks a
            representative conversation, posts an internal note with what the user did, expected,
            and saw, and includes the full list of related conversation IDs. It never replies to
            the end-user; the note is for the engineering reviewer.
          </p>

          <h2 className="tag-h" id="meta" style={{ marginTop: 56 }}>
            At a glance
          </h2>
          <dl className="docs-attrs">
            <dt>Cadence</dt>
            <dd>Daily, mid-morning local time.</dd>
            <dt>Tools</dt>
            <dd>
              <code>conv_list_conversations</code>, <code>conv_search_messages</code>,{' '}
              <code>conv_get_conversation</code>, <code>conv_send_message</code>
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
