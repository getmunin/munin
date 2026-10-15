import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_EMAIL_TEMPLATE,
  compileEmail,
  personalizeEmail,
  renderEmail,
  validateEmailTemplate,
} from './email-template-render.ts';
import { OutreachInvalidError } from './outreach.service.ts';

const TEMPLATE = `<mjml>
  <mj-head>
    <mj-title>{{subject}}</mj-title>
    <mj-preview>{{preheader}}</mj-preview>
    <mj-attributes>
      <mj-text font-family="Helvetica, Arial, sans-serif" color="#1c1b19" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f6f5f2">
    <mj-section>
      <mj-column>
        <mj-image width="120px" src="https://cdn.acme.test/logo.png" alt="Acme" />
      </mj-column>
    </mj-section>
    {{content}}
    <mj-section>
      <mj-column>
        <mj-text font-size="12px">{{org_name}} · <a href="{{unsubscribe_url}}">Unsubscribe</a></mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

const UNSUBSCRIBE_URL = 'https://api.acme.test/v1/outreach/unsubscribe?token=v1.org_a.cct_b.cmp_c.1.sig&x=1';

async function invalid(promise: Promise<unknown>): Promise<string> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(OutreachInvalidError);
  return (err as Error).message;
}

describe('validateEmailTemplate', () => {
  it('accepts a template with one content slot and an unsubscribe link', async () => {
    const compiled = await validateEmailTemplate(TEMPLATE);
    expect(compiled.html).toContain('{{unsubscribe_url}}');
    expect(compiled.warnings).toEqual([]);
  });

  it('requires {{content}} exactly once', async () => {
    expect(await invalid(validateEmailTemplate(TEMPLATE.replace('{{content}}', '')))).toMatch(
      /\{\{content\}\} exactly once \(found 0\)/,
    );
    expect(
      await invalid(validateEmailTemplate(TEMPLATE.replace('{{content}}', '{{content}}{{content}}'))),
    ).toMatch(/found 2/);
  });

  it('requires an unsubscribe link in an href', async () => {
    const withoutLink = TEMPLATE.replace('<a href="{{unsubscribe_url}}">Unsubscribe</a>', '{{unsubscribe_url}}');
    expect(await invalid(validateEmailTemplate(withoutLink))).toMatch(/\{\{unsubscribe_url\}\} in an href/);
  });

  it('rejects unknown placeholders and fallbacks on anything but {{name}}', async () => {
    expect(await invalid(validateEmailTemplate(TEMPLATE.replace('{{org_name}}', '{{company}}')))).toMatch(
      /unknown placeholder \{\{company\}\}/,
    );
    expect(
      await invalid(validateEmailTemplate(TEMPLATE.replace('{{org_name}}', '{{org_name|Acme}}'))),
    ).toMatch(/only \{\{name\}\} takes a fallback/);
  });

  it('requires {{content}} where sections may go, and reports the template line', async () => {
    const nested = TEMPLATE.replace('{{content}}', '').replace(
      '<a href="{{unsubscribe_url}}">Unsubscribe</a></mj-text>',
      '<a href="{{unsubscribe_url}}">Unsubscribe</a></mj-text>{{content}}',
    );
    expect(await invalid(validateEmailTemplate(nested))).toMatch(
      /template line 18 \(\{\{content\}\}\): mj-section cannot be used inside mj-column/,
    );
  });

  it.each([
    ['<script>', '<mj-raw><script>alert(1)</script></mj-raw>', /<script> element/],
    ['an event handler', '<mj-raw><img src="https://x.test/a.png" onerror="alert(1)"></mj-raw>', /event handler/],
    ['a javascript: link', '<mj-raw><a href="javascript:alert(1)">x</a></mj-raw>', /javascript: URL/],
    ['an entity-encoded javascript: link', '<mj-raw><a href="&#106;avascript:alert(1)">x</a></mj-raw>', /javascript: URL/],
    ['a data: image', '<mj-raw><img src="data:image/png;base64,AAAA"></mj-raw>', /data: URL/],
    ['mj-include', '<mj-include path="/etc/passwd" />', /mj-include/],
    ['CSS @import', '<mj-raw><style>@import url(https://x.test/a.css);</style></mj-raw>', /@import/],
    ['a form', '<mj-raw><form action="https://x.test"></form></mj-raw>', /<form> element/],
  ])('rejects a template with %s', async (_label, markup, expected) => {
    const unsafe = TEMPLATE.replace('<mj-body background-color="#f6f5f2">', `<mj-body background-color="#f6f5f2">${markup}`);
    expect(await invalid(validateEmailTemplate(unsafe))).toMatch(expected);
  });

  it('never reveals server paths in validation messages', async () => {
    const broken = TEMPLATE.replace('{{content}}', '{{content}}<mj-text>stray</mj-text>');
    const message = await invalid(validateEmailTemplate(broken));
    expect(message).toMatch(/MJML validation failed/);
    expect(message).not.toContain(process.cwd());
  });

  it('warns about images without alt text', async () => {
    const compiled = await validateEmailTemplate(TEMPLATE.replace(' alt="Acme"', ''));
    expect(compiled.warnings.join(' ')).toMatch(/no alt text/);
  });
});

describe('compileEmail', () => {
  it('wraps markdown content in a section and keeps the markdown renderer’s escaping', async () => {
    const compiled = await compileEmail(TEMPLATE, {
      format: 'markdown',
      body: '# October update\n\nHi {{name|there}}, <b>bold</b> and [a link](https://acme.test/changelog).',
    });
    expect(compiled.html).toContain('October update');
    expect(compiled.html).toContain('href="https://acme.test/changelog"');
    expect(compiled.html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(compiled.html).toContain('{{name|there}}');
  });

  it('inserts mjml content sections and reports content line numbers', async () => {
    const card = [
      '<mj-section background-color="#ffffff">',
      '  <mj-column>',
      '    <mj-text><h2>Voice notes</h2><p>Record a note in the inbox.</p></mj-text>',
      '    <mj-button href="https://acme.test/changelog#voice-notes">Read more</mj-button>',
      '  </mj-column>',
      '</mj-section>',
    ].join('\n');
    const compiled = await compileEmail(TEMPLATE, { format: 'mjml', body: card });
    expect(compiled.html).toContain('Voice notes');
    expect(compiled.html).toContain('https://acme.test/changelog#voice-notes');

    const broken = card.replace('<mj-column>', '<mj-column><mj-section></mj-section>');
    expect(await invalid(compileEmail(TEMPLATE, { format: 'mjml', body: broken }))).toMatch(
      /content line 2: mj-section cannot be used inside mj-column/,
    );
  });

  it('screens mjml content like a template, and rejects whole documents', async () => {
    expect(
      await invalid(
        compileEmail(TEMPLATE, {
          format: 'mjml',
          body: '<mj-section><mj-column><mj-text><a href="javascript:alert(1)">x</a></mj-text></mj-column></mj-section>',
        }),
      ),
    ).toMatch(/content links to a javascript: URL/);
    expect(
      await invalid(compileEmail(TEMPLATE, { format: 'mjml', body: '<mjml><mj-body></mj-body></mjml>' })),
    ).toMatch(/fragment of <mj-section>/);
  });

  it('limits content to per-message placeholders', async () => {
    expect(
      await invalid(compileEmail(TEMPLATE, { format: 'markdown', body: 'Bye: {{unsubscribe_url}}' })),
    ).toMatch(/content may not use \{\{unsubscribe_url\}\}/);
    expect(await invalid(compileEmail(TEMPLATE, { format: 'markdown', body: '   ' }))).toMatch(
      /content must be non-empty/,
    );
  });
});

describe('personalizeEmail', () => {
  it('fills placeholders with escaped values and falls back for an empty name', async () => {
    const compiled = await compileEmail(TEMPLATE, { format: 'markdown', body: 'Hi {{name|there}}!' });
    const forKari = personalizeEmail(compiled.html, {
      name: 'Kari <Nordmann>',
      orgName: 'Acme & Co',
      subject: 'What is new',
      preheader: 'Three things shipped',
      unsubscribeUrl: UNSUBSCRIBE_URL,
    });
    expect(forKari.html).toContain('Hi Kari &lt;Nordmann&gt;!');
    expect(forKari.html).toContain('Acme &amp; Co');
    expect(forKari.html).toContain(`href="${UNSUBSCRIBE_URL.replaceAll('&', '&amp;')}"`);
    expect(forKari.html).toContain('<title>What is new</title>');
    expect(forKari.html).not.toMatch(/\{\{/);
    expect(forKari.text).toContain('Hi Kari <Nordmann>!');

    const anonymous = personalizeEmail(compiled.html, { name: null, unsubscribeUrl: UNSUBSCRIBE_URL });
    expect(anonymous.html).toContain('Hi there!');
  });
});

describe('renderEmail', () => {
  it('produces html, a plain-text part and the byte size', async () => {
    const rendered = await renderEmail(
      TEMPLATE,
      { format: 'markdown', body: 'Three things shipped this month.' },
      { orgName: 'Acme', unsubscribeUrl: UNSUBSCRIBE_URL },
    );
    expect(rendered.html.startsWith('<!doctype html>')).toBe(true);
    expect(rendered.text).toContain('Three things shipped this month.');
    expect(rendered.text).toContain('Unsubscribe');
    expect(rendered.text).not.toMatch(/<|\{\{/);
    expect(rendered.htmlBytes).toBe(Buffer.byteLength(rendered.html, 'utf8'));
  });
});

describe('design-email-template skill examples', () => {
  it('compile under the same rules the tools enforce', async () => {
    const skill = readFileSync(new URL('./skills/design-email-template.md', import.meta.url), 'utf8');
    const blocks = [...skill.matchAll(/```xml\n([\s\S]*?)```/g)].map((m) => m[1]!);
    expect(blocks).toHaveLength(2);
    const [template, card] = blocks as [string, string];

    const validated = await validateEmailTemplate(template);
    expect(validated.warnings).toEqual([]);

    const rendered = await renderEmail(
      template,
      { format: 'mjml', body: card },
      { name: 'Kari', orgName: 'Acme', subject: 'October', unsubscribeUrl: UNSUBSCRIBE_URL },
    );
    expect(rendered.html).toContain('Hi Kari, three things shipped this month.');
    expect(rendered.warnings).toEqual([]);
  });
});

describe('draft-changelog-broadcast skill example', () => {
  it('compiles as mjml content inside the built-in template', async () => {
    const skill = readFileSync(new URL('./skills/draft-changelog-broadcast.md', import.meta.url), 'utf8');
    const [card] = [...skill.matchAll(/```xml\n([\s\S]*?)```/g)].map((m) => m[1]!);
    const rendered = await renderEmail(
      BUILT_IN_EMAIL_TEMPLATE,
      { format: 'mjml', body: card! },
      { name: 'Kari', orgName: 'Acme', unsubscribeUrl: UNSUBSCRIBE_URL },
    );
    expect(rendered.html).toContain('Hi Kari, here is what changed for you this month.');
    expect(rendered.warnings).toEqual([]);
  });
});

describe('BUILT_IN_EMAIL_TEMPLATE', () => {
  it('is a valid template with no warnings', async () => {
    const compiled = await validateEmailTemplate(BUILT_IN_EMAIL_TEMPLATE);
    expect(compiled.warnings).toEqual([]);
  });
});
