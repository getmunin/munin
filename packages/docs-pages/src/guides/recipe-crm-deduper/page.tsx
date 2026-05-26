import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';
import { CopyPromptButton } from '../../_components/copy-prompt-button';

export const metadata = {
  title: 'Munin · CRM Deduper recipe',
  description:
    'Agent recipe that finds duplicate CRM contacts and files structured merge proposals for human review.',
};

const PROMPT = `You are the CRM deduper.

Goal: keep the contact list clean by surfacing duplicates as structured merge
proposals — never merge without HITL approval.

Workflow (run daily, 02:00 local):
1. Call crm_list_contacts to walk the contact list in pages.
2. For each contact, call crm_search_contacts on its name and email-local-part
   to find near-duplicates (same person at a different email, typos, etc.).
3. Score each candidate pair:
   - high: identical normalised email OR identical phone OR exact name+domain match.
   - medium: fuzzy name match + same company.
   Skip everything below medium.
4. Call crm_list_merge_proposals(status="pending") to dedupe against open
   proposals before filing a new one.
5. Call crm_propose_merge_candidate with confidence, evidence (the matching
   fields), and recommendedKeeperId (prefer the one with more activities or
   the verified email).

Constraints:
- Never call crm_apply_merge_proposal directly. Always propose.
- Don't propose merges across companies unless there's a phone or email match.
- One open proposal per pair — don't re-file if one is already pending.`;

export default function RecipeCrmDeduper() {
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
              <em>CRM Deduper</em>.
            </h1>
            <p className="lede">
              Finds duplicate contacts, files structured merge proposals for review.
            </p>
          </header>

          <h2 className="tag-h" id="how">
            How it works
          </h2>
          <p className="tag-blurb">
            Overnight, the deduper walks the contact list and looks for near-duplicates — the same
            person at a different email, typos, the company-domain trick. Each candidate pair is
            scored by the strength of the match. Anything below &ldquo;medium&rdquo; is dropped.
          </p>
          <p className="tag-blurb">
            High-confidence pairs are filed as merge proposals with structured evidence: which
            fields matched, which record looks like the better &ldquo;keeper,&rdquo; and why. A
            human approves or dismisses each one from the merge inbox — the recipe never applies a
            merge itself.
          </p>

          <h2 className="tag-h" id="meta" style={{ marginTop: 56 }}>
            At a glance
          </h2>
          <dl className="docs-attrs">
            <dt>Cadence</dt>
            <dd>Daily, overnight local time.</dd>
            <dt>Tools</dt>
            <dd>
              <code>crm_list_contacts</code>, <code>crm_search_contacts</code>,{' '}
              <code>crm_propose_merge_candidate</code>, <code>crm_list_merge_proposals</code>
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
