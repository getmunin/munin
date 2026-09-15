import { describe, it, expect } from 'vitest';
import {
  collectSlackMentionIds,
  mrkdwnToMarkdown,
  unescapeSlackText,
} from './slack-mrkdwn-inbound.ts';

describe('unescapeSlackText', () => {
  it('reverses the three entities Slack escapes', () => {
    expect(unescapeSlackText('a &lt;b&gt; &amp; c')).toBe('a <b> & c');
  });
});

describe('collectSlackMentionIds', () => {
  it('collects only the ids Slack sent without a label', () => {
    expect(collectSlackMentionIds('<@U1> <@U2|kjell> <#C1> <#C2|general> <@U1>')).toEqual({
      users: ['U1'],
      channels: ['C1'],
    });
  });

  it('collects every id shape the converter would substitute', () => {
    const id = 'U-odd.1';
    expect(collectSlackMentionIds(`<@${id}>`).users).toEqual([id]);
    expect(mrkdwnToMarkdown(`<@${id}>`, { users: { [id]: 'Kjell' } })).toBe('@Kjell');
  });
});

describe('mrkdwnToMarkdown', () => {
  it('renders an emoji shortcode as the character the operator typed', () => {
    expect(mrkdwnToMarkdown('Bare hyggelig :slightly_smiling_face:')).toBe('Bare hyggelig 🙂');
    expect(mrkdwnToMarkdown('Hei! :wave: :+1: :100:')).toBe('Hei! 👋 👍 💯');
  });

  it('applies a skin tone modifier to the emoji it follows', () => {
    expect(mrkdwnToMarkdown(':wave::skin-tone-3:')).toBe('👋🏼');
    expect(mrkdwnToMarkdown(':v::skin-tone-2:')).toBe('✌🏻');
  });

  it('leaves a custom workspace emoji alone rather than dropping it', () => {
    expect(mrkdwnToMarkdown('ship it :munin-logo:')).toBe('ship it :munin-logo:');
  });

  it('does not convert a shortcode inside code', () => {
    expect(mrkdwnToMarkdown('use `:wave:` in json')).toBe('use `:wave:` in json');
    expect(mrkdwnToMarkdown('```\n:wave:\n```')).toBe('```\n:wave:\n```');
  });

  it('unescapes entities, including inside code', () => {
    expect(mrkdwnToMarkdown('a &amp; b')).toBe('a & b');
    expect(mrkdwnToMarkdown('`a &lt; b`')).toBe('`a < b`');
  });

  it('turns a labelled link into a markdown link and an unlabelled one into a bare url', () => {
    expect(mrkdwnToMarkdown('see <https://getmunin.com|our docs>')).toBe(
      'see [our docs](https://getmunin.com)',
    );
    expect(mrkdwnToMarkdown('see <https://getmunin.com>')).toBe('see https://getmunin.com');
    expect(mrkdwnToMarkdown('<https://getmunin.com|https://getmunin.com>')).toBe(
      'https://getmunin.com',
    );
  });

  it('leaves a url alone when emphasis or emoji syntax appears inside it', () => {
    expect(mrkdwnToMarkdown('<https://getmunin.com/a_b_c>')).toBe('https://getmunin.com/a_b_c');
    expect(mrkdwnToMarkdown('<https://getmunin.com/x?a=1&amp;b=2|tall>')).toBe(
      '[tall](https://getmunin.com/x?a=1&b=2)',
    );
  });

  it('unescapes entities inside a link label', () => {
    expect(mrkdwnToMarkdown('<https://getmunin.com|Ask &amp; answer>')).toBe(
      '[Ask & answer](https://getmunin.com)',
    );
  });

  it('strips the scheme Slack adds to an address the operator just typed', () => {
    expect(mrkdwnToMarkdown('<mailto:kjell@apps.no|kjell@apps.no>')).toBe('kjell@apps.no');
    expect(mrkdwnToMarkdown('<tel:+4712345678|+4712345678>')).toBe('+4712345678');
  });

  it('resolves a user mention from its label, then the resolver, then the bare id', () => {
    expect(mrkdwnToMarkdown('<@U1|kjell> ping')).toBe('@kjell ping');
    expect(mrkdwnToMarkdown('<@U1> ping', { users: { U1: 'Kjell Rune' } })).toBe(
      '@Kjell Rune ping',
    );
    expect(mrkdwnToMarkdown('<@U1> ping')).toBe('@U1 ping');
  });

  it('renders channel mentions and broadcasts', () => {
    expect(mrkdwnToMarkdown('<#C1|support>')).toBe('#support');
    expect(mrkdwnToMarkdown('<#C1>', { channels: { C1: 'support' } })).toBe('#support');
    expect(mrkdwnToMarkdown('<!here> look')).toBe('@here look');
    expect(mrkdwnToMarkdown('<!subteam^S1|@marketing>')).toBe('@marketing');
  });

  it('falls back to the rendered label of a date token', () => {
    expect(mrkdwnToMarkdown('<!date^1392734382^{date_short}|Feb 18, 2014>')).toBe('Feb 18, 2014');
  });

  it('converts emphasis into its markdown spelling', () => {
    expect(mrkdwnToMarkdown('*bold* and _italic_ and ~struck~')).toBe(
      '**bold** and *italic* and ~~struck~~',
    );
  });

  it('rewrites bullets by nesting depth', () => {
    expect(mrkdwnToMarkdown('• one\n  ◦ two\n    ▪ three')).toBe('- one\n  - two\n    - three');
  });

  it('converts both quote forms', () => {
    expect(mrkdwnToMarkdown('&gt;quoted')).toBe('> quoted');
    expect(mrkdwnToMarkdown('&gt;&gt;&gt;first\nsecond')).toBe('> first\n> second');
  });

  it('leaves plain prose and stray punctuation alone', () => {
    expect(mrkdwnToMarkdown('2 * 3 = 6')).toBe('2 * 3 = 6');
    expect(mrkdwnToMarkdown('Hei! Hvordan går det?')).toBe('Hei! Hvordan går det?');
    expect(mrkdwnToMarkdown('snake_case_name stays')).toBe('snake_case_name stays');
    expect(mrkdwnToMarkdown('kl. 10:30:00 i dag')).toBe('kl. 10:30:00 i dag');
  });

  it('keeps a fenced code block intact', () => {
    expect(mrkdwnToMarkdown('```\nconst a = *b*;\n```')).toBe('```\nconst a = *b*;\n```');
  });
});
