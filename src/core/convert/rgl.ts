/**
 * react-grid-layout → vizbrix import.
 *
 * RGL stores grid cells; vizbrix stores expressions. The conversion is
 * therefore a *lossy widening*: cells are resolved to pixels at a chosen
 * container width using RGL's own `calcGridItemPosition` arithmetic, then
 * re-encoded as affine placements whose anchor is INFERRED from the cell's
 * relationship to the grid (spec §12):
 *
 * | condition                    | inferred x anchor |
 * |------------------------------|-------------------|
 * | `x === 0 && x + w === cols`  | `both` (full-bleed row) |
 * | `x + w === cols`             | `end` (right-docked) |
 * | `w / cols >= 0.5`            | `scale` (a major column) |
 * | otherwise                    | `start` (px) |
 *
 * The y axis is always `start`: RGL grids scroll, so the container height is
 * indefinite and vertical anchors are unresolvable (spec §1.6).
 *
 * Collision policy is NEVER inferred. RGL's `static` flag and its compaction
 * are layout *algorithms*, not intent — `static: true` maps to `locked: true`
 * and nothing maps to `collision: 'forbid'`.
 */

import type {
  AxisMode,
  AxisPlacement,
  Issue,
  ItemOverride,
  LoadOutcome,
  SizeDef,
} from '../schema/types';
import { SCHEMA_VERSION } from '../schema/types';
import { reencodeAxis } from '../geometry/reencode';
import { load } from '../schema/load';

/** A single react-grid-layout cell. Extra keys are ignored, not an error. */
export interface RGLLayoutItem {
  /** RGL's id field. `id` is accepted as an alias. */
  i?: string;
  id?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
  static?: boolean;
  isDraggable?: boolean;
  isResizable?: boolean;
}

/** `{ lg: [...], md: [...] }` — RGL's ResponsiveGridLayout `layouts` prop. */
export type RGLResponsiveLayouts = Record<string, RGLLayoutItem[]>;

export interface RGLImportOptions {
  /**
   * Grid columns. A number applies to every breakpoint; the record form
   * mirrors RGL's per-breakpoint `cols` prop.
   */
  cols: number | Record<string, number>;
  /** Row height in px (RGL's `rowHeight`). */
  rowHeight: number;
  /** `[horizontal, vertical]` gap in px. Default `[10, 10]`, as in RGL. */
  margin?: [number, number];
  /**
   * Width the single-layout form is resolved at, and the base design width of
   * the produced document. Default: RGL's `lg` breakpoint (1200).
   */
  containerWidth?: number;
  /**
   * RGL `breakpoints` (min-width thresholds). Only used for the responsive
   * form. Default: RGL's own defaults.
   */
  breakpoints?: Record<string, number>;
  /** Container padding in px. RGL defaults it to `margin`. */
  containerPadding?: [number, number];
}

/** RGL's default `breakpoints` prop. */
export const RGL_DEFAULT_BREAKPOINTS: Record<string, number> = {
  lg: 1200,
  md: 996,
  sm: 768,
  xs: 480,
  xxs: 0,
};

/** RGL's default `cols` prop. */
export const RGL_DEFAULT_COLS: Record<string, number> = {
  lg: 12,
  md: 10,
  sm: 6,
  xs: 4,
  xxs: 2,
};

const DEFAULT_MARGIN: [number, number] = [10, 10];

/**
 * Converts an RGL layout (or a responsive `layouts` object) into a loaded
 * vizbrix document. Never throws — malformed input comes back as
 * `{ status: 'invalid' }` like any other `load()` failure.
 *
 * ### Breakpoint mapping
 *
 * RGL breakpoints are MIN-widths and desktop-last; vizbrix sizes are
 * MAX-widths and desktop-first. The largest RGL breakpoint becomes the
 * document BASE (no size entry); every smaller breakpoint `k` becomes a
 * declared size whose `maxWidth` is the min-width of the next LARGER
 * breakpoint. With RGL's defaults that is:
 *
 * ```
 * lg (min 1200) → base
 * md (min  996) → sizes.md = { maxWidth: 1200 }
 * sm (min  768) → sizes.sm = { maxWidth:  996 }
 * xs (min  480) → sizes.xs = { maxWidth:  768 }
 * xxs(min    0) → sizes.xxs = { maxWidth: 480 }
 * ```
 *
 * The two selection rules then agree exactly: at width W, RGL picks the
 * largest breakpoint with `W > minWidth`, and vizbrix's descending max-width
 * cascade lands on the same name. Each size's cells are resolved at that
 * size's `maxWidth`, i.e. the widest container the override is active in.
 *
 * Overrides identical to the base placement are omitted.
 */
