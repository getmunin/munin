import { test, expect } from '@playwright/test';

test.describe('OSS locale switching', () => {
  test('Norwegian Bokmål via accept-language renders nb copy', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'nb-NO' });
    const page = await ctx.newPage();
    try {
      await page.goto('/');
      // Norwegian translations live in messages/nb.json — assert the
      // tagline differs from the English version.
      const englishTagline = 'Agent-native business apps. The AI agent is the UI.';
      const tagline = await page.locator('main').first().innerText();
      expect(tagline).not.toContain(englishTagline);
    } finally {
      await ctx.close();
    }
  });

  test('munin_locale cookie pins the locale across requests', async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addCookies([
      { name: 'munin_locale', value: 'nb', url: 'http://127.0.0.1:3000' },
    ]);
    const page = await ctx.newPage();
    try {
      await page.goto('/');
      const taglineEn = 'Agent-native business apps. The AI agent is the UI.';
      const main = page.locator('main').first();
      await expect(main).toBeVisible();
      const text = await main.innerText();
      expect(text).not.toContain(taglineEn);
    } finally {
      await ctx.close();
    }
  });
});
