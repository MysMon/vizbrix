/**
 * Placement resolution — the pure, total core of vizbrix.
 *
 * `resolve` never measures, never touches the DOM, never looks at siblings and
 * never runs collision logic. Given a placement and an extent it returns
 * numbers; given a malformed document it returns zeros instead of throwing.
 * Everything the engine does downstream (CSS emission, snapping, hit-testing,
 * server rects) is a function of these numbers.
 */

import type {
  AxisMode,
  AxisPlacement,
  ContainerConfig,
  LayoutItemBase,
  Rect,
} from '../schema/types';
import { activeSizesAt, foldItem } from './cascade';
import { lenAt } from './len';

function finite(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function isNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Clamp a size to `[min, max]` and then to `>= 0`.
 *
 * `min` is applied last so it wins over a smaller `max`, matching CSS
 * (`min-width` beats `max-width`).
 */
function clampSize(
  size: number,
  min: number | undefined,
  max: number | undefined,
  floorZero: boolean,
): number {
  let s = size;
  if (isNum(max)) s = Math.min(s, max);
  if (isNum(min)) s = Math.max(s, min);
  if (floorZero && !(s > 0)) return 0;
  return s;
}

/**
 * Resolve one axis with optional size limits.
 *
 * The size is clamped FIRST and the position is then derived from the clamped
 * size, which is what keeps the anchored edge anchored:
 * - `start`/`scale`/`both` — position is size-independent, so a clamped size
 *   grows toward the END edge (the over-constrained abspos rule);
 * - `end` — the end edge stays pinned;
 * - `center` — the center stays pinned.
 *
 * @internal Used by resolveItem and by CSS emission; `resolveAxis` is the
 * documented entry point.
 */
export function resolveAxisClamped(
  p: AxisPlacement | undefined,
  extent: number,
  min?: number,
  max?: number,
  floorZero = true,
): { pos: number; size: number } {
  const w = finite(extent);
  if (!p || typeof p !== 'object') return { pos: 0, size: 0 };
  switch (p.mode) {
    case 'start':
    case 'scale': {
      const size = clampSize(lenAt(p.size, w), min, max, floorZero);
      return { pos: lenAt(p.offset, w), size };
    }
    case 'end': {
      const size = clampSize(lenAt(p.size, w), min, max, floorZero);
      return { pos: w - lenAt(p.offset, w) - size, size };
    }
    case 'both': {
      const start = lenAt(p.start, w);
      const size = clampSize(w - start - lenAt(p.end, w), min, max, floorZero);
      return { pos: start, size };
    }
    case 'center': {
      const size = clampSize(lenAt(p.size, w), min, max, floorZero);
      return { pos: w / 2 + lenAt(p.offset, w) - size / 2, size };
    }
    default:
      return { pos: 0, size: 0 };
  }
}

/**
 * Resolve a single-axis placement against a container extent.
 *
 * | mode        | pos                          | size                    |
 * |-------------|------------------------------|-------------------------|
 * | start/scale | `lenAt(offset, W)`           | `lenAt(size, W)`        |
 * | end         | `W − lenAt(offset,W) − size` | `lenAt(size, W)`        |
 * | both        | `lenAt(start, W)`            | `W − start − end`       |
 * | center      | `W/2 + lenAt(offset,W) − size/2` | `lenAt(size, W)`    |
 *
 * No clamping is applied here (`size` may be negative for a degenerate `both`):
 * limits belong to the item, so they are applied by {@link resolveItem}. This
 * keeps `resolveAxis` an exact inverse of `reencodeAxis`.
 */
export function resolveAxis(p: AxisPlacement, extent: number): { pos: number; size: number } {
  return resolveAxisClamped(p, extent, undefined, undefined, false);
}

/**
 * True when a y-axis placement in `mode` cannot be honored by this container
 * and must degrade (spec §1.6).
 *
 * A container with `height: 'auto'` has no definite height: its height is
 * determined by its content, so anchoring to the bottom, stretching between
 * both edges, centering or scaling are all circular. Under `'auto'` only
 * `start` survives; everything else is frozen at `base.height`. Validation uses
 * this predicate to raise the dev-mode warning.
 *
 * @internal Shared with schema validation and CSS emission.
 */
export function degradesOnY(config: ContainerConfig, mode: AxisMode): boolean {
  return config?.height !== 'fill' && mode !== 'start';
}

/**
 * The extent y placements resolve against.
 *
 * Under `height: 'fill'` this is the measured height (falling back to
 * `base.height`). Under `'auto'` the measured height is deliberately IGNORED —
 * it is a function of the layout we are computing — and `base.height` is used,
 * which is also exactly what CSS emission bakes in, so JS and CSS agree.
 *
 * @internal
 */
export function yExtentOf(config: ContainerConfig, height?: number): number {
  if (config?.height === 'fill' && isNum(height)) return height;
  return finite(config?.base?.height);
}

/**
 * Resolve an item to a rect: fold its responsive overrides for `width`, resolve
 * both axes, clamp to the item's min/max.
 *
 * Pure and total — no measurement, no collision, no DOM. `Rect.x` is LOGICAL:
 * it is the distance from the container's start edge (which is the right edge
 * under `direction: 'rtl'`); mapping logical → physical is CSS emission's job.
 *
 * @param item   item as persisted (overrides are folded here, not by the caller)
 * @param config container configuration
 * @param width  container width in px
 * @param height measured container height; only used under `height: 'fill'`
 */
export function resolveItem(
  item: LayoutItemBase,
  config: ContainerConfig,
  width: number,
  height?: number,
): Rect {
  const folded = foldItem(item, activeSizesAt(config, width));
  const w = finite(width);
  const h = yExtentOf(config, height);
  const x = resolveAxisClamped(folded.x, w, folded.minW, folded.maxW);
  const y = resolveAxisClamped(folded.y, h, folded.minH, folded.maxH);
  return { x: x.pos, y: y.pos, w: x.size, h: y.size };
}
