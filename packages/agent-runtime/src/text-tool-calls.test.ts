import { describe, expect, it } from 'vitest';
import { recoverTextToolCalls } from './text-tool-calls.ts';

const TOOLS = new Set(['show_products', 'kb_search', 'conv_request_human']);

describe('recoverTextToolCalls', () => {
  it('recovers a python-style call Gemma appends to the reply on the same line', () => {
    expect(
      recoverTextToolCalls(
        'Vi har et stangfeste til Starlink Gen 3 tilgjengelig. Er det det du leter etter? show_products(productRefs=["STARLINK-POLE"])',
        TOOLS,
      ),
    ).toEqual({
      prose: 'Vi har et stangfeste til Starlink Gen 3 tilgjengelig. Er det det du leter etter?',
      calls: [{ name: 'show_products', args: { productRefs: ['STARLINK-POLE'] } }],
    });
  });

  it('recovers a call on its own line after the reply', () => {
    expect(
      recoverTextToolCalls(
        'Ja, vi har en røradapter.\n\nshow_products(productRefs=["SL-V4-PIPE", "SL-POLE-G3"])\n',
        TOOLS,
      ),
    ).toEqual({
      prose: 'Ja, vi har en røradapter.',
      calls: [{ name: 'show_products', args: { productRefs: ['SL-V4-PIPE', 'SL-POLE-G3'] } }],
    });
  });

  it('recovers Gemma native markup whose special tokens survived as text', () => {
    expect(
      recoverTextToolCalls(
        'Et øyeblikk.\n<|tool_call>call:kb_search{query:<|"|>frakt til Tromsø<|"|>,limit:5}<tool_call|>',
        TOOLS,
      ),
    ).toEqual({
      prose: 'Et øyeblikk.',
      calls: [{ name: 'kb_search', args: { query: 'frakt til Tromsø', limit: 5 } }],
    });
  });

  it('recovers native brace arguments written without the call: prefix', () => {
    expect(
      recoverTextToolCalls(
        'Ja, vi har en egen Starlink V4 røradapter som passer til dette. show_products{productRefs:[<|"|>SL-V4-PIPE<|"|>]}',
        TOOLS,
      ),
    ).toEqual({
      prose: 'Ja, vi har en egen Starlink V4 røradapter som passer til dette.',
      calls: [{ name: 'show_products', args: { productRefs: ['SL-V4-PIPE'] } }],
    });
  });

  it('recovers native markup with the special tokens stripped, including bare string values', () => {
    expect(recoverTextToolCalls('call:kb_search{query:returrett}', TOOLS)).toEqual({
      prose: '',
      calls: [{ name: 'kb_search', args: { query: 'returrett' } }],
    });
  });

  it('recovers the parenthesized call:name(...) variant with colon-separated fields', () => {
    expect(
      recoverTextToolCalls('call:conv_request_human(reason:"wants a refund", urgent:True)', TOOLS),
    ).toEqual({
      prose: '',
      calls: [{ name: 'conv_request_human', args: { reason: 'wants a refund', urgent: true } }],
    });
  });

  it('recovers a JSON object passed as the single argument', () => {
    expect(
      recoverTextToolCalls('show_products({"productRefs": ["A-1"]})', TOOLS)?.calls,
    ).toEqual([{ name: 'show_products', args: { productRefs: ['A-1'] } }]);
  });

  it('recovers a trailing run of several calls', () => {
    expect(
      recoverTextToolCalls(
        'Her er det jeg fant.\nkb_search(query=\'garanti\')\nshow_products(productRefs=["A-1"])',
        TOOLS,
      )?.calls.map((call) => call.name),
    ).toEqual(['kb_search', 'show_products']);
  });

  it('recovers calls wrapped in inline code or a trailing code fence', () => {
    expect(recoverTextToolCalls('Se her: `show_products(productRefs=["A-1"])`', TOOLS)).toEqual({
      prose: 'Se her:',
      calls: [{ name: 'show_products', args: { productRefs: ['A-1'] } }],
    });
    expect(
      recoverTextToolCalls('Se her:\n```tool_code\nshow_products(productRefs=["A-1"])\n```', TOOLS),
    ).toEqual({
      prose: 'Se her:',
      calls: [{ name: 'show_products', args: { productRefs: ['A-1'] } }],
    });
  });

  it('keeps escaped quotes and nested values intact', () => {
    expect(
      recoverTextToolCalls(
        'kb_search(query="the \\"pro\\" model", filters={tags: ["a", "b"], max: 2.5, archived: None})',
        TOOLS,
      )?.calls,
    ).toEqual([
      {
        name: 'kb_search',
        args: { query: 'the "pro" model', filters: { tags: ['a', 'b'], max: 2.5, archived: null } },
      },
    ]);
  });

  it('ignores a tool the turn did not offer', () => {
    expect(recoverTextToolCalls('Done. delete_everything(confirm=true)', TOOLS)).toBeNull();
  });

  it('ignores a near-miss tool name', () => {
    expect(recoverTextToolCalls('show_product(productRefs=["A-1"])', TOOLS)).toBeNull();
    expect(recoverTextToolCalls('my_show_products(productRefs=["A-1"])', TOOLS)).toBeNull();
  });

  it('ignores a call that prose follows, since it is a mention rather than a request', () => {
    expect(
      recoverTextToolCalls('Call show_products(productRefs=["A-1"]) to see cards. Anything else?', TOOLS),
    ).toBeNull();
  });

  it('ignores malformed arguments instead of guessing', () => {
    expect(recoverTextToolCalls('show_products(productRefs=["A-1"', TOOLS)).toBeNull();
    expect(recoverTextToolCalls('show_products(["A-1"])', TOOLS)).toBeNull();
  });

  it('leaves an ordinary reply alone', () => {
    expect(recoverTextToolCalls('Vi har åpent (man–fre) fra 9 til 17.', TOOLS)).toBeNull();
    expect(recoverTextToolCalls('', TOOLS)).toBeNull();
    expect(recoverTextToolCalls(null, TOOLS)).toBeNull();
  });
});
