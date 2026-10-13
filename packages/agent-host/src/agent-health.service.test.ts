import { describe, expect, it, vi } from 'vitest';
import { AgentHealthService } from './agent-health.service.ts';
import type { AgentConfigRepository } from './config.repository.ts';
import type { AlertRecorder } from './alert-recorder.ts';

function buildAlerts(opened: boolean): AlertRecorder {
  return {
    openAlert: vi.fn(() => Promise.resolve({ alertId: 'alr_1', opened, occurrenceCount: 1 })),
    resolveAlert: vi.fn(() => Promise.resolve({ alertId: null, resolved: false })),
  };
}

const unused = (): never => {
  throw new Error('not used by recordBlocked');
};

const configRepo: AgentConfigRepository = {
  resolveCurrentId: unused,
  resolveOrgId: unused,
  read: unused,
  update: unused,
  listProvisionedIds: unused,
  readDecryptedProviderKey: unused,
};

describe('AgentHealthService.recordBlocked', () => {
  it('opens a quota alert carrying the gate notice and reason', async () => {
    const alerts = buildAlerts(true);
    const service = new AgentHealthService(configRepo, alerts);

    await service.recordBlocked(
      'cfg_1',
      { title: 'AI quota used up for this month', detail: 'Resets on 1 Nov.' },
      'quota_exceeded',
    );

    expect(alerts.openAlert).toHaveBeenCalledExactlyOnceWith({
      source: 'quota',
      subjectId: 'cfg_1',
      severity: 'error',
      title: 'AI quota used up for this month',
      detail: 'Resets on 1 Nov.',
      metadata: { reason: 'quota_exceeded' },
    });
  });

  it('opens the alert without detail or metadata when the gate gives none', async () => {
    const alerts = buildAlerts(false);
    const service = new AgentHealthService(configRepo, alerts);

    await service.recordBlocked('cfg_1', { title: 'Paused' });

    expect(alerts.openAlert).toHaveBeenCalledExactlyOnceWith({
      source: 'quota',
      subjectId: 'cfg_1',
      severity: 'error',
      title: 'Paused',
      detail: null,
      metadata: {},
    });
  });
});
