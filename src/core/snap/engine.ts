/**
 * The snap engine — phase 2 of spec §9.
 *
 * ## Shape of the thing
 *
 * `begin(snapshot)` collects sorted candidate arrays once per gesture (see
 * `providers.ts`). `query(rect, …)` runs per frame: it binary-searches those
 * arrays around the moving rect's reference points, picks the best candidate
 * per axis by (priority, then distance), and returns the correction plus the
 * guide lines to draw. `end()` drops the state.
 *
 * ## Zero measurement
 *
 * Nothing here touches the DOM. Every rect the engine sees came from the
 * snapshot frozen at pointerdown, so a gesture performs zero
 * `getBoundingClientRect` calls no matter how long it runs.
 *
 * ## Buffer reuse contract — READ THIS
 *
 * `query()` is on the per-frame path, so it allocates nothing: the returned
 * `SnapResult`, its `guides` array, and the `Guide` objects inside it are all
 * reused across calls. **Consumers must not retain the result or its guides
 * across frames.** Read `dx`/`dy` immediately and copy any guide you intend to
 * keep (`{ ...guide }`). The overlay is expected to write the guides into the
 * DOM synchronously in the same frame, which is exactly what §1.25 prescribes.
 *
 * ## Corrections
 *
 * For a move, `dx`/`dy` translate the whole rect. For a resize they are the
 * correction of the edge(s) the handle moves — `w` moves the x start (`x +=
 * dx; w -= dx`), `e` moves the x end (`w += dx`), `se` moves both ends, and so
 * on. Axes with no moving edge get `0`. A `null` handle means "move" even when
 * `kind` says `'resize'`.
 */

import type {
  Axis,
  GestureSnapshot,
  Guide,
  HandleId,
  Rect,
  SnapConfig,
  SnapEngine,
  SnapResult,
} from '../schema/types';
import type { AxisCandidates, ResolvedSnapConfig } from './providers';
import {
  AX,
  AY,
  K_CENTER,
  K_EDGE,
  K_GAP,
  K_GRID,
  K_SIZE,
  LINE_EPS,
  PRI_GRID,
  PRI_SIZE,
  REF_ALL,
  REF_CENTER,
  REF_END,
  REF_START,
  axPos,
  axSize,
  collectAxis,
  lowerBound,
  movingUnion,
  resolveSnapConfig,
} from './providers';

/** Hits recorded per axis for guide emission; overflow only loses guides. */
const MAX_HITS = 256;
/** Guides drawn per axis in one frame. */
const MAX_GUIDES_PER_AXIS = 6;

const REF_BITS = [REF_START, REF_CENTER, REF_END] as const;

/** Mutable view of a pooled guide. `Guide`'s fields are already mutable. */
type MutableGuide = Guide;

/**
 * Create a snap engine.
 *
 * @param config `false` disables snapping entirely (every query returns a zero
 * correction and no guides); `undefined` takes the defaults — sibling edges and
 * centres, equal-gap, container edges ON, grid OFF, threshold 8 screen px.
 */
