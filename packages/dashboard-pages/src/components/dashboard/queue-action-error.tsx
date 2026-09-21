'use client';

import type { QueueActionError } from './inbox-types';
import { FailureBlockRegion, failureSummary } from './failure-block';

export function QueueActionErrorBanner({
  error,
  onDismiss,
}: {
  error: QueueActionError;
  onDismiss: () => void;
}) {
  if (!error) return null;

  return (
    <FailureBlockRegion
      summary={failureSummary(error.code, error.message)}
      attempt={error.attempt}
      onDismiss={onDismiss}
    />
  );
}
