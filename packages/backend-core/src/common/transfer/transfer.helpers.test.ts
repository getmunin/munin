import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { assertPriorTargetsInOrg } from './transfer.helpers.ts';

describe('assertPriorTargetsInOrg', () => {
  it('looks up every caller-supplied target of a kind in one batched call', async () => {
    const findInOrg = vi.fn((ids: string[]) => Promise.resolve(ids.map((id) => ({ id }))));
    const prior = { a: 'own_1', b: 'own_2', c: 'own_1' };
    await assertPriorTargetsInOrg('x_import_invalid', { ...prior }, prior, [
      { kind: 'contact', sourceIds: ['a', 'b', 'c', 'a', null, undefined], findInOrg },
    ]);
    expect(findInOrg).toHaveBeenCalledTimes(1);
    expect(findInOrg.mock.calls[0]![0].sort()).toEqual(['own_1', 'own_2']);
  });

  it('refuses a target that is not in the org and names the idMap key', async () => {
    const prior = { mine: 'own_1', theirs: 'foreign_1' };
    await expect(
      assertPriorTargetsInOrg('x_import_invalid', { ...prior }, prior, [
        { kind: 'contact', sourceIds: ['mine', 'theirs'], findInOrg: () => Promise.resolve([{ id: 'own_1' }]) },
      ]),
    ).rejects.toThrow(new BadRequestException(
      'x_import_invalid: idMap entry "theirs" points at contact foreign_1, which does not exist in this organization',
    ));
  });

  it('skips ids the import itself remapped, and ids absent from the caller idMap', async () => {
    const findInOrg = vi.fn(() => Promise.resolve([]));
    await assertPriorTargetsInOrg(
      'x_import_invalid',
      { remapped: 'fresh_1', created: 'fresh_2' },
      { remapped: 'foreign_1' },
      [{ kind: 'contact', sourceIds: ['remapped', 'created', 'unknown'], findInOrg }],
    );
    expect(findInOrg).not.toHaveBeenCalled();
  });
});
