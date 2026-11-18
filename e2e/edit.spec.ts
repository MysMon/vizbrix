import { expect, test } from '@playwright/test';
import { box, isMobile, item, open, stored } from './helpers';

test.describe('editing with mouse and keyboard', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(isMobile(page), 'desktop pointer');
    await open(page, '?edit');
  });

  test('drags a brick, snapping to its neighbours, commits once and undoes', async ({ page }) => {
    await open(page, '?edit&overlap=allow');
    const before = (await stored(page)).items?.find((i) => i.id === 'plans') ?? { x: 800, y: 148 };
    const plans = await box(page, 'plans');
    // 5px off horizontally and 197px down: both axes should snap to neighbouring edges.
    await page.mouse.move(plans.x + 100, plans.y + 100);
    await page.mouse.down();
    await page.mouse.move(plans.x + 102, plans.y + 150, { steps: 4 });
    await page.mouse.move(plans.x + 105, plans.y + 297, { steps: 8 });
    await expect(item(page, 'plans')).toHaveAttribute('data-vbx-dragging', '');
    await expect(page.locator('.vbx-guide').first()).toBeVisible();
    await page.mouse.up();
    await expect(item(page, 'plans')).not.toHaveAttribute('data-vbx-dragging', '');
    await expect(page.locator('.vbx-guide')).toHaveCount(0);
    const moved = (await stored(page)).items.find((i) => i.id === 'plans')!;
    expect(moved.x).toBe(800); // snapped back to the column edge, not 5 units off
    expect(moved.y).toBeGreaterThan(before.y + 150);
    expect(moved.y % 4).toBe(0);

    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await stored(page)).items.find((i) => i.id === 'plans')!.y).toBe(148);
  });

  test('refuses to leave a dropped brick on top of another (overlap: avoid)', async ({ page }) => {
    const plans = await box(page, 'plans');
    await page.mouse.move(plans.x + 100, plans.y + 100);
    await page.mouse.down();
    await page.mouse.move(plans.x - 100, plans.y + 110, { steps: 6 });
    await page.mouse.move(plans.x - 300, plans.y + 120, { steps: 6 });
    await page.mouse.up();
    const after = await box(page, 'plans');
    for (const id of ['revenue', 'channels', 'traffic', 'regions', 'mrr', 'nps']) {
      const other = await box(page, id);
      const apart =
        after.x >= other.x + other.width - 1 ||
        after.x + after.width <= other.x + 1 ||
        after.y >= other.y + other.height - 1 ||
        after.y + after.height <= other.y + 1;
      expect(apart, `plans overlaps ${id}`).toBe(true);
    }
  });

  test('resizes from a handle, holding the opposite edge', async ({ page }) => {
    await open(page, '?edit&overlap=allow');
    await item(page, 'plans').locator('.vbx-grip').click({ position: { x: 30, y: 60 } });
    const handle = await item(page, 'plans').locator('[data-vbx-handle="w"]').boundingBox();
    await page.mouse.move(handle!.x + 5, handle!.y + 5);
    await page.mouse.down();
    await page.mouse.move(handle!.x + 60, handle!.y + 5, { steps: 4 });
    await page.mouse.move(handle!.x + 105, handle!.y + 5, { steps: 6 });
    await page.mouse.up();
    const plans = (await stored(page)).items.find((i) => i.id === 'plans')!;
    expect(plans.x).toBeGreaterThan(880);
    expect(plans.x + plans.w).toBe(1200); // right edge did not move
    expect(plans.y).toBe(148);
  });

  test('moves and resizes from the keyboard and announces it', async ({ page }) => {
    await open(page, '?edit&overlap=allow');
    await item(page, 'plans').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[aria-live]')).toContainText('移動しました');
    await page.keyboard.press('Shift+ArrowUp');
    await expect.poll(async () => (await stored(page)).items.find((i) => i.id === 'plans')).toMatchObject({ x: 800, y: 160, h: 336 });
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await stored(page)).items.find((i) => i.id === 'plans')).toMatchObject({ y: 148, h: 340 });
  });

  test('selects with a marquee, aligns, copies and pastes', async ({ page }) => {
    const mrr = await box(page, 'mrr');
    const nps = await box(page, 'nps');
    // Start in the gutter under the first stat tile.
    await page.mouse.move(mrr.x + 5, mrr.y + mrr.height + 8);
    await page.mouse.down();
    await page.mouse.move(mrr.x + 200, mrr.y + mrr.height - 20, { steps: 4 });
    await page.mouse.move(nps.x + 40, mrr.y + 30, { steps: 6 });
    await expect(page.locator('.vbx-marquee')).toBeVisible();
    await page.mouse.up();
    await expect(page.locator('[data-selected]')).toHaveCount(4);
    await expect(page.getByRole('group', { name: '整列' }).getByRole('button')).toHaveCount(8);

    const count = await page.locator('[data-vbx-item]').count();
    await item(page, 'nps').locator('.vbx-grip').click({ position: { x: 20, y: 60 } });
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect(page.locator('[data-vbx-item]')).toHaveCount(count + 1);
  });

  test('configures a brick from the settings panel', async ({ page }) => {
    await item(page, 'channels').getByRole('button', { name: /ブリックの操作/ }).click();
    await page.getByRole('button', { name: '設定…' }).click();
    const panel = page.getByRole('complementary');
    await expect(panel).toContainText('チャネル別受注');
    await expect(item(page, 'channels').locator('.vbx-legend-item')).toHaveCount(3);
    await panel.getByRole('group', { name: '系列', exact: true }).getByLabel('オンライン').uncheck();
    await expect(item(page, 'channels').locator('.vbx-legend-item')).toHaveCount(2);
    await panel.getByLabel('横向き').check();
    expect((await stored(page)).items.find((i) => i.id === 'channels')!.props).toMatchObject({ horizontal: true, series: ['直販', 'パートナー'] });
    await panel.getByRole('button', { name: '閉じる' }).click();
    await expect(panel).toHaveCount(0);
  });

  test('adds a brick, opens its settings, and removes it', async ({ page }) => {
    const count = await page.locator('[data-vbx-item]').count();
    await page.getByRole('button', { name: '追加' }).click();
    await page.getByRole('menuitem', { name: /ファネル/ }).click();
    await expect(page.locator('[data-vbx-item]')).toHaveCount(count + 1);
    await expect(page.getByRole('complementary')).toContainText('ファネル');
    await page.getByRole('complementary').getByRole('button', { name: '閉じる' }).click();
    await page.locator('[data-selected]').focus();
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-vbx-item]')).toHaveCount(count);
  });

  test('saves a separate arrangement for a narrow width and can reset it', async ({ page }) => {
    await page.goto('/?edit&width=820px');
    await expect(page.locator('.vbx-chip')).toContainText('md');
    await expect(page.locator('.vbx-chip')).toContainText('自動');
    await item(page, 'mrr').focus();
    await page.keyboard.press('Shift+ArrowUp');
    await expect(page.locator('.vbx-chip')).toContainText('カスタム');
    const saved = await stored(page);
    expect(Object.keys(saved.layouts)).toEqual(['md']);
    expect(saved.items.find((i) => i.id === 'mrr')!.h).toBe(148); // base layout untouched
    await page.getByRole('button', { name: '自動レイアウトに戻す' }).click();
    await expect(page.locator('.vbx-chip')).toContainText('自動');
  });
});

