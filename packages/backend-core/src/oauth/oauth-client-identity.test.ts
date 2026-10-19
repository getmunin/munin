import { describe, expect, it } from 'vitest';
import { impersonatedClientName, knownClientNameForHost } from './oauth-client-identity.ts';

describe('impersonatedClientName', () => {
  it('flags a client that calls itself Claude but redirects to a host Claude does not own', () => {
    expect(impersonatedClientName('Claude', ['https://attacker.example/cb'])).toBe('Claude');
  });

  it('matches the claimed name regardless of case, spacing and punctuation', () => {
    expect(impersonatedClientName('  cLaUdE  ', ['https://attacker.example/cb'])).toBe('Claude');
    expect(impersonatedClientName('Chat GPT', ['https://attacker.example/cb'])).toBe('ChatGPT');
    expect(impersonatedClientName('Chat-GPT connector', ['https://attacker.example/cb'])).toBe(
      'ChatGPT',
    );
  });

  it('folds full-width lookalike characters before matching', () => {
    expect(impersonatedClientName('Ｃｌａｕｄｅ', ['https://attacker.example/cb'])).toBe('Claude');
  });

  it('treats the vendor name behind a known host as a claim on that product', () => {
    expect(impersonatedClientName('Anthropic MCP', ['https://attacker.example/cb'])).toBe('Claude');
    expect(impersonatedClientName('OpenAI Connector', ['https://attacker.example/cb'])).toBe(
      'ChatGPT',
    );
  });

  it('trusts a claimed name when every remote redirect stays on that product host', () => {
    expect(impersonatedClientName('Claude', ['https://claude.ai/api/mcp/auth_callback'])).toBeNull();
    expect(impersonatedClientName('ChatGPT', ['https://openai.com/callback'])).toBeNull();
  });

  it('does not accept a domain that merely starts with the product host', () => {
    expect(impersonatedClientName('Claude', ['https://claude.ai.attacker.example/cb'])).toBe(
      'Claude',
    );
  });

  it('flags a registration that pairs a genuine redirect with a foreign one', () => {
    expect(
      impersonatedClientName('Claude', [
        'https://claude.ai/api/mcp/auth_callback',
        'https://attacker.example/cb',
      ]),
    ).toBe('Claude');
  });

  it('does not flag a claimed name whose redirects stay on the local machine', () => {
    expect(impersonatedClientName('Claude Code', ['http://localhost:33418/callback'])).toBeNull();
    expect(impersonatedClientName('Claude Code', ['http://127.0.0.1:33418/callback'])).toBeNull();
    expect(impersonatedClientName('Claude Code', ['http://[::1]:33418/callback'])).toBeNull();
    expect(
      impersonatedClientName('Cursor', ['cursor://anysphere.cursor-retrieval/oauth/callback']),
    ).toBeNull();
  });

  it('does not mistake a DNS name that starts with 127 for a loopback address', () => {
    expect(impersonatedClientName('Claude', ['http://127.attacker.example/cb'])).toBe('Claude');
  });

  it('treats an unparseable redirect as foreign', () => {
    expect(impersonatedClientName('Claude', ['not a url'])).toBe('Claude');
  });

  it('flags a client that calls itself Grok but redirects off the Grok hosts', () => {
    expect(impersonatedClientName('Grok', ['https://attacker.example/cb'])).toBe('Grok');
    expect(
      impersonatedClientName('Grok', ['https://grok.com/connectors-oauth-exchange-code/']),
    ).toBeNull();
  });

  it('does not read a short vendor host as a claim on that product', () => {
    expect(impersonatedClientName('Xero Exporter', ['https://acme.example/cb'])).toBeNull();
    expect(impersonatedClientName('Tax AI helper', ['https://acme.example/cb'])).toBeNull();
  });

  it('flags Copilot claims that redirect off the Microsoft and GitHub hosts', () => {
    expect(impersonatedClientName('Copilot', ['https://attacker.example/cb'])).toBe('Copilot');
    expect(impersonatedClientName('GitHub Copilot', ['https://attacker.example/cb'])).toBe(
      'Copilot',
    );
    expect(impersonatedClientName('Microsoft Copilot', ['https://attacker.example/cb'])).toBe(
      'Copilot',
    );
    expect(impersonatedClientName('Copilot Studio', ['https://attacker.example/cb'])).toBe(
      'Copilot',
    );
  });

  it('trusts Copilot clients that redirect to the VS Code relay or the Copilot Studio consent host', () => {
    expect(
      impersonatedClientName('GitHub Copilot', [
        'http://127.0.0.1:33418',
        'https://vscode.dev/redirect',
      ]),
    ).toBeNull();
    expect(
      impersonatedClientName('Copilot Studio', [
        'https://global.consent.azure-apim.net/redirect/acme-5fconnector',
      ]),
    ).toBeNull();
  });

  it('leaves third-party tools that merely use copilot in their name alone', () => {
    expect(impersonatedClientName('Acme Sales Copilot', ['https://acme.example/cb'])).toBeNull();
  });

  it('leaves clients that claim no known product alone', () => {
    expect(impersonatedClientName('Acme Agent', ['https://attacker.example/cb'])).toBeNull();
    expect(impersonatedClientName(null, ['https://attacker.example/cb'])).toBeNull();
    expect(impersonatedClientName('   ', ['https://attacker.example/cb'])).toBeNull();
  });
});

describe('knownClientNameForHost', () => {
  it('names hosts that belong to a known product', () => {
    expect(knownClientNameForHost('claude.ai')).toBe('Claude');
    expect(knownClientNameForHost('openai.com')).toBe('ChatGPT');
    expect(knownClientNameForHost('grok.com')).toBe('Grok');
    expect(knownClientNameForHost('vscode.dev')).toBe('Copilot');
  });

  it('does not name a client after a host other vendors also redirect through', () => {
    expect(knownClientNameForHost('global.consent.azure-apim.net')).toBeNull();
  });

  it('returns null for unknown or missing hosts', () => {
    expect(knownClientNameForHost('attacker.example')).toBeNull();
    expect(knownClientNameForHost(null)).toBeNull();
  });
});