export function importFromRGL(
  layouts: RGLLayoutItem[] | RGLResponsiveLayouts,
  opts: RGLImportOptions,
): LoadOutcome<undefined> {
  try {
    const issues: Issue[] = [];
    const margin = normalizeMargin(opts.margin) ?? DEFAULT_MARGIN;
    const padding = normalizeMargin(opts.containerPadding) ?? margin;
    const rowHeight = finite(opts.rowHeight) && opts.rowHeight > 0 ? opts.rowHeight : 30;
    if (!finite(opts.rowHeight) || opts.rowHeight <= 0) {
      issues.push(warn('', 'rowHeight must be a positive number; defaulted to 30'));
    }

    if (Array.isArray(layouts)) {
      const width = finite(opts.containerWidth) && opts.containerWidth > 0
        ? opts.containerWidth
        : RGL_DEFAULT_BREAKPOINTS.lg!;
      const cols = colsFor(opts.cols, 'lg', issues);
      const doc = buildDoc(
        convertLayout(layouts, { cols, rowHeight, margin, padding, width }, 'layouts', issues),
        width,
        {},
        issues,
      );
      return finish(doc, issues);
    }

    if (layouts === null || typeof layouts !== 'object') {
      return {
        status: 'invalid',
        errors: [err('', 'expected an RGL layout array or a { breakpoint: layout[] } object')],
      };
    }

    return importResponsive(layouts, opts, { margin, padding, rowHeight }, issues);
  } catch (e) {
    return {
      status: 'invalid',
      errors: [err('', `RGL import failed: ${e instanceof Error ? e.message : String(e)}`)],
    };
  }
}

/* ------------------------------------------------------------------ */
/* responsive form                                                     */
/* ------------------------------------------------------------------ */

interface Geometry {
  margin: [number, number];
  padding: [number, number];
  rowHeight: number;
}

function importResponsive(
  layouts: RGLResponsiveLayouts,
  opts: RGLImportOptions,
  geo: Geometry,
  issues: Issue[],
): LoadOutcome<undefined> {
  const breakpoints = opts.breakpoints ?? RGL_DEFAULT_BREAKPOINTS;
  const names = Object.keys(layouts).filter((name) => Array.isArray(layouts[name]));
  if (names.length === 0) {
    return { status: 'invalid', errors: [err('', 'no breakpoint held a layout array')] };
  }

  for (const name of Object.keys(layouts)) {
    if (!names.includes(name)) {
      issues.push(warn(name, 'not an array; the breakpoint was skipped'));
    }
    if (breakpoints[name] === undefined) {
      issues.push(
        warn(name, `no breakpoint width is declared for "${name}"; it was treated as min-width 0`),
      );
    }
  }

  // Descending by RGL min-width: largest first, which becomes the base.
  const ordered = [...names].sort(
    (a, b) => (breakpoints[b] ?? 0) - (breakpoints[a] ?? 0) || (a < b ? -1 : a > b ? 1 : 0),
  );

  const baseName = ordered[0]!;
  const baseWidth =
    finite(opts.containerWidth) && opts.containerWidth > 0
      ? opts.containerWidth
      : Math.max(1, breakpoints[baseName] ?? RGL_DEFAULT_BREAKPOINTS.lg!);

  const baseItems = convertLayout(
    layouts[baseName]!,
    {
      cols: colsFor(opts.cols, baseName, issues),
      rowHeight: geo.rowHeight,
      margin: geo.margin,
      padding: geo.padding,
      width: baseWidth,
    },
    baseName,
    issues,
  );

  const sizes: Record<string, SizeDef> = {};
  const overrides = new Map<string, Record<string, ItemOverride>>();
  const extras: ConvertedItem[] = [];

  for (let i = 1; i < ordered.length; i++) {
    const name = ordered[i]!;
    // The size is active up to the min-width of the next LARGER breakpoint.
    const maxWidth = Math.max(1, breakpoints[ordered[i - 1]!] ?? baseWidth);
    sizes[name] = { maxWidth };

    const converted = convertLayout(
      layouts[name]!,
      {
        cols: colsFor(opts.cols, name, issues),
        rowHeight: geo.rowHeight,
        margin: geo.margin,
        padding: geo.padding,
        width: maxWidth,
      },
      name,
      issues,
    );

    for (const item of converted) {
      const base = baseItems.find((b) => b.id === item.id);
      if (!base) {
        issues.push(
          warn(`${name}.${item.id}`, `only present at "${name}"; promoted into the base layout`),
        );
        extras.push(item);
        continue;
      }
      if (samePlacement(base.x, item.x) && samePlacement(base.y, item.y)) continue;
      let bucket = overrides.get(item.id);
      if (!bucket) {
        bucket = {};
        overrides.set(item.id, bucket);
      }
      bucket[name] = { x: item.x, y: item.y };
    }
  }

  const all = [...baseItems, ...extras];
  for (const item of all) {
    const bucket = overrides.get(item.id);
    if (bucket && Object.keys(bucket).length > 0) item.at = bucket;
  }

  const doc = buildDoc(all, baseWidth, sizes, issues);
  return finish(doc, issues);
}

