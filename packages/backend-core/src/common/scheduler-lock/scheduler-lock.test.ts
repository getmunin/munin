import { describe, expect, it } from 'vitest';
import { schedulerLockSlots, withSchedulerLock, type SchedulerLockDb } from './scheduler-lock.ts';

function lockDb(): SchedulerLockDb & { opened: () => number } {
  let opened = 0;
  return {
    opened: () => opened,
    transaction(fn) {
      opened += 1;
      return fn({ execute: () => Promise.resolve([{ ok: true }]) });
    },
  };
}

function gate(): { wait: Promise<void>; open: () => void } {
  let open = () => {};
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

describe('withSchedulerLock', () => {
  it('leaves two thirds of the pool for the work the ticks do', () => {
    expect(schedulerLockSlots(10)).toBe(3);
    expect(schedulerLockSlots(30)).toBe(10);
    expect(schedulerLockSlots(2)).toBe(1);
  });

  it('skips a tick instead of opening another lock transaction once every slot is held, so simultaneous ticks cannot drain the pool', async () => {
    const db = lockDb();
    const release = gate();
    const held = [
      withSchedulerLock(db, 'a', () => release.wait.then(() => 'a')),
      withSchedulerLock(db, 'b', () => release.wait.then(() => 'b')),
    ];

    await expect(withSchedulerLock(db, 'c', () => Promise.resolve('c'), 2)).resolves.toBeNull();
    expect(db.opened()).toBe(2);

    release.open();
    await expect(Promise.all(held)).resolves.toEqual(['a', 'b']);
    await expect(withSchedulerLock(db, 'c', () => Promise.resolve('c'), 2)).resolves.toBe('c');
  });

  it('frees its slot when the tick throws', async () => {
    const db = lockDb();
    await expect(
      withSchedulerLock(db, 'boom', () => Promise.reject(new Error('boom')), 1),
    ).rejects.toThrow('boom');
    await expect(withSchedulerLock(db, 'next', () => Promise.resolve('ok'), 1)).resolves.toBe('ok');
  });

  it('returns null without running the tick when another replica holds the advisory lock', async () => {
    const db: SchedulerLockDb = {
      transaction: (fn) => fn({ execute: () => Promise.resolve([{ ok: false }]) }),
    };
    let ran = false;
    const result = await withSchedulerLock(db, 'x', () => {
      ran = true;
      return Promise.resolve('ran');
    });
    expect(result).toBeNull();
    expect(ran).toBe(false);
  });
});
