import { test, expect } from '@playwright/test';

test.describe('OSS auth pages', () => {
  test('/login renders with email field and a submit button', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Welcome back to Munin.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  });

  test('/signup renders with email field and a submit button', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
  });

  test('login → signup link navigates correctly', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: /create an account/i }).click();
    await expect(page).toHaveURL(/\/signup/);
  });
});
