import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { McpToolRegistry } from './registry.js';

const meta = (name: string, audiences: ('admin' | 'self_service')[]) => ({
  name,
  description: name,
  audiences,
  scopes: [] as string[],
  input: z.object({}),
});

describe('McpToolRegistry', () => {
  it('registers and looks up by name', () => {
    const r = new McpToolRegistry();
    r.register(meta('a', ['admin']), () => 'ok');
    expect(r.get('a')?.meta.name).toBe('a');
  });

  it('rejects duplicate names', () => {
    const r = new McpToolRegistry();
    r.register(meta('a', ['admin']), () => 'ok');
    expect(() => r.register(meta('a', ['admin']), () => 'ok')).toThrow(/Duplicate/);
  });

  it('filters list by audience', () => {
    const r = new McpToolRegistry();
    r.register(meta('admin_only', ['admin']), () => 'a');
    r.register(meta('shared', ['admin', 'self_service']), () => 'b');
    r.register(meta('self_only', ['self_service']), () => 'c');

    expect(r.list('admin').map((t) => t.meta.name)).toEqual(['admin_only', 'shared']);
    expect(r.list('self_service').map((t) => t.meta.name)).toEqual(['shared', 'self_only']);
    expect(r.list().map((t) => t.meta.name)).toHaveLength(3);
  });

  it('generates JSON schema from zod input', () => {
    const r = new McpToolRegistry();
    r.register(
      {
        name: 'echo',
        description: 'echo',
        audiences: ['admin'],
        scopes: [],
        input: z.object({ msg: z.string() }),
      },
      () => 'ok',
    );
    const tool = r.get('echo')!;
    expect(tool.inputJsonSchema).toMatchObject({
      type: 'object',
      properties: { msg: { type: 'string' } },
      required: ['msg'],
    });
  });

  it('preserves directory annotations (title, readOnlyHint, destructiveHint)', () => {
    const r = new McpToolRegistry();
    r.register(
      {
        name: 'thing_delete',
        title: 'Delete a thing',
        description: 'Delete a thing.',
        audiences: ['admin'],
        scopes: [],
        input: z.object({ id: z.string() }),
        readOnlyHint: false,
        destructiveHint: true,
      },
      () => 'ok',
    );
    const tool = r.get('thing_delete')!;
    expect(tool.meta.title).toBe('Delete a thing');
    expect(tool.meta.readOnlyHint).toBe(false);
    expect(tool.meta.destructiveHint).toBe(true);
  });
});
