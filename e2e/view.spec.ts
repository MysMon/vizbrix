import { expect, test } from '@playwright/test';
import { box, isMobile, item, open } from './helpers';

test.describe('viewing', () => {
  test('lays bricks out from CSS alone, and reflows by container width', async ({ page }) => {
    await open(page);
    const mrr = await box(page, 'mrr');
    const customers = await box(page, 'customers');
    const revenue = await box(page, 'revenue');
    if (isMobile(page)) {
      // One column: every brick starts at the same x and stacks.
      expect(Math.abs(customers.x - mrr.x)).toBeLessThan(1);
      expect(customers.y).toBeGreaterThan(mrr.y + mrr.height);
      expect(Math.abs(revenue.width - mrr.width)).toBeLessThan(1);
    } else {
      // Base layout: four stats in a row, gutters a constant 16px.
      expect(Math.abs(customers.y - mrr.y)).toBeLessThan(1);
      expect(customers.x - (mrr.x + mrr.width)).toBeCloseTo(16, 0);
      expect(revenue.y - (mrr.y + mrr.height)).toBeCloseTo(16, 0);
    }
    // Nothing spills out of the page horizontally.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('switches to the two-column layout when its container narrows, without a viewport change', async ({ page }) => {
    test.skip(isMobile(page), 'desktop only');
    await open(page, '?width=820px');
    const mrr = await box(page, 'mrr');
    const customers = await box(page, 'customers');
    const churn = await box(page, 'churn');
    expect(Math.abs(customers.y - mrr.y)).toBeLessThan(1);
    expect(churn.y).toBeGreaterThan(mrr.y + mrr.height);
    expect(Math.abs(churn.x - mrr.x)).toBeLessThan(1);
  });

  test('is read-only by default: no grips, no tab stops on bricks', async ({ page }) => {
    await open(page);
    await expect(page.locator('.vbx-grip')).toHaveCount(0);
    await expect(item(page, 'mrr')).not.toHaveAttribute('tabindex', /.*/);
  });

  test('shows every series at the hovered position', async ({ page }) => {
    test.skip(isMobile(page), 'hover is a pointer interaction');
    await open(page);
    const r = await box(page, 'revenue');
    await page.mouse.move(r.x + r.width * 0.5, r.y + r.height * 0.6);
    const tip = item(page, 'revenue').locator('.vbx-tooltip');
    await expect(tip).toBeVisible();
    await expect(tip.locator('.vbx-tooltip-row')).toHaveCount(3);
    await expect(tip).toContainText('実績');
  });

  test('reads chart values from the keyboard', async ({ page }) => {
    await open(page);
    const plot = item(page, 'revenue').getByRole('group');
    await plot.focus();
    await page.keyboard.press('ArrowRight');
    await expect(item(page, 'revenue').locator('.vbx-tooltip')).toContainText('4月');
    await page.keyboard.press('ArrowRight');
    await expect(item(page, 'revenue').locator('.vbx-tooltip')).toContainText('5月');
    await page.keyboard.press('Escape');
    await expect(item(page, 'revenue').locator('.vbx-tooltip')).toHaveCount(0);
  });

  test('reports the row behind a clicked bar', async ({ page }) => {
    await open(page);
    const plot = item(page, 'channels').locator('.vbx-hover');
    await plot.scrollIntoViewIfNeeded();
    const b = await plot.boundingBox();
    await plot.click({ position: { x: b!.width * 0.5, y: b!.height * 0.6 } });
    await expect(page.locator('.picked')).toContainText('チャネル別受注');
    await expect(page.locator('.picked')).toContainText('"month"');
  });

  test('dims bricks while their data refetches, then updates', async ({ page }) => {
    await open(page);
    const value = item(page, 'customers').locator('.vbx-stat-value');
    await expect(value).toHaveText('1,284');
    await page.getByRole('button', { name: '前期' }).click();
    await expect(item(page, 'customers').locator('.vbx-brick-stale')).toBeVisible();
    await expect(value).toHaveText('1,053');
    await expect(item(page, 'customers').locator('.vbx-brick-stale')).toHaveCount(0);
  });

  test('filters and sorts the table, mounting only the rows in view', async ({ page }) => {
    await open(page);
    const table = item(page, 'deals');
    await table.scrollIntoViewIfNeeded();
    expect(await table.locator('tbody tr[aria-rowindex]').count()).toBeLessThan(40);
    await expect(table.locator('table')).toHaveAttribute('aria-rowcount', '401');
    await table.getByRole('searchbox').fill('青葉');
    await expect(table.locator('.vbx-table-count')).toHaveText('50');
    await table.getByRole('button', { name: '金額' }).click();
    await expect(table.locator('th[aria-sort="ascending"]')).toHaveCount(1);
    await expect(table.locator('.vbx-badge').first()).toBeVisible();
  });

  test('zooms a time series by dragging and resets', async ({ page }) => {
    test.skip(isMobile(page), 'mouse drag');
    await open(page);
    const t = await box(page, 'traffic');
    await page.mouse.move(t.x + t.width * 0.4, t.y + t.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(t.x + t.width * 0.7, t.y + t.height * 0.6, { steps: 6 });
    await expect(item(page, 'traffic').locator('.vbx-brush')).toBeVisible();
    await page.mouse.up();
    const reset = item(page, 'traffic').getByRole('button', { name: 'ズームを解除' });
    await expect(reset).toBeVisible();
    await reset.click();
    await expect(reset).toHaveCount(0);
  });

  test('downloads a brick as CSV and as an image', async ({ page, browserName }) => {
    test.skip(isMobile(page), 'hover menu');
    await open(page);
    await item(page, 'regions').hover();
    await item(page, 'regions').getByRole('button', { name: /ブリックの操作/ }).click();
    const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'CSV をダウンロード' }).click()]);
    const stream = await csv.createReadStream();
    let text = '';
    for await (const chunk of stream) text += chunk.toString('utf8');
    expect(text).toContain('label,value');
    expect(text).toContain('関東,4280');

    // Rendering HTML through an SVG foreignObject is not supported by WebKit's canvas.
    test.skip(browserName === 'webkit', 'image export relies on foreignObject rendering');
    await item(page, 'plans').hover();
    await item(page, 'plans').getByRole('button', { name: /ブリックの操作/ }).click();
    const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: '画像をダウンロード' }).click()]);
    const bytes: Buffer[] = [];
    for await (const chunk of await png.createReadStream()) bytes.push(chunk as Buffer);
    const image = Buffer.concat(bytes);
    expect(image.subarray(1, 4).toString()).toBe('PNG');
    expect(image.length).toBeGreaterThan(5000);
  });
});
