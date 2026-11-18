import { createDashboard } from './doc';
import type { DashboardDoc, DashboardItem } from './types';

/** One cell-based layout entry, as produced by column-grid dashboard libraries. */
export interface GridCell {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  static?: boolean;
}

export interface GridImportOptions {
  /** Number of columns in the source grid. Default 12. */
  cols?: number;
  /** Row height of the source grid in px. Default 30. */
  rowHeight?: number;
  /** Gutter of the source grid in px. Default 10. */
  margin?: number;
  /** Design width of the resulting dashboard. Default 1200. */
  width?: number;
  /** Brick type for a cell. Default `'custom'`. */
  type?: (cell: GridCell) => string;
  /** Extra fields (title, props…) for a cell. */
  item?: (cell: GridCell) => Partial<DashboardItem>;
}

/**
 * Convert a column-grid layout (`{ i, x, y, w, h }` in cells) into a vizbrix
 * document. One-way by design: after the import the bricks are free tiles and
 * the grid is just one of the things they can snap to.
 */
export function importFromGrid(cells: readonly GridCell[], options: GridImportOptions = {}): DashboardDoc {
  const cols = options.cols ?? 12;
  const rowHeight = options.rowHeight ?? 30;
  const margin = options.margin ?? 10;
  const width = options.width ?? 1200;
  const colW = width / cols;
  const rowH = rowHeight + margin;
  return createDashboard({
    width,
    gap: margin,
    items: cells.map((cell) => ({
      id: cell.i,
      type: options.type?.(cell) ?? 'custom',
      x: Math.round(cell.x * colW),
      y: Math.round(cell.y * rowH),
      w: Math.round(cell.w * colW),
      h: Math.round(cell.h * rowH),
      ...(cell.minW ? { minW: Math.round(cell.minW * colW) } : {}),
      ...(cell.minH ? { minH: Math.round(cell.minH * rowH) } : {}),
      ...(cell.static ? { locked: true } : {}),
      ...options.item?.(cell),
    })),
  });
}
