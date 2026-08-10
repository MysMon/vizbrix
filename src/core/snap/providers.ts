/**
 * Snap candidate providers — phase 1 of the two-phase snap engine (spec §9).
 *
 * Everything in this file runs at `begin()` (and on a transparent re-collect),
 * never per frame. The output is a flat, sorted, structure-of-arrays candidate
 * set per axis so that `query()` can binary-search it and allocate nothing.
 *
 * A *candidate* is a line position on one axis plus the metadata needed to
 * (a) decide whether it may be compared against a given reference point of the
 * moving rect, (b) rank it against competing candidates, and (c) draw a guide.
 *
 * The providers, in the default order of §9:
 *
 * - **containerEdge** — the container's start edge, end edge and centre line.
 * - **siblingEdge**   — start/end of every non-moving item.
 * - **siblingCenter** — centre line of every non-moving item.
 * - **equalGap**      — positions that duplicate a gap already observed between
 *   two adjacent siblings that share ≥50% perpendicular overlap with the moving
 *   rect (the "band" heuristic; cf. tldraw's gap snapping).
 * - **sizeMatch**     — sibling widths/heights, compared against the moving
 *   rect's own size during a resize. Kept in a separate array because it is
 *   compared against a *size*, not a position.
 * - **grid**          — NOT materialised here. A grid is an infinite candidate
 *   set with a closed-form nearest element, so the engine computes it
 *   analytically in `query()`. That keeps it out of the 512 cap and out of the
 *   coverage bookkeeping.
 *
 * There is no DOM access, no `react`, and no module-scope global use here.
 */

import type { GestureSnapshot, Rect, SnapConfig } from '../schema/types';

/* ------------------------------------------------------------------ */
/* Codes                                                               */
/* ------------------------------------------------------------------ */

/** Axis index: x. */
export const AX = 0;
/** Axis index: y. */
export const AY = 1;

/** Candidate kind codes (compact enough for a `Uint8Array`). */
export const K_EDGE = 0;
export const K_CENTER = 1;
export const K_GAP = 2;
export const K_GRID = 3;
/** A size match: drawn as an edge guide, ranked on its own level. */
export const K_SIZE = 4;

/**
 * Reference points of the moving rect, as a bitmask. A candidate declares
 * which of them it is allowed to snap to, which is what keeps "edge" and
 * "centre" semantics honest: a sibling centre must not capture a moving edge.
 */
export const REF_START = 1;
export const REF_CENTER = 2;
export const REF_END = 4;
export const REF_ALL = REF_START | REF_CENTER | REF_END;

/**
 * Priority ladder. Higher wins; distance breaks ties. Spec §9 fixes the
 * relative order `edge > center > gap > grid`; `sizeMatch` is not ranked by
 * the spec and is slotted directly below `edge` (an explicit alignment of the
 * dragged edge to a real line beats "this happens to be as wide as that one").
 */
export const PRI_GRID = 0;
export const PRI_GAP = 1;
export const PRI_CENTER = 2;
export const PRI_SIZE = 3;
export const PRI_EDGE = 4;

/** Hard cap on materialised candidates per axis per collect (spec §9). */
export const CANDIDATE_CAP = 512;

/** Cap on sibling size candidates per axis. */
const SIZE_CAP = 512;

/** Max distinct gap widths considered by the equalGap provider. */
const MAX_GAPS = 12;

/** Max band members fed to the equalGap provider (window centred on anchor). */
const MAX_BAND = 128;

/** Gaps narrower than this are noise, not layout rhythm. */
const MIN_GAP = 1;

/** Two positions closer than this are the same line. */
export const LINE_EPS = 0.5;

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

/** `SnapConfig` with every default materialised. */
export interface ResolvedSnapConfig {
  /** Screen-px threshold, before division by canvas scale. */
  threshold: number;
  /** Grid step in px; `0` means off (the default — grids are opt-in). */
  grid: number;
  siblings: boolean;
  gaps: boolean;
  containerEdges: boolean;
}

/**
 * Materialise `SnapConfig` defaults. Returns `null` when snapping is disabled
 * (`snap={false}`), which the engine turns into a permanent zero-correction.
 */
