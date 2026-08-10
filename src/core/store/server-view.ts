/**
 * Whole-document resolution and the frozen server snapshot.
 *
 * Two responsibilities, both pure:
 *
 * 1. `resolveAllRects` — resolve every item of a document at one container
 *    size. This is the single place that knows how tier-3 stacking turns the
 *    absolutely-positioned layout into a flex column, so the rects the store
 *    hands out always describe what the emitted CSS actually does.
 * 2. `buildServerViews` — the snapshot set frozen at store construction and
 *    resolved at `container.base.width`. `useSyncExternalStore` calls it as
 *    `getServerSnapshot` on the server and during hydration, so it must be a
 *    pure function of the document and must never change afterwards.
 *
 * No DOM, no measurement, no globals.
 */

import type {
  ContainerConfig,
  ItemSnapshot,
  LayoutDoc,
  LayoutItem,
  LayoutItemBase,
  Rect,
} from '../schema/types';
import { activeSizesAt, foldItem, stackOrder } from '../geometry/cascade';
import { resolveItem } from '../geometry/resolve';
import { createZRanker } from '../order/zrank';

/** Gap between items in the tier-3 single column. Mirrors `css.ts`. */
const STACK_GAP = 8;
/** `stackBelow` used when the container does not declare one. Mirrors `css.ts`. */
const DEFAULT_STACK_BELOW = 480;

const ZERO_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };

function isNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function finite(n: unknown): number {
  return isNum(n) ? n : 0;
}

/** Ascending fractional-key order, ties broken by id so the order is total. */
export function compareByZ(a: LayoutItemBase, b: LayoutItemBase): number {
  const za = typeof a.z === 'string' ? a.z : '';
  const zb = typeof b.z === 'string' ? b.z : '';
  if (za !== zb) return za < zb ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * The extent placements resolve against.
 *
 * Under `responsive: 'scale'` the canvas is a fixed base-size surface that the
 * adapter scales with a transform, so the document always resolves at the
 * DESIGN width regardless of how many pixels it currently occupies (§1.11).
 */
export function layoutWidthOf(config: ContainerConfig, measuredWidth: number): number {
  if (config?.responsive === 'scale') return finite(config?.base?.width);
  return finite(measuredWidth);
}

/**
 * Config to resolve against: identical to the input except under
 * `responsive: 'scale'`, where named sizes are stripped because that mode emits
 * no `@container` blocks at all (§4) and so has no active sizes to fold.
 */
export function resolveConfigOf(config: ContainerConfig): ContainerConfig {
  if (config?.responsive === 'scale') return { ...config, sizes: undefined };
  return config;
}

/**
 * Named sizes active at a measured width, outermost → innermost.
 * Empty under `responsive: 'scale'` (no container queries are emitted there).
 */
export function activeSizesOf(config: ContainerConfig, measuredWidth: number): string[] {
  if (config?.responsive === 'scale') return [];
  return activeSizesAt(config, measuredWidth);
}

/** True when tier-3 single-column stacking is active at this measured width. */
export function isStackedAt(config: ContainerConfig, measuredWidth: number): boolean {
  if (config?.responsive === 'scale') return false;
  const stackBelow = isNum(config?.stackBelow) ? config.stackBelow : DEFAULT_STACK_BELOW;
  return stackBelow > 0 && isNum(measuredWidth) && measuredWidth < stackBelow;
}

/**
 * Resolve every item to a rect at one container size.
 *
 * At rest this is `resolveItem` per item and nothing else. Under tier-3 the
 * container becomes a flex column, so the rects are derived the way the emitted
 * stack block behaves: `x = 0`, full container width, height = the item's
 * height resolved against `base.height`, and `y` accumulated in stack order
 * with an 8px gap. Hidden items are `display:none` and therefore occupy no
 * space in the column.
 *
 * @param items        items in any order (stack order is computed here)
 * @param config       container configuration
 * @param layoutWidth  extent to resolve against (see {@link layoutWidthOf})
 * @param height       measured height; only meaningful under `height: 'fill'`
 * @param activeSizes  named sizes active at the measured width
 * @param stacked      whether tier-3 stacking is active
 */
export function resolveAllRects(
  items: readonly LayoutItemBase[],
  config: ContainerConfig,
  layoutWidth: number,
  height: number | undefined,
  activeSizes: readonly string[],
  stacked: boolean,
): Map<string, Rect> {
  const rc = resolveConfigOf(config);
  const out = new Map<string, Rect>();

  if (!stacked) {
    for (const item of items) out.set(item.id, resolveItem(item, rc, layoutWidth, height));
    return out;
  }

  // Tier-3: same DOM, CSS stacks it. `sizes: undefined` keeps `resolveItem`
  // from folding a second time over the already-folded items, and passing
  // `height: undefined` pins the row height to `base.height` exactly as the
  // emitted stack block does.
  const flat: ContainerConfig = { ...config, sizes: undefined };
  const folded = items.map((item) => foldItem(item, activeSizes));
  const heights = new Map<string, number>();
  const hidden = new Set<string>();
  for (const item of folded) {
    heights.set(item.id, resolveItem(item, flat, layoutWidth, undefined).h);
    if (item.hidden === true) hidden.add(item.id);
  }

  let cursor = 0;
  let first = true;
  for (const id of stackOrder(folded, config)) {
    const h = heights.get(id) ?? 0;
    if (hidden.has(id)) {
      out.set(id, { x: 0, y: cursor, w: layoutWidth, h });
      continue;
    }
    if (!first) cursor += STACK_GAP;
    first = false;
    out.set(id, { x: 0, y: cursor, w: layoutWidth, h });
    cursor += h;
  }

  // Defensive: anything stackOrder did not return still gets a rect.
  for (const item of items) {
    if (!out.has(item.id)) out.set(item.id, resolveItem(item, rc, layoutWidth, height));
  }
  return out;
}

/**
 * Build the immutable server snapshot set: every item resolved at
 * `container.base.width`, z-ranked, unselected, version 0.
 *
 * Frozen at store construction and never recomputed — the client may measure a
 * different width a frame later, but the markup React hydrates against must be
 * a pure function of the document (§1.21). The snapshots and their rects are
 * `Object.freeze`d so a consumer cannot make the two renders disagree.
 */
export function buildServerViews<TData>(
  doc: LayoutDoc<TData>,
): ReadonlyMap<string, ItemSnapshot<TData>> {
  const config: ContainerConfig = doc?.container ?? { base: { width: 0 } };
  const items: readonly LayoutItem<TData>[] = doc?.items ?? [];
  const measured = finite(config?.base?.width);
  const width = layoutWidthOf(config, measured);
  const height = isNum(config?.base?.height) ? config.base.height : undefined;

  const sorted = items.slice().sort(compareByZ);
  const zRanks = createZRanker().update(
    sorted.map((item) => ({ id: item.id, z: typeof item.z === 'string' ? item.z : '' })),
  );
  const rects = resolveAllRects(
    sorted,
    config,
    width,
    height,
    activeSizesOf(config, measured),
    isStackedAt(config, measured),
  );

  const views = new Map<string, ItemSnapshot<TData>>();
  for (const item of sorted) {
    views.set(
      item.id,
      Object.freeze({
        item,
        rect: Object.freeze({ ...(rects.get(item.id) ?? ZERO_RECT) }),
        zIndex: zRanks.get(item.id) ?? 0,
        selected: false,
        version: 0,
      }),
    );
  }
  return views;
}
