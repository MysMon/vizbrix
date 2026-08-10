/**
 * Re-encoding — the inverse of resolution at a given extent.
 *
 * Every commit (drag, resize, keyboard nudge, anchor change) ends here: the
 * interaction layer produces pixels, `reencode` turns them back into the
 * affine expression the document stores, under the anchor mode the item is
 * meant to keep. `setAnchor` is literally resolve-then-reencode with a new
 * mode, which is why changing an anchor never moves an item.
 */

import type {
  AxisMode,
  AxisPlacement,
  ContainerConfig,
  PlacementPair,
  Rect,
} from '../schema/types';
import { canonLen, roundPct, roundPx } from './len';
import { degradesOnY, yExtentOf } from './resolve';

function finite(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/**
 * Encode a resolved `(pos, size)` pair back into a placement of the given mode.
 *
 * | mode   | writes                                                          |
 * |--------|-----------------------------------------------------------------|
 * | start  | `{ offset: pos, size }` (px)                                     |
 * | end    | `{ offset: extent − pos − size, size }` (px)                      |
 * | both   | `{ start: pos, end: extent − pos − size }` (px)                   |
 * | center | `{ offset: pos + size/2 − extent/2, size }` (px)                  |
 * | scale  | `{ offset: {pct}, size: {pct} }` — fractions of the extent        |
 *
 * Pixel terms round to 2 decimals, percentages to 4. The resulting lengths are
 * canonical (`canonLen`), so a zero term never survives into the JSON.
 *
 * Law: `resolveAxis(reencodeAxis(pos, size, W, m), W) ≈ (pos, size)` within
 * 0.5 px for every mode and every W in [1, 10000].
 */
export function reencodeAxis(
  pos: number,
  size: number,
  extent: number,
  mode: AxisMode,
): AxisPlacement {
  const p = finite(pos);
  const s = finite(size);
  const w = finite(extent);
  switch (mode) {
    case 'end':
      return { mode: 'end', offset: canonLen(roundPx(w - p - s)), size: canonLen(roundPx(s)) };
    case 'both':
      return { mode: 'both', start: canonLen(roundPx(p)), end: canonLen(roundPx(w - p - s)) };
    case 'center':
      return {
        mode: 'center',
        offset: canonLen(roundPx(p + s / 2 - w / 2)),
        size: canonLen(roundPx(s)),
      };
    case 'scale': {
      // A zero (or absent) extent has no fractions to speak of; fall back to px
      // so the placement still round-trips instead of producing Infinity/NaN.
      if (w === 0) {
        return { mode: 'scale', offset: canonLen(roundPx(p)), size: canonLen(roundPx(s)) };
      }
      return {
        mode: 'scale',
        offset: canonLen({ pct: roundPct((p / w) * 100) }),
        size: canonLen({ pct: roundPct((s / w) * 100) }),
      };
    }
    case 'start':
    default:
      return { mode: 'start', offset: canonLen(roundPx(p)), size: canonLen(roundPx(s)) };
  }
}

/**
 * Encode a resolved rect back into a placement pair.
 *
 * The y axis honors the container's degradation rule: under `height: 'auto'`
 * every mode but `start` is unresolvable, so the y placement is written as
 * plain-pixel `start` — the same thing `resolveItem` and the emitted CSS do.
 *
 * Under `responsive: 'scale'` callers must pass the DESIGN extent
 * (`container.base.width`), not the scaled on-screen extent: the canvas is
 * scaled by a transform, so the document keeps design-space coordinates.
 *
 * @param rect   resolved rect in container (logical) coordinates
 * @param width  container width the rect was measured against
 * @param height measured container height; only used under `height: 'fill'`
 */
export function reencodeRect(
  rect: Rect,
  config: ContainerConfig,
  width: number,
  height: number | undefined,
  xMode: AxisMode,
  yMode: AxisMode,
): PlacementPair {
  const r: Rect = {
    x: finite(rect?.x),
    y: finite(rect?.y),
    w: finite(rect?.w),
    h: finite(rect?.h),
  };
  const effectiveY: AxisMode = degradesOnY(config, yMode) ? 'start' : yMode;
  return {
    x: reencodeAxis(r.x, r.w, finite(width), xMode),
    y: reencodeAxis(r.y, r.h, yExtentOf(config, height), effectiveY),
  };
}