test.describe('editing by touch', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isMobile(page), 'touch devices');
    await open(page, '?edit&overlap=allow');
  });

  test('a tap selects; the layout is the single-column one', async ({ page }) => {
    await item(page, 'mrr').locator('.vbx-grip').tap();
    await expect(item(page, 'mrr')).toHaveAttribute('data-selected', '');
    await expect(item(page, 'mrr').locator('.vbx-handle')).toHaveCount(8);
    await expect(page.locator('.vbx-chip')).toContainText('sm');
  });

  test('an unselected brick lets the page scroll; a selected one drags', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'touch drags are synthesized through the Chromium DevTools protocol');
    const cdp = await page.context().newCDPSession(page);
    const swipe = async (x: number, from: number, to: number): Promise<void> => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
      for (let i = 1; i <= 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + ((to - from) * i) / 8 }] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };

    // Swiping over an unselected brick scrolls the page and moves nothing.
    const customers = await box(page, 'customers');
    await swipe(customers.x + 100, customers.y + 60, customers.y - 140);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
    expect((await stored(page)).layouts ?? {}).toEqual({});

    // Select, then drag: the brick moves and the arrangement is saved for this width.
    await page.evaluate(() => window.scrollTo(0, 0));
    await item(page, 'mrr').locator('.vbx-grip').tap();
    const mrr = await box(page, 'mrr');
    await swipe(mrr.x + 100, mrr.y + 60, mrr.y + 260);
    await expect.poll(async () => Object.keys((await stored(page)).layouts ?? {})).toEqual(['sm']);
  });
});