export function resolveSnapConfig(config?: SnapConfig | false): ResolvedSnapConfig | null {
  if (config === false) return null;
  const c = config ?? {};
  const grid = typeof c.grid === 'number' && Number.isFinite(c.grid) && c.grid > 0 ? c.grid : 0;
  const threshold =
    typeof c.threshold === 'number' && Number.isFinite(c.threshold) && c.threshold >= 0
      ? c.threshold
      : 8;
  return {
    threshold,
    grid,
    siblings: c.siblings !== false,
    gaps: c.gaps !== false,
    containerEdges: c.containerEdges !== false,
  };
}

/* ------------------------------------------------------------------ */
/* Candidate set                                                       */
/* ------------------------------------------------------------------ */

/**
 * One axis' candidates, as a structure of arrays sorted ascending by `value`.
 *
 * `coverMin`/`coverMax` describe the interval within which the collection is
 * COMPLETE. When the cap truncates the collection, candidates outside that
 * interval exist but were dropped, so a moving rect that leaves the interval
 * must trigger a re-collect (spec §1.9). When nothing was truncated the
 * interval is infinite and no re-collect ever happens.
 */
export interface AxisCandidates {
  /** Number of live entries in the positional arrays. */
  count: number;
  /** Line positions, ascending. */
  value: Float64Array;
  /** Priority per candidate (see the `PRI_*` ladder). */
  pri: Uint8Array;
  /** Allowed moving-rect reference points, as a `REF_*` mask. */
  mask: Uint8Array;
  /** Guide kind per candidate (`K_*`). */
  kind: Uint8Array;
  /** Source extent along the PERPENDICULAR axis, used to size the guide. */
  from: Float64Array;
  to: Float64Array;

  /** Size-match candidates (resize only), ascending. */
  sizeCount: number;
  sizeValue: Float64Array;
  sizeFrom: Float64Array;
  sizeTo: Float64Array;

  /** True when the cap dropped candidates. */
  truncated: boolean;
  /** Anchor this collection was centred on. */
  anchor: number;
  /** Complete-coverage interval on this axis. */
  coverMin: number;
  coverMax: number;
}

/* ------------------------------------------------------------------ */
/* Axis accessors                                                      */
/* ------------------------------------------------------------------ */

/** Position of `r` along `ax`. */
export function axPos(r: Rect, ax: number): number {
  return ax === AX ? r.x : r.y;
}

/** Extent of `r` along `ax`. */
export function axSize(r: Rect, ax: number): number {
  return ax === AX ? r.w : r.h;
}

/**
 * Perpendicular overlap ratio of two intervals, normalised by the SMALLER of
 * the two extents. `a` fully inside `b` therefore scores 1, which is what the
 * "≥50% overlap" band rule wants — a short item next to a tall one is still in
 * the same visual row.
 */
export function overlapRatio(aPos: number, aSize: number, bPos: number, bSize: number): number {
  const lo = Math.max(aPos, bPos);
  const hi = Math.min(aPos + aSize, bPos + bSize);
  const over = hi - lo;
  if (over <= 0) return 0;
  const min = Math.min(aSize, bSize);
  if (min <= 0) return 0;
  return over / min;
}

/* ------------------------------------------------------------------ */
/* Collection                                                          */
/* ------------------------------------------------------------------ */

interface BandEntry {
  pos: number;
  size: number;
  from: number;
  to: number;
}

/**
 * Collect every candidate for one axis.
 *
 * @param snapshot Gesture snapshot frozen at pointerdown (never re-measured).
 * @param cfg      Resolved config (provider toggles + grid step).
 * @param ax       `AX` or `AY`.
 * @param moving   Union rect of the moving selection — supplies the
 *                 perpendicular band used by the equalGap provider.
 * @param anchor   Position the 512-cap keeps candidates nearest to (the moving
 *                 rect's start on this axis).
 */
