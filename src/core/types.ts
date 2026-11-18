/**
 * The persisted dashboard document.
 *
 * A dashboard is a flat list of bricks placed freely on a canvas. Coordinates
 * are "design units": pixels at the design width (`doc.width`). Rects are
 * *tiles* — two bricks that share an edge are stored with touching rects, and
 * the gutter between them (`doc.gap`) is applied when rendering. That keeps
 * stored geometry trivially snappable while gutters stay a constant pixel size
 * at every container width.
 */

/** How a brick's horizontal geometry follows the container width. */
export type Pin =
  /** Position and width keep their share of the container (default). */
  | 'scale'
  /** Fixed width, fixed distance from the left edge. */
  | 'left'
  /** Fixed width, fixed distance from the right edge. */
  | 'right'
  /** Fixed distance from both edges; the width absorbs the change. */
  | 'stretch'
  /** Fixed width, keeps its offset from the container's centre. */
  | 'center';

export const PINS: readonly Pin[] = ['scale', 'left', 'right', 'stretch', 'center'];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardItem<P = Record<string, unknown>> extends Rect {
  /** Unique within the document. */
  id: string;
  /** Brick type; looked up in the brick registry at render time. */
  type: string;
  title?: string;
  /** Serializable configuration handed to the brick. */
  props?: P;
  pin?: Pin;
  /** Locked bricks cannot be moved, resized or removed in the editor. */
  locked?: boolean;
  minW?: number;
  minH?: number;
}

/**
 * Below `maxWidth` (container width, px) the dashboard switches to this
 * variant. Its layout is derived automatically by flowing bricks in reading
 * order into `columns` columns, unless the user arranged it by hand — then
 * the rects live in `doc.layouts[name]`.
 */
export interface Breakpoint {
  name: string;
  maxWidth: number;
  columns: number;
}

export interface DashboardDoc<P = Record<string, unknown>> {
  version: 1;
  /** Design width in px. Coordinates are expressed against it. */
  width: number;
  /** Gutter between bricks, px. */
  gap: number;
  /** Outer padding around the canvas, px. */
  padding: number;
  /** Sorted by `maxWidth`, largest first. */
  breakpoints: readonly Breakpoint[];
  /** Paint order: later items are drawn on top. */
  items: readonly DashboardItem<P>[];
  /** Hand-arranged rects per breakpoint name, in that breakpoint's units. */
  layouts: Readonly<Record<string, Readonly<Record<string, Rect>>>>;
}

/** Loose authoring shape accepted by `createDashboard`. */
export interface DashboardInput<P = Record<string, unknown>> {
  width?: number;
  gap?: number;
  padding?: number;
  breakpoints?: readonly Breakpoint[];
  items?: readonly (Partial<DashboardItem<P>> & { type: string })[];
  layouts?: Record<string, Record<string, Rect>>;
}

export const CURRENT_VERSION = 1;
export const BASE = 'base';

export const DEFAULTS = {
  width: 1200,
  gap: 16,
  padding: 0,
  minW: 64,
  minH: 48,
  itemW: 400,
  itemH: 280,
  breakpoints: [
    { name: 'md', maxWidth: 960, columns: 2 },
    { name: 'sm', maxWidth: 600, columns: 1 },
  ] as readonly Breakpoint[],
} as const;
