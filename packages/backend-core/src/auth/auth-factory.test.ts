import { describe, expect, it } from 'vitest';
import { computeValidAudiences } from './auth-factory.js';

describe('computeValidAudiences', () => {
  it('returns canonical URL plus trailing-slash variant when baseUrl has a path', () => {
    expect(computeValidAudiences('https://api.example.com/mcp')).toEqual([
      'https://api.example.com/mcp',
      'https://api.example.com/mcp/',
      'https://api.example.com',
      'https://api.example.com/',
    ]);
  });

  it('returns origin variants when baseUrl is bare host', () => {
    expect(computeValidAudiences('https://mcp.example.com')).toEqual([
      'https://mcp.example.com',
      'https://mcp.example.com/',
    ]);
  });

  it('strips trailing slashes from the input before computing variants', () => {
    expect(computeValidAudiences('https://api.example.com/mcp/')).toEqual([
      'https://api.example.com/mcp',
      'https://api.example.com/mcp/',
      'https://api.example.com',
      'https://api.example.com/',
    ]);
  });

  it('accepts http origins (loopback dev)', () => {
    expect(computeValidAudiences('http://localhost:3001/mcp')).toEqual([
      'http://localhost:3001/mcp',
      'http://localhost:3001/mcp/',
      'http://localhost:3001',
      'http://localhost:3001/',
    ]);
  });

  it('falls back to canonical-only when the input is not a parseable URL', () => {
    expect(computeValidAudiences('not-a-url')).toEqual(['not-a-url', 'not-a-url/']);
  });
});