/* ------------------------------------------------------------------ */
/* cell → placement                                                    */
/* ------------------------------------------------------------------ */

interface ConvertedItem {
  id: string;
  x: AxisPlacement;
  y: AxisPlacement;
  /** Reading order key material: RGL's visual order is (row, column). */
  row: number;
  col: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  locked?: boolean;
  at?: Record<string, ItemOverride>;
}

interface GridSpec {
  cols: number;
  rowHeight: number;
  margin: [number, number];
  padding: [number, number];
  width: number;
}

function convertLayout(
  layout: readonly RGLLayoutItem[],
  grid: GridSpec,
  label: string,
  issues: Issue[],
): ConvertedItem[] {
  const out: ConvertedItem[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < layout.length; i++) {
    const cell: unknown = layout[i];
    const path = `${label}[${i}]`;
    if (cell === null || typeof cell !== 'object') {
      issues.push(warn(path, 'not a grid item object; skipped'));
      continue;
    }
    const c = cell as RGLLayoutItem;
    let id = typeof c.i === 'string' && c.i !== '' ? c.i : typeof c.id === 'string' ? c.id : '';
    if (id === '') {
      id = `rgl-${i}`;
      issues.push(warn(`${path}.i`, `missing grid item key; generated "${id}"`));
    }
    if (seen.has(id)) {
      issues.push(warn(`${path}.i`, `duplicate grid item key "${id}"; the later cell was skipped`));
      continue;
    }
    seen.add(id);

    const gx = clampInt(c.x, 0);
    const gy = clampInt(c.y, 0);
    const gw = Math.max(1, clampInt(c.w, 1));
    const gh = Math.max(1, clampInt(c.h, 1));

    const left = colToPx(gx, grid, false);
    const width = colToPx(gw, grid, true);
    const top = rowToPx(gy, grid, false);
    const height = rowToPx(gh, grid, true);

    const xMode = inferAnchor(gx, gw, grid.cols);
    const item: ConvertedItem = {
      id,
      x: reencodeAxis(left, width, grid.width, xMode),
      // Vertical anchors are unresolvable in a scrolling grid (spec §1.6).
      y: reencodeAxis(top, height, 0, 'start'),
      row: gy,
      col: gx,
    };

    const minW = spanToPx(c.minW, grid, true);
    if (minW !== undefined) item.minW = minW;
    const maxW = spanToPx(c.maxW, grid, true);
    if (maxW !== undefined) item.maxW = maxW;
    const minH = spanToPx(c.minH, grid, false);
    if (minH !== undefined) item.minH = minH;
    const maxH = spanToPx(c.maxH, grid, false);
    if (maxH !== undefined) item.maxH = maxH;

    // `static` is an RGL layout-algorithm flag; the closest honest mapping is
    // "the user cannot move it". Collision policy stays at the default.
    if (c.static === true || c.isDraggable === false) item.locked = true;

    out.push(item);
  }

  return out;
}

/**
 * The anchor inference table from spec §12. Order matters: full-bleed beats
 * right-docked beats proportional.
 */
export function inferAnchor(x: number, w: number, cols: number): AxisMode {
  if (cols <= 0) return 'start';
  if (x === 0 && x + w === cols) return 'both';
  if (x + w === cols) return 'end';
  if (w / cols >= 0.5) return 'scale';
  return 'start';
}

/* RGL's calcGridItemPosition arithmetic (react-grid-layout/lib/calculateUtils). */

function colWidth(grid: GridSpec): number {
  const [mx] = grid.margin;
  return (grid.width - mx * (grid.cols - 1) - grid.padding[0] * 2) / grid.cols;
}

