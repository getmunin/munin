import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readApiBaseUrl } from './api-url.ts';

const saved = {
  api: process.env.MUNIN_API_URL,
  mcp: process.env.NEXT_PUBLIC_MCP_URL,
};

describe('readApiBaseUrl', () => {
  beforeEach(() => {
    delete process.env.MUNIN_API_URL;
    delete process.env.NEXT_PUBLIC_MCP_URL;
  });

  afterEach(() => {
    if (saved.api === undefined) delete process.env.MUNIN_API_URL;
    else process.env.MUNIN_API_URL = saved.api;
    if (saved.mcp === undefined) delete process.env.NEXT_PUBLIC_MCP_URL;
    else process.env.NEXT_PUBLIC_MCP_URL = saved.mcp;
  });

  it('prefers MUNIN_API_URL over the MCP origin on split-host deployments', () => {
    process.env.MUNIN_API_URL = 'https://api.getmunin.com';
    process.env.NEXT_PUBLIC_MCP_URL = 'https://mcp.getmunin.com';

    expect(readApiBaseUrl()).toBe('https://api.getmunin.com');
  });

  it('strips trailing slashes', () => {
    process.env.MUNIN_API_URL = 'https://api.getmunin.com//';

    expect(readApiBaseUrl()).toBe('https://api.getmunin.com');
  });

  it('falls back to the MCP origin when MUNIN_API_URL is unset', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'https://tunnel.example.test/mcp';

    expect(readApiBaseUrl()).toBe('https://tunnel.example.test');
  });

  it('falls back to localhost when neither var is set', () => {
    expect(readApiBaseUrl()).toBe('http://localhost:3001');
  });

  it('ignores an unparseable NEXT_PUBLIC_MCP_URL', () => {
    process.env.NEXT_PUBLIC_MCP_URL = 'not-a-url';

    expect(readApiBaseUrl()).toBe('http://localhost:3001');
  });
});
