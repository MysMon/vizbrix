import { expect, test } from '@playwright/test';
import { isMobile, item, open } from './helpers';

test.describe('ECharts add-on', () => {
  test('draws real ECharts charts as SVG, in the dashboard theme', async ({ page }) => {
    await open(page);
    const flow = item(page, 'flow').locator('.vbx-echart');
    await flow.scrollIntoViewIfNeeded();
    await expect(flow.locator('svg path').first()).toBeVisible();
    await expect(flow.locator('canvas')).toHaveCount(0);
    await expect(flow.locator('svg')).toContainText('Enterprise');
    // Axis and label text follows the theme's secondary ink.
    const ink = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--vbx-text-2)';
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    await expect(flow.locator('svg text').first()).toHaveCSS('fill', ink);
  });

  test('follows a theme switch and resizes with its brick', async ({ page }) => {
    test.skip(isMobile(page), 'the playground theme toggle is tested on desktop');
    await open(page);
    const mix = item(page, 'mix');
    await mix.scrollIntoViewIfNeeded();
    const label = item(page, 'flow').locator('.vbx-echart svg text').first();
    const before = await label.evaluate((el) => getComputedStyle(el).fill);
    await page.getByRole('button', { name: 'ダーク' }).click();
    await expect.poll(() => label.evaluate((el) => getComputedStyle(el).fill)).not.toBe(before);

    const wide = await mix.locator('.vbx-echart svg').first().boundingBox();
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect.poll(async () => (await mix.locator('.vbx-echart svg').first().boundingBox())!.width).toBeLessThan(wide!.width - 20);
  });

  test('reports clicks through the dashboard', async ({ page }) => {
    await open(page);
    const mix = item(page, 'mix');
    await mix.scrollIntoViewIfNeeded();
    const box = await mix.locator('.vbx-echart').boundingBox();
    await mix.locator('.vbx-echart').click({ position: { x: box!.width * 0.2, y: box!.height * 0.3 } });
    await expect(page.locator('.picked')).toContainText('"name"');
    await expect(page.locator('.picked')).toContainText('"value"');
  });
});
