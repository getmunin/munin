import { z } from 'zod';

export const TEXT_REPLACEMENTS_MAX = 100;

export const TextReplacementSchema = z.object({
  oldText: z
    .string()
    .min(1)
    .max(20_000)
    .describe(
      'Exact text to find, including whitespace and punctuation. Must occur exactly once unless replaceAll is set.',
    ),
  newText: z.string().max(200_000).describe('Text that replaces every matched occurrence. May be empty to delete.'),
  replaceAll: z
    .boolean()
    .optional()
    .describe('Replace every occurrence instead of failing when oldText occurs more than once.'),
});

export type TextReplacement = z.infer<typeof TextReplacementSchema>;

export type TextReplacementFailure = {
  index: number;
  reason: 'no_match' | 'ambiguous';
  matches: number;
};

export type TextReplacementResult =
  | { ok: true; texts: string[]; applied: number }
  | { ok: false; failure: TextReplacementFailure };

export function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

export function applyTextReplacements(
  texts: readonly string[],
  replacements: readonly TextReplacement[],
): TextReplacementResult {
  const out = [...texts];
  let applied = 0;
  for (const [index, edit] of replacements.entries()) {
    const matches = out.reduce((sum, text) => sum + countOccurrences(text, edit.oldText), 0);
    if (matches === 0) return { ok: false, failure: { index, reason: 'no_match', matches } };
    if (matches > 1 && !edit.replaceAll) {
      return { ok: false, failure: { index, reason: 'ambiguous', matches } };
    }
    for (let i = 0; i < out.length; i += 1) {
      out[i] = out[i]!.split(edit.oldText).join(edit.newText);
    }
    applied += matches;
  }
  return { ok: true, texts: out, applied };
}

export function describeReplacementFailure(failure: TextReplacementFailure, target: string): string {
  const which = `textReplacements[${failure.index}]`;
  if (failure.reason === 'no_match') {
    return `${which}: oldText was not found in ${target}. Re-read the current text and copy the passage exactly, including whitespace.`;
  }
  return `${which}: oldText occurs ${failure.matches} times in ${target}. Include more surrounding text to make it unique, or set replaceAll: true to change every occurrence.`;
}
