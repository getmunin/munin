export type AlertRecorderSeverity = 'warning' | 'error';

export interface AlertRecorderOpenInput {
  source: 'llm_provider';
  subjectId?: string | null;
  severity: AlertRecorderSeverity;
  title: string;
  detail?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AlertRecorderResolveInput {
  source: 'llm_provider';
  subjectId?: string | null;
}

export interface AlertRecorder {
  openAlert(input: AlertRecorderOpenInput): Promise<{ alertId: string; opened: boolean; occurrenceCount: number }>;
  resolveAlert(input: AlertRecorderResolveInput): Promise<{ alertId: string | null; resolved: boolean }>;
}
