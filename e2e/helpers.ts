import { expect, type Locator, type Page } from '@playwright/test';

export const item = (page: Page, id: string): Locator => page.locator(`[data-vbx-item="${id}"]`);

export async function box(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await item(page, id).boundingBox();
  if (!b) throw new Error(`brick ${id} is not visible`);
  return b;
}

/** Open the playground with a clean layout. */
export async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await expect(item(page, 'mrr')).toBeVisible();
  // Charts draw after their first measurement.
  await expect(item(page, 'revenue').locator('path.vbx-line').first()).toBeVisible();
}

/** The layout the playground persisted, as stored JSON. */
export async function stored(page: Page): Promise<{ items: { id: string; x: number; y: number; w: number; h: number; props?: Record<string, unknown> }[]; layouts: Record<string, Record<string, unknown>> }> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('vizbrix-playground:v4') ?? '{}'));
}

export const isMobile = (page: Page): boolean => (page.viewportSize()?.width ?? 1000) < 700;
