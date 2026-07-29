import { describe, it, expect } from 'vitest';
import { looksLikeBot } from './bot-ua.ts';

const CRAWLERS = [
  'Googlebot/2.1',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot',
  'Mozilla/5.0 (compatible) ClaudeBot/1.0; +claudebot@anthropic.com',
  'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  'Mozilla/5.0 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)',
  'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)',
  'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
  'Mozilla/5.0 (compatible; SemrushBot/7~bl)',
  'Mozilla/5.0 (compatible; YandexBot/3.0)',
  'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  'Mozilla/5.0 (compatible; bot)',
  'Twitterbot/1.0',
  'UptimeMonitor/1.0',
];

const HUMANS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Linux; Android 13; CUBOT NOTE 21) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 10; CUBOT_X30 Build/QP1A.190711.020) Chrome/103.0.0.0',
  'Mozilla/5.0 Botanical/1.0',
];

describe('looksLikeBot', () => {
  it.each(CRAWLERS)('flags %s', (userAgent) => {
    expect(looksLikeBot(userAgent)).toBe(true);
  });

  it.each(HUMANS)('leaves %s alone', (userAgent) => {
    expect(looksLikeBot(userAgent)).toBe(false);
  });

  it('treats a missing user agent as human', () => {
    expect(looksLikeBot(undefined)).toBe(false);
    expect(looksLikeBot(null)).toBe(false);
    expect(looksLikeBot('')).toBe(false);
  });

  it('still flags a crawler that names a device brand', () => {
    expect(looksLikeBot('Mozilla/5.0 (Linux; Android 13; CUBOT NOTE 21) Googlebot/2.1')).toBe(
      true,
    );
  });

  it('is stateless across calls despite the global device pattern', () => {
    for (let i = 0; i < 3; i++) {
      expect(looksLikeBot('Googlebot/2.1')).toBe(true);
      expect(looksLikeBot(HUMANS[3])).toBe(false);
    }
  });
});
