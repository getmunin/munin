export type CoverageNotice = 'pending' | 'noNer' | 'withheldPending' | 'withheldNoNer';

export interface PiiCoverageStatus {
  withholdUncheckedText: boolean;
  nerEnabled: boolean;
  coverage: { messages: number; annotated: number };
}

export function coverageNoticeFor(status: PiiCoverageStatus): CoverageNotice | null {
  const unchecked = status.coverage.annotated < status.coverage.messages;
  if (status.withholdUncheckedText) {
    if (!status.nerEnabled) return status.coverage.messages > 0 ? 'withheldNoNer' : null;
    return unchecked ? 'withheldPending' : null;
  }
  if (!status.nerEnabled) return 'noNer';
  return unchecked ? 'pending' : null;
}
