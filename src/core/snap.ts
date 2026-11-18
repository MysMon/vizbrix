import type { Rect } from './types';

/**
 * Snapping is an interaction aid, never part of the stored model: it only
 * decides where a gesture lands. Bricks snap to each other's edges and
 * centres and to the canvas edges first; where nothing is near, the moving
 * edge falls back to an optional grid.
 */

export interface SnapOptions {
  /** Grid pitch in design units; 0 disables the grid. */
  grid: number;
  /** Snap to sibling edges/centres and canvas edges. */
  items: boolean;
  /** Capture distance in screen px. */
  threshold: number;
}

export const DEFAULT_SNAP: SnapOptions = { grid: 8, items: true, threshold: 6 };

export interface Guide {
  axis: 'x' | 'y';
  /** Position of the line on its axis, design units. */
  pos: number;
  /** Extent along the other axis. */
  from: number;
  to: number;
}

/** Which edges of the rect the gesture is moving. */
export interface Edges {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

export const MOVE: Edges = { left: true, right: true, top: true, bottom: true };

export interface SnapRequest {
  rect: Rect;
  /** `MOVE` for a drag; the dragged edges for a resize. */
  edges: Edges;
  /** True when the whole rect translates (size is preserved). */
  move: boolean;
  targets: readonly Rect[];
  /** Canvas width in design units. */
  width: number;
  options: SnapOptions;
  /** Capture distance per axis, in design units at the current scale. */
  toleranceX: number;
  toleranceY: number;
}

interface Line {
  pos: number;
  from: number;
  to: number;
}

interface Hit {
  delta: number;
  line: Line;
}

function best(probes: readonly number[], lines: readonly Line[], tolerance: number): Hit | null {
  let hit: Hit | null = null;
  for (const probe of probes) {
    for (const line of lines) {
      const delta = line.pos - probe;
      if (Math.abs(delta) <= tolerance && (!hit || Math.abs(delta) < Math.abs(hit.delta))) hit = { delta, line };
    }
  }
  return hit;
}

const toGrid = (value: number, grid: number): number => Math.round(value / grid) * grid;

export function snapRect(req: SnapRequest): { rect: Rect; guides: Guide[] } {
  const { edges, move, targets, options, toleranceX, toleranceY, width } = req;
  const rect = { ...req.rect };
  const guides: Guide[] = [];

  const xLines: Line[] = [];
  const yLines: Line[] = [];
  if (options.items) {
    for (const t of targets) {
      xLines.push({ pos: t.x, from: t.y, to: t.y + t.h }, { pos: t.x + t.w, from: t.y, to: t.y + t.h });
      yLines.push({ pos: t.y, from: t.x, to: t.x + t.w }, { pos: t.y + t.h, from: t.x, to: t.x + t.w });
      if (move) {
        xLines.push({ pos: t.x + t.w / 2, from: t.y, to: t.y + t.h });
        yLines.push({ pos: t.y + t.h / 2, from: t.x, to: t.x + t.w });
      }
    }
    // Canvas lines come last: on a tie, aligning with a sibling wins, because
    // its guide shows the user what they lined up with.
    xLines.push({ pos: 0, from: NaN, to: NaN }, { pos: width, from: NaN, to: NaN });
    if (move) xLines.push({ pos: width / 2, from: NaN, to: NaN });
    yLines.push({ pos: 0, from: NaN, to: NaN });
  }

  // Horizontal
  const xProbes = move
    ? [rect.x, rect.x + rect.w, rect.x + rect.w / 2]
    : [...(edges.left ? [rect.x] : []), ...(edges.right ? [rect.x + rect.w] : [])];
  const xHit = best(xProbes, xLines, toleranceX);
  if (xHit) {
    if (move) rect.x += xHit.delta;
    else if (edges.left) {
      rect.x += xHit.delta;
      rect.w -= xHit.delta;
    } else rect.w += xHit.delta;
  } else if (options.grid > 0) {
    if (move) rect.x = toGrid(rect.x, options.grid);
    else if (edges.left) {
      const x = toGrid(rect.x, options.grid);
      rect.w += rect.x - x;
      rect.x = x;
    } else if (edges.right) rect.w = toGrid(rect.x + rect.w, options.grid) - rect.x;
  }

  // Vertical
  const yProbes = move
    ? [rect.y, rect.y + rect.h, rect.y + rect.h / 2]
    : [...(edges.top ? [rect.y] : []), ...(edges.bottom ? [rect.y + rect.h] : [])];
  const yHit = best(yProbes, yLines, toleranceY);
  if (yHit) {
    if (move) rect.y += yHit.delta;
    else if (edges.top) {
      rect.y += yHit.delta;
      rect.h -= yHit.delta;
    } else rect.h += yHit.delta;
  } else if (options.grid > 0) {
    if (move) rect.y = toGrid(rect.y, options.grid);
    else if (edges.top) {
      const y = toGrid(rect.y, options.grid);
      rect.h += rect.y - y;
      rect.y = y;
    } else if (edges.bottom) rect.h = toGrid(rect.y + rect.h, options.grid) - rect.y;
  }

  // Guides span the snapped rect plus whatever it aligned with.
  if (xHit) {
    const { line } = xHit;
    const from = Number.isNaN(line.from) ? rect.y : Math.min(line.from, rect.y);
    const to = Number.isNaN(line.to) ? rect.y + rect.h : Math.max(line.to, rect.y + rect.h);
    guides.push({ axis: 'x', pos: line.pos, from, to });
  }
  if (yHit) {
    const { line } = yHit;
    const from = Number.isNaN(line.from) ? rect.x : Math.min(line.from, rect.x);
    const to = Number.isNaN(line.to) ? rect.x + rect.w : Math.max(line.to, rect.x + rect.w);
    guides.push({ axis: 'y', pos: line.pos, from, to });
  }
  return { rect, guides };
}