export function createSnapEngine(config?: SnapConfig | false): SnapEngine {
  const cfg: ResolvedSnapConfig | null = resolveSnapConfig(config);

  let snapshot: GestureSnapshot | null = null;
  let candX: AxisCandidates | null = null;
  let candY: AxisCandidates | null = null;
  /** Snap threshold in container px (screen px ÷ canvas scale). */
  let threshold = 8;

  /* ---- reusable buffers (never reallocated after construction) ---- */

  const hitDelta = new Float64Array(MAX_HITS);
  const hitLine = new Float64Array(MAX_HITS);
  const hitFrom = new Float64Array(MAX_HITS);
  const hitTo = new Float64Array(MAX_HITS);
  const hitKind = new Uint8Array(MAX_HITS);
  let hitCount = 0;

  const pool: MutableGuide[] = [];
  for (let i = 0; i < MAX_GUIDES_PER_AXIS * 2; i++) {
    pool.push({ axis: 'x', at: 0, from: 0, to: 0, kind: 'edge' });
  }
  const guideRank = new Uint8Array(pool.length);
  let poolUsed = 0;

  const guides: Guide[] = [];
  const result: { dx: number; dy: number; guides: Guide[] } = { dx: 0, dy: 0, guides };

  /* ---- best-candidate accumulator (per axis, per query) ---- */

  let bestFound = false;
  let bestPri = -1;
  let bestAbs = 0;
  let bestDelta = 0;

  function resetResult(): SnapResult {
    guides.length = 0;
    poolUsed = 0;
    result.dx = 0;
    result.dy = 0;
    return result;
  }

  function record(delta: number, line: number, from: number, to: number, kind: number): void {
    if (hitCount >= MAX_HITS) return;
    hitDelta[hitCount] = delta;
    hitLine[hitCount] = line;
    hitFrom[hitCount] = from;
    hitTo[hitCount] = to;
    hitKind[hitCount] = kind;
    hitCount++;
  }

  function consider(pri: number, delta: number): void {
    const abs = delta < 0 ? -delta : delta;
    if (!bestFound || pri > bestPri || (pri === bestPri && abs < bestAbs)) {
      bestFound = true;
      bestPri = pri;
      bestAbs = abs;
      bestDelta = delta;
    }
  }

  /**
   * Solve one axis: fill the hit buffer, pick the winner, emit its guides.
   * Returns the correction for this axis (0 when nothing is in range).
   */
  function solveAxis(ax: number, rect: Rect, cand: AxisCandidates | null, refMask: number): number {
    hitCount = 0;
    bestFound = false;
    bestPri = -1;
    bestAbs = 0;
    bestDelta = 0;

    if (refMask === 0 || !cfg) return 0;

    const pos = axPos(rect, ax);
    const size = axSize(rect, ax);
    const t = threshold;

    /* --- positional candidates ------------------------------------- */
    if (cand && cand.count > 0) {
      for (const bit of REF_BITS) {
        if ((refMask & bit) === 0) continue;
        const ref = bit === REF_START ? pos : bit === REF_CENTER ? pos + size / 2 : pos + size;
        const lo = lowerBound(cand.value, cand.count, ref - t);
        for (let i = lo; i < cand.count; i++) {
          const v = cand.value[i]!;
          if (v > ref + t) break;
          if ((cand.mask[i]! & bit) === 0) continue;
          const delta = v - ref;
          record(delta, v, cand.from[i]!, cand.to[i]!, cand.kind[i]!);
          consider(cand.pri[i]!, delta);
        }
      }
    }

    /* --- sizeMatch (resize only, one moving edge on this axis) ------ */
    const isSingleEdge = refMask === REF_START || refMask === REF_END;
    if (cand && isSingleEdge && cand.sizeCount > 0) {
      const lo = lowerBound(cand.sizeValue, cand.sizeCount, size - t);
      for (let i = lo; i < cand.sizeCount; i++) {
        const s = cand.sizeValue[i]!;
        if (s > size + t) break;
        /* Moving the start edge shrinks toward a fixed end, so the sign flips. */
        const delta = refMask === REF_START ? size - s : s - size;
        const line = refMask === REF_START ? pos + delta : pos + size + delta;
        record(delta, line, cand.sizeFrom[i]!, cand.sizeTo[i]!, K_SIZE);
        consider(PRI_SIZE, delta);
      }
    }

    /* --- grid (analytic; never materialised into the arrays) -------- */
    if (cfg.grid > 0) {
      const perpExtent = snapshot ? (ax === AX ? snapshot.height : snapshot.width) : 0;
      for (const bit of REF_BITS) {
        if ((refMask & bit) === 0) continue;
        const ref = bit === REF_START ? pos : bit === REF_CENTER ? pos + size / 2 : pos + size;
        const line = Math.round(ref / cfg.grid) * cfg.grid;
        const delta = line - ref;
        if (Math.abs(delta) > t) continue;
        record(delta, line, 0, perpExtent, K_GRID);
        consider(PRI_GRID, delta);
      }
    }

    if (!bestFound) return 0;

    /* --- guides ----------------------------------------------------- */
    const guideStart = guides.length;
    const mFrom = axPos(rect, 1 - ax);
    const mTo = mFrom + axSize(rect, 1 - ax);
    const axis: Axis = ax === AX ? 'x' : 'y';
    for (let i = 0; i < hitCount; i++) {
      /* Only hits satisfied by the correction we actually apply. */
      if (Math.abs(hitDelta[i]! - bestDelta) > LINE_EPS) continue;
      emitGuide(
        axis,
        hitLine[i]!,
        Math.min(hitFrom[i]!, mFrom),
        Math.max(hitTo[i]!, mTo),
        hitKind[i]!,
        guideStart,
      );
    }

    return bestDelta;
  }

  /** Merge a hit into the axis' guide list, or start a new line for it. */
  function emitGuide(
    axis: Axis,
    line: number,
    from: number,
    to: number,
    kind: number,
    guideStart: number,
  ): void {
    const rank = kindRank(kind);
    for (let i = guideStart; i < guides.length; i++) {
      const g = guides[i]!;
      if (Math.abs(g.at - line) <= LINE_EPS) {
        if (from < g.from) g.from = from;
        if (to > g.to) g.to = to;
        if (rank > guideRank[i]!) {
          guideRank[i] = rank;
          g.kind = guideKind(kind);
        }
        return;
      }
    }
    if (guides.length - guideStart >= MAX_GUIDES_PER_AXIS) return;
    if (poolUsed >= pool.length) return;
    const g = pool[poolUsed++]!;
    g.axis = axis;
    g.at = line;
    g.from = from;
    g.to = to;
    g.kind = guideKind(kind);
    guideRank[guides.length] = rank;
    guides.push(g);
  }

  /**
   * Re-collect an axis whose candidate set no longer covers the moving rect
   * (spec §1.9). Only fires when the cap truncated the collection, and only
   * when the anchor has actually moved, so a rect parked beyond the last item
   * cannot re-collect every frame.
   */
  function ensureCoverage(rect: Rect): void {
    if (!snapshot || !cfg) return;
    if (candX && candX.truncated) candX = recollect(candX, rect, AX) ?? candX;
    if (candY && candY.truncated) candY = recollect(candY, rect, AY) ?? candY;
  }

  function recollect(cand: AxisCandidates, rect: Rect, ax: number): AxisCandidates | null {
    const pos = axPos(rect, ax);
    const size = axSize(rect, ax);
    if (pos - threshold >= cand.coverMin && pos + size + threshold <= cand.coverMax) return null;
    if (Math.abs(pos - cand.anchor) <= LINE_EPS) return null;
    return collectAxis(snapshot!, cfg!, ax, rect, pos);
  }

  return {
    begin(snap: GestureSnapshot): void {
      resetResult();
      if (!cfg) {
        snapshot = null;
        candX = null;
        candY = null;
        return;
      }
      snapshot = snap;
      const scale = Number.isFinite(snap.scale) && snap.scale > 0 ? snap.scale : 1;
      threshold = cfg.threshold / scale;
      const moving = movingUnion(snap) ?? {
        x: snap.width / 2,
        y: snap.height / 2,
        w: 0,
        h: 0,
      };
      candX = collectAxis(snap, cfg, AX, moving, moving.x);
      candY = collectAxis(snap, cfg, AY, moving, moving.y);
    },

    query(rect: Rect, kind: 'move' | 'resize', handle: HandleId | null, bypass: boolean): SnapResult {
      resetResult();
      if (bypass || !cfg || !snapshot) return result;

      ensureCoverage(rect);

      const resizing = kind === 'resize' && handle !== null;
      const maskX = resizing ? handleMask(handle, AX) : REF_ALL;
      const maskY = resizing ? handleMask(handle, AY) : REF_ALL;

      result.dx = solveAxis(AX, rect, candX, maskX);
      result.dy = solveAxis(AY, rect, candY, maskY);
      return result;
    },

    end(): void {
      resetResult();
      snapshot = null;
      candX = null;
      candY = null;
    },
  };
}

/** Which reference point of the moving rect a resize handle drives on `ax`. */
function handleMask(handle: HandleId, ax: number): number {
  if (ax === AX) {
    if (handle === 'w' || handle === 'nw' || handle === 'sw') return REF_START;
    if (handle === 'e' || handle === 'ne' || handle === 'se') return REF_END;
    return 0;
  }
  if (handle === 'n' || handle === 'ne' || handle === 'nw') return REF_START;
  if (handle === 's' || handle === 'se' || handle === 'sw') return REF_END;
  return 0;
}

/** `K_*` → the public guide kind. A size match is drawn as an edge line. */
function guideKind(kind: number): Guide['kind'] {
  switch (kind) {
    case K_CENTER:
      return 'center';
    case K_GAP:
      return 'gap';
    case K_GRID:
      return 'grid';
    case K_EDGE:
    case K_SIZE:
    default:
      return 'edge';
  }
}

/** Visual precedence when several kinds land on one merged line. */
function kindRank(kind: number): number {
  switch (kind) {
    case K_EDGE:
    case K_SIZE:
      return 3;
    case K_CENTER:
      return 2;
    case K_GAP:
      return 1;
    default:
      return 0;
  }
}