export function collectAxis(
  snapshot: GestureSnapshot,
  cfg: ResolvedSnapConfig,
  ax: number,
  moving: Rect,
  anchor: number,
): AxisCandidates {
  const extent = ax === AX ? snapshot.width : snapshot.height;
  const perpExtent = ax === AX ? snapshot.height : snapshot.width;
  const perpPos = axPos(moving, 1 - ax);
  const perpSize = axSize(moving, 1 - ax);

  const value: number[] = [];
  const pri: number[] = [];
  const mask: number[] = [];
  const kind: number[] = [];
  const from: number[] = [];
  const to: number[] = [];

  const push = (v: number, p: number, m: number, k: number, f: number, t: number): void => {
    if (!Number.isFinite(v)) return;
    value.push(v);
    pri.push(p);
    mask.push(m);
    kind.push(k);
    from.push(f);
    to.push(t);
  };

  /* containerEdge: start, end, centre. Guides span the whole container. */
  if (cfg.containerEdges) {
    push(0, PRI_EDGE, REF_START | REF_END, K_EDGE, 0, perpExtent);
    push(extent, PRI_EDGE, REF_START | REF_END, K_EDGE, 0, perpExtent);
    push(extent / 2, PRI_CENTER, REF_CENTER, K_CENTER, 0, perpExtent);
  }

  const sizeValue: number[] = [];
  const sizeFrom: number[] = [];
  const sizeTo: number[] = [];
  const band: BandEntry[] = [];

  for (const [id, r] of snapshot.rects) {
    if (snapshot.movingIds.has(id)) continue;
    const p = axPos(r, ax);
    const s = axSize(r, ax);
    const pf = axPos(r, 1 - ax);
    const pt = pf + axSize(r, 1 - ax);

    if (cfg.siblings) {
      /* siblingEdge */
      push(p, PRI_EDGE, REF_START | REF_END, K_EDGE, pf, pt);
      push(p + s, PRI_EDGE, REF_START | REF_END, K_EDGE, pf, pt);
      /* siblingCenter */
      push(p + s / 2, PRI_CENTER, REF_CENTER, K_CENTER, pf, pt);
      /* sizeMatch (consumed only by resize queries) */
      if (s > 0 && sizeValue.length < SIZE_CAP) {
        sizeValue.push(s);
        sizeFrom.push(pf);
        sizeTo.push(pt);
      }
    }

    if (cfg.gaps && overlapRatio(perpPos, perpSize, pf, pt - pf) >= 0.5) {
      band.push({ pos: p, size: s, from: pf, to: pt });
    }
  }

  /* equalGap: duplicate the rhythm already present in the band. */
  if (cfg.gaps && band.length >= 2) {
    band.sort((a, b) => a.pos - b.pos || a.size - b.size);
    const win = windowAround(band, anchor, MAX_BAND);

    const gaps: number[] = [];
    const seen = new Set<number>();
    let maxEnd = win[0]!.pos + win[0]!.size;
    for (let i = 1; i < win.length && gaps.length < MAX_GAPS; i++) {
      const e = win[i]!;
      const g = e.pos - maxEnd;
      if (g >= MIN_GAP && g < extent) {
        const key = Math.round(g * 2);
        if (!seen.has(key)) {
          seen.add(key);
          gaps.push(g);
        }
      }
      const end = e.pos + e.size;
      if (end > maxEnd) maxEnd = end;
    }

    /*
     * For every band member and every observed gap width, the two positions
     * that reproduce that gap. The "after" case constrains the moving START
     * edge; the "before" case is expressed against the moving END edge, which
     * is exactly `neighbour.start − gap − movingSize` for the current size but
     * stays correct when the size changes mid-resize.
     */
    for (const e of win) {
      for (const g of gaps) {
        push(e.pos + e.size + g, PRI_GAP, REF_START, K_GAP, e.from, e.to);
        push(e.pos - g, PRI_GAP, REF_END, K_GAP, e.from, e.to);
      }
    }
  }

  const n = value.length;
  let order: number[];
  let truncated = false;
  if (n > CANDIDATE_CAP) {
    truncated = true;
    order = indices(n);
    /* Keep the CANDIDATE_CAP nearest to the anchor; ties resolve
     * deterministically by value then original index. */
    order.sort((a, b) => {
      const da = Math.abs(value[a]! - anchor);
      const db = Math.abs(value[b]! - anchor);
      return da - db || value[a]! - value[b]! || a - b;
    });
    order.length = CANDIDATE_CAP;
    order.sort((a, b) => value[a]! - value[b]! || a - b);
  } else {
    order = indices(n);
    order.sort((a, b) => value[a]! - value[b]! || a - b);
  }

  const count = order.length;
  const outValue = new Float64Array(count);
  const outPri = new Uint8Array(count);
  const outMask = new Uint8Array(count);
  const outKind = new Uint8Array(count);
  const outFrom = new Float64Array(count);
  const outTo = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const j = order[i]!;
    outValue[i] = value[j]!;
    outPri[i] = pri[j]!;
    outMask[i] = mask[j]!;
    outKind[i] = kind[j]!;
    outFrom[i] = from[j]!;
    outTo[i] = to[j]!;
  }

  /*
   * Complete-coverage interval. With truncation we only guarantee
   * completeness within the radius of the farthest KEPT candidate — outside
   * it, dropped candidates exist. Anchoring the interval on the anchor (not on
   * min/max of what survived) means a re-collect centred on the current rect
   * always leaves that rect strictly inside its own coverage, so a drag that
   * has run off the end of the document cannot re-collect every frame.
   */
  let coverMin = Number.NEGATIVE_INFINITY;
  let coverMax = Number.POSITIVE_INFINITY;
  if (truncated && count > 0) {
    let radius = 0;
    for (let i = 0; i < count; i++) {
      const d = Math.abs(outValue[i]! - anchor);
      if (d > radius) radius = d;
    }
    coverMin = anchor - radius;
    coverMax = anchor + radius;
  }

  /* Size candidates: sorted ascending, parallel metadata carried along. */
  const sOrder = indices(sizeValue.length);
  sOrder.sort((a, b) => sizeValue[a]! - sizeValue[b]! || a - b);
  const sizeCount = sOrder.length;
  const outSizeValue = new Float64Array(sizeCount);
  const outSizeFrom = new Float64Array(sizeCount);
  const outSizeTo = new Float64Array(sizeCount);
  for (let i = 0; i < sizeCount; i++) {
    const j = sOrder[i]!;
    outSizeValue[i] = sizeValue[j]!;
    outSizeFrom[i] = sizeFrom[j]!;
    outSizeTo[i] = sizeTo[j]!;
  }

  return {
    count,
    value: outValue,
    pri: outPri,
    mask: outMask,
    kind: outKind,
    from: outFrom,
    to: outTo,
    sizeCount,
    sizeValue: outSizeValue,
    sizeFrom: outSizeFrom,
    sizeTo: outSizeTo,
    truncated,
    anchor,
    coverMin,
    coverMax,
  };
}

