import { test, expect } from '@playwright/test';

test.describe('OSS web smoke', () => {
  test('home page renders with sign-in/sign-up CTAs', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Sign in')).toBeVisible();
    await expect(page.getByText('Get started')).toBeVisible();
  });
});
