import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ControlPlaneGuard } from '../../common/auth/control-plane.guard.ts';
import { FeedbackController } from './feedback.controller.ts';

const GUARDS_METADATA = '__guards__';

function guardsOn(method: 'approve' | 'reject' | 'create'): unknown[] {
  const fn = FeedbackController.prototype[method] as (...args: unknown[]) => unknown;
  return (Reflect.getMetadata(GUARDS_METADATA, fn) as unknown[] | undefined) ?? [];
}

describe('FeedbackController guard wiring', () => {
  it('approve has ControlPlaneGuard at the method level', () => {
    expect(guardsOn('approve')).toContain(ControlPlaneGuard);
  });

  it('reject has ControlPlaneGuard at the method level', () => {
    expect(guardsOn('reject')).toContain(ControlPlaneGuard);
  });

  it('create does NOT carry ControlPlaneGuard (broadly authenticated)', () => {
    expect(guardsOn('create')).not.toContain(ControlPlaneGuard);
  });
});
