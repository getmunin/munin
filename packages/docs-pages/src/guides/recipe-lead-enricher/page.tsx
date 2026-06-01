import { Link } from '../../i18n-navigation';
import { GuidesSidebar } from '../../_components/guides-sidebar';
import { CopyPromptButton } from '../../_components/copy-prompt-button';

export const metadata = {
  title: 'Munin · Lead Enricher recipe',
  description:
    'Agent recipe that enriches new CRM contacts with company context and stamps an AI summary on every record.',
};

const PROMPT = `You are the lead enricher.

Goal: turn a sparse new contact into one that a salesperson can act on
without opening five tabs. Never invent facts — if you can't verify it, leave
the field blank and say so.

Trigger: a webhook or queued event with a contactId for a contact created
in the last hour.

Workflow:
1. Call crm_get_contact(contactId) to read the current record. If role,
   seniority, industry, and aiSummary are all populated, exit early.
2. From the email domain, derive the company website. Fetch the homepage and
   the /about, /team, and /pricing pages with your built-in web tool. Stop
   at four pages.
3. Extract:
   - industry (one of: SaaS, e-commerce, finance, healthcare, education,
     manufacturing, other — pick the closest fit, never "unknown")
   - the company's one-line pitch in their own words
   - rough size band (1-10, 11-50, 51-200, 201-1000, 1000+) from team page
     or About copy
4. From the contact's email + name, infer role and seniority. Don't guess
   beyond what's plausible from the email handle and any signature found
   in their first message.
5. Call crm_update_contact(contactId, { role, seniority, industry, ... })
   with only fields you are confident about.
6. Call crm_set_ai_summary(contactId, summary) with three sentences max:
   who they are, what their company does, and the one thing the salesperson
   should know before reaching out.

Constraints:
- Never write to fields that already have a non-empty value the human set.
- Never invent a LinkedIn URL, phone number, or address. Empty is fine.
- If the company has fewer than 5 visible employees and no pricing page,
  flag it in the aiSummary so sales doesn't waste a touch.`;

export default function RecipeLeadEnricher() {
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
            <div className="eyebrow">Recipe · On signup</div>
            <h1>
              <em>Lead Enricher</em>.
            </h1>
            <p className="lede">
              Turns a sparse new contact into a record a salesperson can act on without opening five
              tabs.
            </p>
          </header>

          <h2 className="tag-h" id="how">
            How it works
          </h2>
          <p className="tag-blurb">
            When a contact is created — via signup, form fill, or CSV — the enricher reads the
            record, derives the company from the email domain, and uses its built-in web tool to
            read a handful of pages on the company site. It extracts industry, size band, the
            company&rsquo;s own pitch, and rough role/seniority signal, then writes the verified
            fields back to the CRM and stamps a three-sentence AI summary.
          </p>
          <p className="tag-blurb">
            The recipe is opinionated about honesty. If a field can&rsquo;t be verified from
            evidence on the public site, it stays blank — never guessed. That keeps the CRM trusted
            and the sales team unsurprised.
          </p>

          <h2 className="tag-h" id="meta" style={{ marginTop: 56 }}>
            At a glance
          </h2>
          <dl className="docs-attrs">
            <dt>Cadence</dt>
            <dd>Event-driven on contact creation.</dd>
            <dt>Tools</dt>
            <dd>
              <code>crm_get_contact</code>, <code>crm_update_contact</code>,{' '}
              <code>crm_set_ai_summary</code>, plus your agent&rsquo;s built-in web fetch.
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
