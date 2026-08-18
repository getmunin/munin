import { describe, expect, it } from 'vitest';
import { stripTrailingSlashes } from './url.ts';

describe('stripTrailingSlashes', () => {
  it('matches the trailing-slash semantics of the previous regex', () => {
    const cases = [
      'https://api.example.com/',
      'https://api.example.com///',
      'https://api.example.com',
      'https://api.example.com/v1',
      'https://api.example.com/v1/',
      '',
      '/',
      '////',
    ];
    for (const value of cases) {
      expect(stripTrailingSlashes(value)).toBe(value.replace(/\/+$/, ''));
    }
  });

  it('leaves inner and leading slashes alone', () => {
    expect(stripTrailingSlashes('//a//b//')).toBe('//a//b');
  });

  it('runs in linear time on pathological all-slash input', () => {
    const input = `${'/'.repeat(200_000)}a`;
    expect(stripTrailingSlashes(input)).toBe(input);
  });
});
