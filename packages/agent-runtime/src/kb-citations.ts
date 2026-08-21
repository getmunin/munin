import type { ToolCallTrace } from './types.ts';
import { isRecord, resultJson, successfulCalls } from './tool-result.ts';

const KB_SEARCH_TOOL = 'kb_search';
const MAX_RETRIEVED_DOCUMENT_IDS = 8;
const MAX_DOCUMENT_ID_LENGTH = 64;

export function deriveRetrievedDocumentIds(toolCalls: ToolCallTrace[]): string[] | undefined {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const call of successfulCalls(toolCalls, KB_SEARCH_TOOL)) {
    const hits = resultJson(call.result);
    if (!Array.isArray(hits)) continue;
    for (const hit of hits) {
      if (ids.length >= MAX_RETRIEVED_DOCUMENT_IDS) break;
      if (!isRecord(hit)) continue;
      const documentId = hit.documentId;
      if (typeof documentId !== 'string') continue;
      if (documentId.length === 0 || documentId.length > MAX_DOCUMENT_ID_LENGTH) continue;
      if (seen.has(documentId)) continue;
      seen.add(documentId);
      ids.push(documentId);
    }
    if (ids.length >= MAX_RETRIEVED_DOCUMENT_IDS) break;
  }
  return ids.length > 0 ? ids : undefined;
}
