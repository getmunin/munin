import type { JourneyNode } from '@getmunin/types';
import {
  contentPlaceholderProblem,
  listContentPlaceholders,
  type ContentPlaceholder,
} from '../outreach/merge-fields.ts';
import type { JourneyIssue } from './journey-validator.ts';

type MessageNode = Extract<JourneyNode, { type: 'message' }>;

const URL_SPANS: readonly RegExp[] = [
  /\]\(\s*<?([^)]*)\)/g,
  /\s(?:href|src)\s*=\s*(["'])[\s\S]*?\1/gi,
  /<(?:https?|mailto):[^>]*>/gi,
  /\b(?:https?:\/\/|www\.)[^\s<>"'()]*/gi,
];

export function checkMessageMergeFields(
  node: MessageNode,
  errors: JourneyIssue[],
  warnings: JourneyIssue[],
): void {
  if (node.channel === 'voice') return;
  const unknownIsError = node.channel === 'email';
  const fields: [string, string | undefined][] = [
    ['content.subject', node.content.subject],
    ['content.preheader', node.content.preheader],
    ['content.body', node.content.body],
  ];
  for (const [path, text] of fields) {
    if (!text) continue;
    const linkSpans = path === 'content.body' ? urlSpans(text) : [];
    for (const placeholder of listContentPlaceholders(text)) {
      const problem = contentPlaceholderProblem(placeholder);
      if (problem) {
        (unknownIsError ? errors : warnings).push({ code: 'unknown_merge_field', nodeId: node.id, path, message: problem });
        continue;
      }
      if (placeholder.customFieldKey === null) continue;
      if (insideAny(placeholder, linkSpans)) {
        errors.push({
          code: 'merge_field_in_link',
          nodeId: node.id,
          path,
          message: `{{${placeholder.name}}} sits inside a link URL; custom fields are merged into text only, so move it out of the link`,
        });
        continue;
      }
      if (placeholder.fallback === undefined || !placeholder.fallback.trim()) {
        warnings.push({
          code: 'merge_field_no_fallback',
          nodeId: node.id,
          path,
          message: `{{${placeholder.name}}} has no fallback, so contacts without the field get an empty string; write {{${placeholder.name}|fallback}}`,
        });
      }
    }
  }
}

function urlSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const pattern of URL_SPANS) {
    for (const match of text.matchAll(pattern)) spans.push([match.index, match.index + match[0].length]);
  }
  return spans;
}

function insideAny(placeholder: ContentPlaceholder, spans: readonly [number, number][]): boolean {
  return spans.some(([start, end]) => placeholder.index >= start && placeholder.index < end);
}
