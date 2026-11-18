import {
  useCallback,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';

export type Datum = Readonly<Record<string, unknown>>;

export interface SeriesSpec {
  /** Field of each datum holding this series' value. */
  key: string;
  /** Display name; defaults to the key. */
  label?: string;
  /** CSS colour. Defaults to the palette slot for the series' position. */
  color?: string;
}

export interface ResolvedSeries {
  key: string;
  label: string;
  color: string;
  index: number;
}

/**
 * Colour follows the series' position in the *declared* list, never its
 * position among the currently visible ones — hiding a series must not
 * repaint the survivors. Past eight, series share the neutral "other" colour
 * rather than receiving a generated hue nobody can tell apart.
 */
export function resolveSeries(series: readonly (SeriesSpec | string)[]): ResolvedSeries[] {
  return series.map((entry, index) => {
    const spec = typeof entry === 'string' ? { key: entry } : entry;
    return {
      key: spec.key,
      label: spec.label ?? spec.key,
      color: spec.color ?? seriesColor(index),
      index,
    };
  });
}

export function seriesColor(index: number): string {
  return index < 8 ? `var(--vbx-series-${index + 1})` : 'var(--vbx-series-other)';
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface Size {
  width: number;
  height: number;
}

/** Track an element's content box. Null until the first measurement. */
export function useSize<T extends HTMLElement>(): [(node: T | null) => void, Size | null] {
  const [size, setSize] = useState<Size | null>(null);
  const [node, setNode] = useState<T | null>(null);
  const ref = useCallback((el: T | null) => setNode(el), []);

  useIsoLayoutEffect(() => {
    if (!node) return;
    const apply = (width: number, height: number): void => {
      const w = Math.round(width);
      const h = Math.round(height);
      setSize((prev) => (prev && prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    apply(node.clientWidth, node.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]!.contentRect;
      apply(box.width, box.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return [ref, size];
}

export interface LegendProps {
  series: readonly ResolvedSeries[];
  hidden: ReadonlySet<string>;
  onToggle: (key: string) => void;
  /** Swatch shape mirrors the mark: a stroke for lines, a block for bars and areas. */
  shape: 'line' | 'block';
  /** Series that are lines in a chart whose default mark is a block (combo charts). */
  lineKeys?: ReadonlySet<string>;
}

export function Legend({ series, hidden, onToggle, shape, lineKeys }: LegendProps): ReactElement {
  return (
    <div className="vbx-legend">
      {series.map((s) => (
        <button
          key={s.key}
          type="button"
          className="vbx-legend-item"
          aria-pressed={!hidden.has(s.key)}
          data-off={hidden.has(s.key) ? '' : undefined}
          onClick={() => onToggle(s.key)}
        >
          <span className="vbx-swatch" data-shape={lineKeys?.has(s.key) ? 'line' : shape} style={{ background: s.color }} />
          {s.label}
        </button>
      ))}
    </div>
  );
}

/** Series visibility state; refuses to hide the last visible series. */
export function useHidden(series: readonly ResolvedSeries[]): [ReadonlySet<string>, (key: string) => void] {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const count = series.length;
  const toggle = useCallback(
    (key: string) => {
      setHidden((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else if (next.size < count - 1) next.add(key);
        return next;
      });
    },
    [count],
  );
  return [hidden, toggle];
}

export interface TooltipRow {
  key: string;
  label: string;
  value: string;
  color: string;
}

export interface TooltipProps {
  title: string;
  rows: readonly TooltipRow[];
  /** Anchor in plot px. */
  x: number;
  y: number;
  /** Plot width, used to flip the tooltip to the side with room. */
  bounds: number;
  /** Distance kept between the anchor and the tooltip. Default 12. */
  offset?: number;
}

/** One readout listing every series at the hovered position; values lead, names follow. */
export function Tooltip({ title, rows, x, y, bounds, offset = 12 }: TooltipProps): ReactElement {
  const flip = x > bounds / 2;
  const style: CSSProperties = {
    top: y,
    ...(flip ? { right: bounds - x + offset } : { left: x + offset }),
  };
  return (
    <div className="vbx-tooltip" role="status" style={style}>
      <div className="vbx-tooltip-title">{title}</div>
      {rows.map((row) => (
        <div className="vbx-tooltip-row" key={row.key}>
          <span className="vbx-swatch" data-shape="line" style={{ background: row.color }} />
          <span className="vbx-tooltip-label">{row.label}</span>
          <span className="vbx-tooltip-value">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export interface ChartFrameProps {
  className?: string;
  style?: CSSProperties;
  height?: number | string;
  legend?: ReactNode;
  /** Rendered when there is nothing to plot. */
  empty?: boolean;
  emptyText?: string;
  /** Builds the accessible table twin of the chart. */
  table?: () => { columns: string[]; rows: string[][] };
  tableLabel?: string;
  children: (size: Size) => ReactNode;
}

/**
 * Shared chart container: legend, a measured plot area and the table view.
 * The plot fills whatever height it is given; in a normal document flow pass
 * `height`, inside a brick it stretches to the brick body.
 */
export function ChartFrame(props: ChartFrameProps): ReactElement {
  const [ref, size] = useSize<HTMLDivElement>();
  const [showTable, setShowTable] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const { table } = props;

  return (
    <div
      className={props.className ? `vbx-chart ${props.className}` : 'vbx-chart'}
      style={{ ...props.style, ...(props.height !== undefined ? { height: props.height } : {}) }}
    >
      {props.legend || table ? (
        <div className="vbx-chart-top">
          {props.legend ?? <span />}
          {table && !props.empty ? (
            <button
              type="button"
              className="vbx-chart-toggle"
              aria-pressed={showTable}
              title={props.tableLabel ?? 'Table view'}
              aria-label={props.tableLabel ?? 'Table view'}
              onClick={() => setShowTable((v) => !v)}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="2" y="3" width="12" height="10" rx="1.5" />
                <path d="M2 6.5h12M2 10h12M6.5 6.5V13" />
              </svg>
            </button>
          ) : null}
        </div>
      ) : null}
      {showTable && table && !props.empty ? (
        <div className="vbx-chart-table" ref={tableRef} tabIndex={0}>
          <ChartTable {...table()} />
        </div>
      ) : (
        <div className="vbx-plot" ref={ref}>
          {props.empty ? (
            <div className="vbx-chart-empty">{props.emptyText ?? 'No data'}</div>
          ) : size && size.width > 0 && size.height > 0 ? (
            props.children(size)
          ) : null}
        </div>
      )}
    </div>
  );
}

function ChartTable({ columns, rows }: { columns: string[]; rows: string[][] }): ReactElement {
  const MAX = 500;
  return (
    <table className="vbx-mini-table">
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={i} scope="col" data-num={i > 0 ? '' : undefined}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, MAX).map((row, r) => (
          <tr key={r}>
            {row.map((cell, i) =>
              i === 0 ? (
                <th key={i} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={i} data-num="">
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Index of the sorted value closest to `target`. */
export function nearestIndex(sorted: ArrayLike<number>, target: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  if (hi < 0) return -1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < target) lo = mid;
    else hi = mid;
  }
  return Math.abs(sorted[lo]! - target) <= Math.abs(sorted[hi]! - target) ? lo : hi;
}
