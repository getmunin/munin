import { describe, expect, it } from 'vitest';
import { classifyClient, type ClientSignals } from './audit-log.controller.ts';

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function signals(over: Partial<ClientSignals>): ClientSignals {
  return { userAgent: null, tool: null, method: null, actorType: 'user', ...over };
}

describe('classifyClient', () => {
  it('classifies a tool row as mcp', () => {
    expect(classifyClient(signals({ tool: 'kb_search', method: 'POST /mcp' }))).toBe('mcp');
  });

  it('classifies the transport row of an MCP call as mcp even though it carries no tool', () => {
    expect(classifyClient(signals({ method: 'POST /mcp' }))).toBe('mcp');
    expect(classifyClient(signals({ method: 'POST /mcp/media' }))).toBe('mcp');
  });

  it('does not treat a control-plane path that merely starts with mcp as transport', () => {
    expect(classifyClient(signals({ method: 'GET /v1/mcp-tools' }))).toBe('unknown');
    expect(classifyClient(signals({ method: 'GET /mcpx' }))).toBe('unknown');
  });

  it('classifies a browser request as dashboard rather than unknown', () => {
    expect(classifyClient(signals({ userAgent: CHROME, method: 'GET /v1/activity' }))).toBe(
      'dashboard',
    );
  });

  it('classifies widget callers by actor type, whatever the browser UA says', () => {
    expect(
      classifyClient(
        signals({ userAgent: CHROME, actorType: 'widget_agent', method: 'POST /v1/widget/identify' }),
      ),
    ).toBe('widget');
  });

  it('still recognizes the sdk and cli user agents', () => {
    expect(classifyClient(signals({ userAgent: '@getmunin/sdk 5.0.0' }))).toBe('sdk');
    expect(classifyClient(signals({ userAgent: 'curl/8.4.0' }))).toBe('cli');
  });

  it('falls back to unknown when there is no signal at all', () => {
    expect(classifyClient(signals({}))).toBe('unknown');
    expect(classifyClient(signals({ userAgent: 'node' }))).toBe('unknown');
  });
});
