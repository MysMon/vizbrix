/**
 * Responsive cascade (tier 2) and stack ordering (tier 3).
 *
 * The JS fold implemented here and the emitted `@container` cascade are the
 * same algorithm expressed twice; `css-differential` tests hold them together.
 * Both are desktop-first: sizes are declared by `maxWidth`, every size whose
 * `maxWidth` is ≥ the current width is active, and smaller sizes win.
 */

import type { ContainerConfig, LayoutItemBase } from '../schema/types';
import { resolveItem } from './resolve';

/**
 * Named sizes active at `width`, ordered OUTERMOST → INNERMOST
 * (descending `maxWidth`, ties broken by name for determinism).
 *
 * A size is active when `width <= size.maxWidth`. Folding in the returned
 * order means later entries — the smaller sizes — win, which is exactly how
 * the emitted `@container (max-width: …)` blocks cascade.
 */
export function activeSizesAt(config: ContainerConfig, width: number): string[] {
  const sizes = config?.sizes;
  if (!sizes) return [];
  const w = typeof width === 'number' && Number.isFinite(width) ? width : 0;
  const names: string[] = [];
  for (const name of Object.keys(sizes)) {
    const maxWidth = sizes[name]?.maxWidth;
    if (typeof maxWidth === 'number' && Number.isFinite(maxWidth) && w <= maxWidth) {
      names.push(name);
    }
  }
  names.sort((a, b) => {
    const d = (sizes[b]?.maxWidth ?? 0) - (sizes[a]?.maxWidth ?? 0);
    if (d !== 0) return d;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return names;
}

/**
 * Apply `item.at` overrides for `activeSizes` (outermost → innermost) on top of
 * the item's base fields.
 *
 * Placements replace WHOLESALE — modes have disjoint fields, so a partial merge
 * across modes is unsound. Only `x`, `y`, `hidden` and `order` may be
 * overridden (per-size `z` is forbidden by the schema).
 *
 * Returns the input object unchanged when nothing applies, so callers can use
 * identity as a cheap "did anything change" test.
 */
export function foldItem(item: LayoutItemBase, activeSizes: readonly string[]): LayoutItemBase {
  const at = item?.at;
  if (!at || activeSizes.length === 0) return item;
  let out: LayoutItemBase | null = null;
  for (const name of activeSizes) {
    const override = at[name];
    if (!override) continue;
    if (!out) out = { ...item };
    if (override.x) out.x = override.x;
    if (override.y) out.y = override.y;
    if (typeof override.hidden === 'boolean') out.hidden = override.hidden;
    if (typeof override.order === 'number') out.order = override.order;
  }
  return out ?? item;
}

/**
 * Tier-3 (single column) reading order: the ids of `items` in stacking order.
 *
 * Base ordering is the geometric reading order — resolved `y` at
 * `container.base.width`, then `x`, then `id` — which is stable across
 * container widths and therefore hydration-safe. `item.order`, when present,
 * replaces that item's rank; items without `order` keep their geometric rank,
 * so an explicit `order: 0` moves an item to the front without disturbing the
 * relative order of everything else.
 *
 * Items are used exactly as passed: no `at` folding happens here (fold first if
 * you want per-size `order` overrides to apply).
 */
export function stackOrder(items: readonly LayoutItemBase[], config: ContainerConfig): string[] {
  // `sizes: undefined` prevents resolveItem from folding a second time.
  const baseConfig: ContainerConfig = { ...config, sizes: undefined };
  const width = config?.base?.width ?? 0;
  const height = config?.base?.height;

  const entries = items.map((item, index) => ({
    item,
    index,
    rect: resolveItem(item, baseConfig, width, height),
  }));

  const geometric = entries.slice().sort((a, b) => {
    if (a.rect.y !== b.rect.y) return a.rect.y - b.rect.y;
    if (a.rect.x !== b.rect.x) return a.rect.x - b.rect.x;
    if (a.item.id !== b.item.id) return a.item.id < b.item.id ? -1 : 1;
    return a.index - b.index;
  });

  const rank = new Map<number, number>();
  geometric.forEach((entry, i) => rank.set(entry.index, i));

  const explicit = (o: unknown): o is number => typeof o === 'number' && Number.isFinite(o);

  return entries
    .slice()
    .sort((a, b) => {
      const ra = rank.get(a.index) ?? a.index;
      const rb = rank.get(b.index) ?? b.index;
      const ea = explicit(a.item.order);
      const eb = explicit(b.item.order);
      const ka = ea ? (a.item.order as number) : ra;
      const kb = eb ? (b.item.order as number) : rb;
      if (ka !== kb) return ka - kb;
      // An explicit order is an intent; it wins the tie against a rank that
      // merely happened to land on the same number.
      if (ea !== eb) return ea ? -1 : 1;
      return ra - rb;
    })
    .map((entry) => entry.item.id);
}