/** `[0, 1, …, n−1]`. */
function indices(n: number): number[] {
  const a = new Array<number>(n);
  for (let i = 0; i < n; i++) a[i] = i;
  return a;
}

/**
 * A window of at most `max` entries of the (position-sorted) band, centred on
 * `anchor`. Bounds the cost of the O(band × gaps) equalGap expansion without
 * changing results for ordinary documents.
 */
function windowAround(band: BandEntry[], anchor: number, max: number): BandEntry[] {
  if (band.length <= max) return band;
  let lo = 0;
  let hi = band.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (band[mid]!.pos < anchor) lo = mid + 1;
    else hi = mid;
  }
  let start = lo - (max >> 1);
  if (start < 0) start = 0;
  if (start + max > band.length) start = band.length - max;
  return band.slice(start, start + max);
}

/**
 * Index of the first entry of `arr[0..count)` with `arr[i] >= target`,
 * or `count` when there is none. The array must be sorted ascending.
 */
export function lowerBound(arr: Float64Array, count: number, target: number): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Union rect of the moving ids, or `null` when the selection is empty. */
export function movingUnion(snapshot: GestureSnapshot): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;
  for (const id of snapshot.movingIds) {
    const r = snapshot.rects.get(id);
    if (!r) continue;
    found = true;
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.w > maxX) maxX = r.x + r.w;
    if (r.y + r.h > maxY) maxY = r.y + r.h;
  }
  if (!found) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
