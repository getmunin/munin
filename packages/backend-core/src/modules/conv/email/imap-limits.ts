const MB = 1024 * 1024;

export const IMAP_MAX_MESSAGE_BYTES = 40 * MB;
export const IMAP_MAX_BATCH_BYTES = 64 * MB;

export const IMAP_PARSER_LIMITS = {
  maxLineLength: 1 * MB,
  maxLiteralSize: IMAP_MAX_MESSAGE_BYTES,
  maxResponseSize: IMAP_MAX_MESSAGE_BYTES + 8 * MB,
} as const;

export interface ImapSizedUid {
  uid: number;
  size: number | null;
}

export interface ImapDownloadPlan {
  fetch: ImapSizedUid[];
  oversized: ImapSizedUid[];
}

export function planImapDownloads(
  candidates: readonly ImapSizedUid[],
  opts: { sinceUid: number; limit: number; maxMessageBytes: number; maxBatchBytes: number },
): ImapDownloadPlan {
  const seen = new Set<number>();
  const ordered = candidates
    .filter((c) => c.uid > opts.sinceUid && !seen.has(c.uid) && seen.add(c.uid))
    .sort((a, b) => a.uid - b.uid);
  const plan: ImapDownloadPlan = { fetch: [], oversized: [] };
  let batchBytes = 0;
  let decided = 0;
  for (const candidate of ordered) {
    if (decided >= opts.limit) break;
    const size = candidate.size ?? opts.maxMessageBytes;
    if (size > opts.maxMessageBytes) {
      plan.oversized.push(candidate);
      decided += 1;
      continue;
    }
    if (plan.fetch.length > 0 && batchBytes + size > opts.maxBatchBytes) break;
    plan.fetch.push(candidate);
    batchBytes += size;
    decided += 1;
  }
  return plan;
}
