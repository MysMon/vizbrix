// Regenerates the screenshots used by docs/GALLERY.md from the playground.
//   node scripts/capture-docs.mjs
// Starts the playground dev server itself and needs Chromium for Playwright.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const PORT = 5181;
const URL = `http://localhost:${PORT}`;
const OUT = 'docs/images';
mkdirSync(OUT, { recursive: true });

const server = spawn('pnpm', ['--dir', 'examples/playground', 'exec', 'vite', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
});
const stop = () => server.kill();
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('playground did not start');
}

await waitForServer();
const browser = await chromium.launch();

async function open(query = '', viewport = { width: 1360, height: 900 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const page = await context.newPage();
  await page.goto(`${URL}/${query}`, { waitUntil: 'networkidle' });
  await page.locator('[data-vbx-item="revenue"] path.vbx-line').first().waitFor();
  await page.waitForTimeout(300);
  return page;
}

const item = (page, id) => page.locator(`[data-vbx-item="${id}"]`);
const box = (page, id) => item(page, id).boundingBox();
const shot = (page, name, options = {}) => page.screenshot({ path: `${OUT}/${name}.png`, ...options });

/** Screenshot the region spanning several bricks, with a margin. */
async function region(page, name, ids, pad = 12) {
  const boxes = await Promise.all(ids.map((id) => box(page, id)));
  const x0 = Math.min(...boxes.map((b) => b.x)) - pad;
  const y0 = Math.min(...boxes.map((b) => b.y)) - pad;
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
  const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - 80)), y0 + (await page.evaluate(() => window.scrollY)));
  await page.waitForTimeout(150);
  const again = await Promise.all(ids.map((id) => box(page, id)));
  const top = Math.min(...again.map((b) => b.y)) - pad;
  await shot(page, name, { clip: { x: Math.max(0, x0), y: Math.max(0, top), width: x1 - x0, height: y1 - y0 } });
}

