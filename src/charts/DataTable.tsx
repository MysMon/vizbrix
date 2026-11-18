import { useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { toNumber, useSize, type Datum } from './common';
import { formatValue, formatter, type Format } from './format';

export type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'accent' | 'neutral';

export interface Column {
  /** Field of each row. */
  key: string;
  label?: string;
  align?: 'left' | 'right' | 'center';
  format?: Format;
  /** CSS width, e.g. `120px` or `30%`. The user can still drag to resize. */
  width?: string;
  sortable?: boolean;
  /**
   * How to present the cell:
   * - `badge`: a pill with a status dot, toned per value through `tones`
   * - `link`: an anchor built from `href`
   * - `progress`: a thin bar against `max` (default 1) beside the value
   */
  kind?: 'text' | 'badge' | 'link' | 'progress';
  /** For `badge`: tone per cell value. Unlisted values are neutral. */
  tones?: Readonly<Record<string, Tone>>;
  /** For `link`: URL template; `{field}` is replaced with the row's (URL-encoded) value. */
  href?: string;
  /** For `progress`: the value that fills the bar. */
  max?: number;
  /** Full control over the cell. Not serializable — for tables defined in code. */
  render?: (value: unknown, row: Datum) => ReactNode;
}

export interface DataTableProps {
  data: readonly Datum[];
  /** Defaults to one column per field of the first row. */
  columns?: readonly (Column | string)[];
  /** Row height in px; rows are fixed-height so the table can virtualize. Default 36. */
  rowHeight?: number;
  /** Allow sorting by clicking a header. Default true. */
  sortable?: boolean;
  /** Show a search box that filters rows across all columns. */
  searchable?: boolean;
  searchLabel?: string;
  /** Let the user drag column edges to resize. Default true. */
  resizable?: boolean;
  /** Called when a row is clicked or activated with Enter; `index` is its position in `data`. */
  onRowClick?: (row: Datum, index: number) => void;
  lang?: string;
  /** CSS height. Omit inside a sized parent — the table fills it and scrolls. */
  height?: number | string;
  emptyText?: string;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

const OVERSCAN = 6;
const MIN_COLUMN = 48;

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** Build a link target from a template, refusing anything that is not a plain web or mail URL. */
export function buildHref(template: string, row: Datum): string | undefined {
  const url = template.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(String(row[key] ?? '')));
  return /^(https?:\/\/|mailto:|\/|\.{0,2}\/|#|\?)/i.test(url) || /^[\w-]+(\/|$)/.test(url) ? url : undefined;
}

function Cell(props: { column: Column; row: Datum; lang?: string }): ReactElement {
  const { column, row, lang } = props;
  const value = row[column.key];
  if (column.render) return <>{column.render(value, row)}</>;
  const text = formatValue(value, column.format, lang);
  if (value === null || value === undefined || value === '') return <>{text}</>;
  if (column.kind === 'badge') {
    return (
      <span className="vbx-badge" data-tone={column.tones?.[String(value)] ?? 'neutral'}>
        <i aria-hidden="true" />
        {text}
      </span>
    );
  }
  if (column.kind === 'link' && column.href) {
    const href = buildHref(column.href, row);
    return href ? (
      <a className="vbx-cell-link" href={href} onClick={(e) => e.stopPropagation()}>
        {text}
      </a>
    ) : (
      <>{text}</>
    );
  }
  if (column.kind === 'progress') {
    const n = toNumber(value) ?? 0;
    const max = column.max ?? 1;
    const label = formatter(column.format ?? (max === 1 ? 'percent' : 'auto'), lang, n)(n);
    return (
      <span className="vbx-cell-progress">
        <span className="vbx-cell-track" aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(1, max ? n / max : 0)) * 100}%` }} />
        </span>
        {label}
      </span>
    );
  }
  return <>{text}</>;
}

/**
 * A sortable, searchable table that renders only the rows in view. Scrolling
 * 100k rows mounts a few dozen `<tr>`s; the header stays pinned, columns can
 * be resized by dragging, and numeric columns align right in tabular figures.
 */
export function DataTable(props: DataTableProps): ReactElement {
  const { data, rowHeight = 36, sortable = true, resizable = true, lang, onRowClick } = props;
  const [ref, size] = useSize<HTMLDivElement>();
  const [scrollTop, setScrollTop] = useState(0);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [query, setQuery] = useState('');
  const [widths, setWidths] = useState<Record<string, number> | null>(null);
  const head = useRef<HTMLTableRowElement>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

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
    let list = data.map((row, index) => ({ row, index }));
    const needle = query.trim().toLowerCase();
    if (needle) {
      list = list.filter(({ row }) =>
        columns.some((col) => formatValue(row[col.key], col.format, lang).toLowerCase().includes(needle)),
      );
    }
    if (sort) list.sort((a, b) => compare(a.row[sort.key], b.row[sort.key]) * sort.dir);
    return list;
  }, [data, sort, query, columns, lang]);

  const viewport = size?.height ?? 400;
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewport) / rowHeight) + OVERSCAN);
  const before = first * rowHeight;
  const after = (rows.length - last) * rowHeight;

  const toggleSort = (key: string): void =>
    setSort((prev) => (prev?.key !== key ? { key, dir: 1 } : prev.dir === 1 ? { key, dir: -1 } : null));

  const startResize = (event: React.PointerEvent<HTMLSpanElement>, key: string): void => {
    event.preventDefault();
    event.stopPropagation();
    // Freeze every column at its rendered width, then let the dragged one follow the pointer.
    const measured: Record<string, number> = {};
    const cells = head.current?.children ?? [];
    columns.forEach((col, i) => {
      measured[col.key] = widths?.[col.key] ?? (cells[i] as HTMLElement | undefined)?.offsetWidth ?? 120;
    });
    const startX = event.clientX;
    const startW = measured[key]!;
    const handle = event.currentTarget;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // synthetic pointer
    }
    const onMove = (e: PointerEvent): void => {
      setWidths({ ...measured, [key]: Math.max(MIN_COLUMN, startW + e.clientX - startX) });
    };
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
    setWidths(measured);
  };

  const total = widths ? columns.reduce((sum, col) => sum + (widths[col.key] ?? 120), 0) : 0;

  return (
    <div
      className={props.className ? `vbx-table-box ${props.className}` : 'vbx-table-box'}
      style={{ ...props.style, ...(props.height !== undefined ? { height: props.height } : {}) }}
    >
      {props.searchable ? (
        <div className="vbx-table-search">
          <input
            className="vbx-input"
            type="search"
            value={query}
            placeholder={props.searchLabel ?? 'Search'}
            aria-label={props.searchLabel ?? 'Search'}
            onChange={(e) => {
              setQuery(e.target.value);
              setScrollTop(0);
              if (scroller.current) scroller.current.scrollTop = 0;
            }}
          />
          {query ? <span className="vbx-table-count">{rows.length.toLocaleString(lang)}</span> : null}
        </div>
      ) : null}
      <div
        ref={(node) => {
          scroller.current = node;
          ref(node);
        }}
        className="vbx-table-wrap"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        tabIndex={0}
        role="group"
        aria-label={props.ariaLabel ?? 'Table'}
      >
        <table
          className="vbx-table"
          aria-rowcount={rows.length + 1}
          style={widths ? { tableLayout: 'fixed', width: `max(100%, ${total}px)` } : undefined}
        >
          <colgroup>
            {columns.map((col) => (
              <col key={col.key} style={widths ? { width: widths[col.key] } : col.width ? { width: col.width } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ height: rowHeight }} ref={head}>
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
                    {resizable ? (
                      <span className="vbx-col-resize" aria-hidden="true" onPointerDown={(e) => startResize(e, col.key)} />
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {before > 0 ? <tr aria-hidden="true" style={{ height: before }} /> : null}
            {rows.slice(first, last).map(({ row, index }, i) => (
              <tr
                key={index}
                style={{ height: rowHeight }}
                aria-rowindex={first + i + 2}
                data-clickable={onRowClick ? '' : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row, index) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter') onRowClick(row, index);
                      }
                    : undefined
                }
              >
                {columns.map((col) => (
                  <td key={col.key} data-align={col.align ?? (numeric[col.key] ? 'right' : 'left')}>
                    <Cell column={col} row={row} lang={lang} />
                  </td>
                ))}
              </tr>
            ))}
            {after > 0 ? <tr aria-hidden="true" style={{ height: after }} /> : null}
          </tbody>
        </table>
        {rows.length === 0 ? <div className="vbx-chart-empty">{props.emptyText ?? 'No data'}</div> : null}
      </div>
    </div>
  );
}