function colToPx(span: number, grid: GridSpec, isSize: boolean): number {
  const cw = colWidth(grid);
  const [mx] = grid.margin;
  return isSize
    ? Math.round(cw * span + Math.max(0, span - 1) * mx)
    : Math.round((cw + mx) * span + grid.padding[0]);
}

function rowToPx(span: number, grid: GridSpec, isSize: boolean): number {
  const [, my] = grid.margin;
  return isSize
    ? Math.round(grid.rowHeight * span + Math.max(0, span - 1) * my)
    : Math.round((grid.rowHeight + my) * span + grid.padding[1]);
}

function spanToPx(span: unknown, grid: GridSpec, horizontal: boolean): number | undefined {
  if (!finite(span) || span <= 0) return undefined;
  return horizontal ? colToPx(span, grid, true) : rowToPx(span, grid, true);
}

/* ------------------------------------------------------------------ */
/* document assembly                                                   */
/* ------------------------------------------------------------------ */

function buildDoc(
  items: ConvertedItem[],
  baseWidth: number,
  sizes: Record<string, SizeDef>,
  issues: Issue[],
): Record<string, unknown> {
  // RGL has no z: derive a deterministic stacking/reading order from the
  // visual order of the grid (row, then column, then key).
  const sorted = [...items].sort(
    (a, b) => a.row - b.row || a.col - b.col || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  if (sorted.length !== items.length) issues.push(warn('', 'item count changed while ordering'));

  const container: Record<string, unknown> = {
    base: { width: baseWidth },
    // RGL grids grow downward inside a scrolling page.
    height: 'auto',
  };
  if (Object.keys(sizes).length > 0) container.sizes = sizes;

  return {
    version: SCHEMA_VERSION,
    container,
    // `z` is intentionally left unset: normalize() spreads evenly-spaced
    // fractional keys across the list in this order.
    items: sorted.map((item) => {
      const out: Record<string, unknown> = { id: item.id, x: item.x, y: item.y };
      for (const key of ['minW', 'minH', 'maxW', 'maxH'] as const) {
        if (item[key] !== undefined) out[key] = item[key];
      }
      if (item.locked) out.locked = true;
      if (item.at) out.at = item.at;
      return out;
    }),
  };
}

function finish(doc: Record<string, unknown>, issues: Issue[]): LoadOutcome<undefined> {
  const outcome = load<undefined>(doc);
  if (outcome.status === 'ok') {
    return { status: 'ok', doc: outcome.doc, issues: [...issues, ...outcome.issues] };
  }
  if (outcome.status === 'invalid') {
    return { status: 'invalid', errors: [...issues.filter(isError), ...outcome.errors] };
  }
  return outcome;
}

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function colsFor(
  cols: number | Record<string, number> | undefined,
  name: string,
  issues: Issue[],
): number {
  if (finite(cols) && cols > 0) return Math.floor(cols);
  if (cols !== null && typeof cols === 'object') {
    const v = cols[name];
    if (finite(v) && v > 0) return Math.floor(v);
    const fallback = RGL_DEFAULT_COLS[name];
    if (fallback !== undefined) {
      issues.push(warn(name, `no column count given; used RGL's default of ${fallback}`));
      return fallback;
    }
  }
  issues.push(warn(name, "cols must be a positive number; used RGL's default of 12"));
  return 12;
}

function normalizeMargin(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const [a, b] = value as unknown[];
  if (!finite(a) || !finite(b) || a < 0 || b < 0) return undefined;
  return [a, b];
}

/** Structural comparison — placements are flat records of `Len`s. */
function samePlacement(a: AxisPlacement, b: AxisPlacement): boolean {
  if (a.mode !== b.mode) return false;
  const ar = a as unknown as Record<string, unknown>;
  const br = b as unknown as Record<string, unknown>;
  for (const key of ['offset', 'size', 'start', 'end']) {
    if (!sameLen(ar[key], br[key])) return false;
  }
  return true;
}

function sameLen(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ao = a as { pct?: number; px?: number };
  const bo = b as { pct?: number; px?: number };
  return ao.pct === bo.pct && ao.px === bo.px;
}

function clampInt(value: unknown, fallback: number): number {
  return finite(value) ? Math.round(value) : fallback;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isError(issue: Issue): boolean {
  return issue.severity === 'error';
}

function warn(path: string, message: string): Issue {
  return { severity: 'warn', path, message };
}

function err(path: string, message: string): Issue {
  return { severity: 'error', path, message };
}
