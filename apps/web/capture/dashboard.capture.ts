import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { DEMO } from './seed';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../..');
const assets = join(repoRoot, '.github/assets');

const HIDE_DEV_CHROME = 'nextjs-portal, [data-nextjs-dev-tools-button] { display: none !important; }';

const SHOTS = [
  { name: 'dashboard', path: '/en/dashboard/conversations', open: 'Ola Nordmann' },
  { name: 'dashboard-overview', path: '/en/dashboard' },
  {
    name: 'review-queue',
    path: '/en/dashboard/review',
    open: "Your stand mixer's first service check",
  },
];

async function signIn(page: Page): Promise<void> {
  await page.goto('/en/login');
  await page.getByLabel(/email/i).fill(DEMO.email);
  await page.getByLabel(/password/i).fill(DEMO.password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
}

test('console screenshots', async ({ page }) => {
  mkdirSync(assets, { recursive: true });
  await signIn(page);

  for (const shot of SHOTS) {
    await page.goto(shot.path);
    await expect(page.locator('main').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState('networkidle');

    if (shot.open) {
      await page.getByText(shot.open, { exact: true }).filter({ visible: true }).first().click();
      await page.waitForTimeout(900);
    }

    await page.addStyleTag({ content: HIDE_DEV_CHROME });
    await page.mouse.move(720, 20);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(assets, `${shot.name}.png`) });
  }
});
