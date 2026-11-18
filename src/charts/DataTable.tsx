import { useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import { useSize, type Datum } from './common';
import { formatValue, type Format } from './format';

export interface Column {
  /** Field of each row. */
  key: string;
  label?: string;
  align?: 'left' | 'right' | 'center';
  format?: Format;
  /** CSS width, e.g. `120px` or `30%`. */
  width?: string;
  sortable?: boolean;
}

export interface DataTableProps {
  data: readonly Datum[];
  /** Defaults to one column per field of the first row. */
  columns?: readonly (Column | string)[];
  /** Row height in px; rows are fixed-height so the table can virtualize. Default 36. */
  rowHeight?: number;
  /** Allow sorting by clicking a header. Default true. */
  sortable?: boolean;
  lang?: string;
  /** CSS height. Omit inside a sized parent — the table fills it and scrolls. */
  height?: number | string;
  emptyText?: string;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

const OVERSCAN = 6;

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/**
 * A sortable table that renders only the rows in view. Scrolling 100k rows
 * mounts a few dozen `<tr>`s; the header stays pinned and numeric columns
 * align right in tabular figures.
 */
export function DataTable(props: DataTableProps): ReactElement {
  const { data, rowHeight = 36, sortable = true, lang } = props;
  const [ref, size] = useSize<HTMLDivElement>();
  const [scrollTop, setScrollTop] = useState(0);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const columns = useMemo<Column[]>(() => {
    const source = props.columns ?? Object.keys(data[0] ?? {});
    return source.map((c) => (typeof c === 'string' ? { key: c } : c));
  }, [props.columns, data]);

  // A column is numeric when its first present value is a number.
  const numeric = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const col of columns) {
      const sample = data.find((d) => d[col.key] !== null && d[col.key] !== undefined)?.[col.key];
      out[col.key] = typeof sample === 'number';
    }
    return out;
  }, [columns, data]);

  const rows = useMemo(() => {
    if (!sort) return data;
    return [...data].sort((a, b) => compare(a[sort.key], b[sort.key]) * sort.dir);
  }, [data, sort]);

  const viewport = size?.height ?? 400;
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewport) / rowHeight) + OVERSCAN);
  const before = first * rowHeight;
  const after = (rows.length - last) * rowHeight;

  const toggleSort = (key: string): void =>
    setSort((prev) => (prev?.key !== key ? { key, dir: 1 } : prev.dir === 1 ? { key, dir: -1 } : null));

  return (
    <div
      ref={ref}
      className={props.className ? `vbx-table-wrap ${props.className}` : 'vbx-table-wrap'}
      style={{ ...props.style, ...(props.height !== undefined ? { height: props.height } : {}) }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      tabIndex={0}
      role="group"
      aria-label={props.ariaLabel ?? 'Table'}
    >
      <table className="vbx-table" aria-rowcount={rows.length + 1}>
        <colgroup>
          {columns.map((col) => (
            <col key={col.key} style={col.width ? { width: col.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr style={{ height: rowHeight }}>
            {columns.map((col) => {
              const align = col.align ?? (numeric[col.key] ? 'right' : 'left');
              const canSort = sortable && col.sortable !== false;
              const dir = sort?.key === col.key ? sort.dir : 0;
              return (
                <th
                  key={col.key}
                  scope="col"
                  data-align={align}
                  aria-sort={dir === 1 ? 'ascending' : dir === -1 ? 'descending' : undefined}
                >
                  {canSort ? (
                    <button type="button" className="vbx-th-button" onClick={() => toggleSort(col.key)}>
                      {col.label ?? col.key}
                      <span className="vbx-sort" data-dir={dir || undefined} aria-hidden="true" />
                    </button>
                  ) : (
                    (col.label ?? col.key)
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {before > 0 ? <tr aria-hidden="true" style={{ height: before }} /> : null}
          {rows.slice(first, last).map((row, i) => (
            <tr key={first + i} style={{ height: rowHeight }} aria-rowindex={first + i + 2}>
              {columns.map((col) => (
                <td key={col.key} data-align={col.align ?? (numeric[col.key] ? 'right' : 'left')}>
                  {formatValue(row[col.key], col.format, lang)}
                </td>
              ))}
            </tr>
          ))}
          {after > 0 ? <tr aria-hidden="true" style={{ height: after }} /> : null}
        </tbody>
      </table>
      {rows.length === 0 ? <div className="vbx-chart-empty">{props.emptyText ?? 'No data'}</div> : null}
    </div>
  );
}