// ---- Overview, light and dark
{
  const page = await open();
  await shot(page, 'overview-light', { fullPage: true });
  await region(page, 'bricks-stats', ['mrr', 'customers', 'churn', 'nps']);
  await region(page, 'bricks-line-donut', ['revenue', 'plans']);
  await region(page, 'bricks-bar-area-ranking', ['channels', 'traffic', 'regions']);
  await region(page, 'bricks-funnel-heatmap-scatter', ['funnel', 'inquiries', 'accounts']);
  await region(page, 'bricks-table-meter', ['deals', 'quota', 'note']);
  await page.waitForTimeout(900); // ECharts entrance animation
  await region(page, 'bricks-echarts', ['flow', 'mix']);

  // Tooltip on the line chart
  await page.evaluate(() => window.scrollTo(0, 0));
  const r = await box(page, 'revenue');
  await page.mouse.move(r.x + r.width * 0.62, r.y + r.height * 0.6);
  await page.waitForTimeout(150);
  await shot(page, 'hover-line', { clip: { x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24 } });

  // Band tooltip on the bar chart
  const c = await box(page, 'channels');
  await page.mouse.move(c.x + c.width * 0.45, c.y + c.height * 0.6);
  await page.waitForTimeout(150);
  await shot(page, 'hover-bar', { clip: { x: c.x - 12, y: c.y - 12, width: c.width + 24, height: c.height + 24 } });

  // Zoom brush on the area chart
  const t = await box(page, 'traffic');
  await page.mouse.move(t.x + t.width * 0.35, t.y + t.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(t.x + t.width * 0.7, t.y + t.height * 0.6, { steps: 6 });
  await shot(page, 'zoom-brush', { clip: { x: t.x - 12, y: t.y - 12, width: t.width + 24, height: t.height + 24 } });
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.mouse.move(0, 0);
  await shot(page, 'zoom-result', { clip: { x: t.x - 12, y: t.y - 12, width: t.width + 24, height: t.height + 24 } });

  // Export menu
  await item(page, 'regions').hover();
  await item(page, 'regions').locator('.vbx-brick-actions button').first().click();
  const g = await box(page, 'regions');
  await shot(page, 'export-menu', { clip: { x: g.x - 60, y: g.y - 12, width: g.width + 72, height: 200 } });
  await page.keyboard.press('Escape');

  // Refetch: previous render dimmed
  await page.getByRole('button', { name: '前期' }).click();
  await page.waitForTimeout(250);
  await shot(page, 'state-loading', { clip: { x: 0, y: 60, width: 1360, height: 540 } });
  await page.context().close();
}
{
  const page = await open('?theme=dark');
  await shot(page, 'overview-dark', { fullPage: true });
  await page.context().close();
}

// ---- Responsive
{
  const page = await open('?width=820px', { width: 900, height: 900 });
  await shot(page, 'responsive-tablet', { clip: { x: 0, y: 0, width: 900, height: 1080 }, fullPage: true });
  await page.context().close();
}
{
  const page = await open('', { width: 390, height: 844 });
  await shot(page, 'responsive-mobile', { clip: { x: 0, y: 0, width: 390, height: 1500 }, fullPage: true });
  await page.context().close();
}

// ---- Editing
{
  const page = await open('?edit&overlap=allow');
  await shot(page, 'edit-mode', { clip: { x: 0, y: 0, width: 1360, height: 620 } });

  // Mid-drag with snap guides
  const p = await box(page, 'plans');
  await page.mouse.move(p.x + 120, p.y + 120);
  await page.mouse.down();
  await page.mouse.move(p.x + 118, p.y + 200, { steps: 5 });
  await page.mouse.move(p.x + 117, p.y + 458, { steps: 10 });
  await page.waitForTimeout(150);
  await shot(page, 'edit-drag', { clip: { x: 0, y: 60, width: 1360, height: 900 - 60 } });
  await page.keyboard.press('Escape');
  await page.mouse.up();

  // Brick menu
  await item(page, 'revenue').locator('.vbx-item-menu button').first().click();
  await page.waitForTimeout(100);
  await shot(page, 'edit-menu', { clip: { x: 560, y: 250, width: 360, height: 430 } });
  await page.keyboard.press('Escape');

  // Settings panel
  await item(page, 'channels').locator('.vbx-item-menu button').first().click();
  await page.getByRole('button', { name: '設定…' }).click();
  await page.waitForTimeout(150);
  await shot(page, 'edit-settings', { clip: { x: 0, y: 0, width: 1360, height: 900 } });
  await page.getByRole('complementary').getByRole('button', { name: '閉じる' }).click();

  // Add menu
  await page.getByRole('button', { name: '追加' }).click();
  await page.waitForTimeout(100);
  await shot(page, 'edit-add', { clip: { x: 940, y: 60, width: 420, height: 480 } });
  await page.keyboard.press('Escape');

  // Marquee selection and the align tools
  const m = await box(page, 'mrr');
  const n = await box(page, 'nps');
  await page.mouse.move(m.x + 5, m.y + m.height + 8);
  await page.mouse.down();
  await page.mouse.move(m.x + 200, m.y + m.height - 20, { steps: 4 });
  await page.mouse.move(n.x + 60, m.y + 30, { steps: 6 });
  await shot(page, 'edit-marquee', { clip: { x: 0, y: 60, width: 1360, height: 210 } });
  await page.mouse.up();
  await page.waitForTimeout(100);
  await shot(page, 'edit-align', { clip: { x: 0, y: 60, width: 1360, height: 210 } });
  await page.context().close();
}
{
  // Editing at a narrower width: the layout indicator
  const page = await open('?edit&width=820px', { width: 900, height: 700 });
  await shot(page, 'edit-breakpoint', { clip: { x: 0, y: 60, width: 900, height: 360 } });
  await page.context().close();
}

await browser.close();
stop();
console.log(`screenshots written to ${OUT}`);
