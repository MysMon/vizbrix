import { useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import { toNumber, type ChartSelection, type Datum } from './common';
import { formatter, type Format } from './format';

// -------------------------------------------------------------------- Heatmap

export interface HeatmapProps {
  data: readonly Datum[];
  /** Field for the columns. */
  x: string;
  /** Field for the rows. */
  y: string;
  /** Numeric field colouring each cell. */
  value: string;
  /** Column / row order. Defaults to order of first appearance. */
  xOrder?: readonly string[];
  yOrder?: readonly string[];
  format?: Format;
  /** Print the value inside each cell. Default false: the tooltip and scale carry it. */
  labels?: boolean;
  /** Fix the ends of the colour scale. Default: the data's own range. */
  min?: number;
  max?: number;
  /** Called when a cell is clicked (or chosen with Enter). */
  onSelect?: (selection: ChartSelection) => void;
  lang?: string;
  ariaLabel?: string;
  height?: number | string;
  emptyText?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * A matrix of magnitudes — weekday × hour, cohort × month. One hue from
 * light to dark, never a rainbow, with a scale legend so the colour can be
 * read back to a number. Laid out with CSS grid, so it needs no measuring.
 */
export function Heatmap(props: HeatmapProps): ReactElement {
  const { data, x, y, value, lang } = props;
  const model = useMemo(() => {
    const cols = props.xOrder ? [...props.xOrder] : [];
    const rows = props.yOrder ? [...props.yOrder] : [];
    const cells = new Map<string, number>();
    const source = new Map<string, number>();
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < data.length; i++) {
      const d = data[i]!;
      const cx = String(d[x] ?? '');
      const cy = String(d[y] ?? '');
      const v = toNumber(d[value]);
      if (!props.xOrder && !cols.includes(cx)) cols.push(cx);
      if (!props.yOrder && !rows.includes(cy)) rows.push(cy);
      if (v === null) continue;
      cells.set(`${cy}\u0000${cx}`, v);
      source.set(`${cy}\u0000${cx}`, i);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    return { cols, rows, cells, source, lo: props.min ?? (lo === Infinity ? 0 : lo), hi: props.max ?? (hi === -Infinity ? 1 : hi) };
  }, [data, x, y, value, props.xOrder, props.yOrder, props.min, props.max]);

  const [active, setActive] = useState<{ row: number; col: number } | null>(null);
  const fmt = formatter(props.format, lang, Math.max(Math.abs(model.lo), Math.abs(model.hi)));
  const span = model.hi - model.lo || 1;

  if (!model.cols.length || !model.rows.length) {
    return <div className="vbx-chart-empty">{props.emptyText ?? 'No data'}</div>;
  }

  const pick = (row: number, col: number): void => {
    const i = model.source.get(`${model.rows[row]}\u0000${model.cols[col]}`);
    if (i !== undefined && props.onSelect) props.onSelect({ datum: data[i]!, index: i });
  };

  const onKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if ((event.key === 'Enter' || event.key === ' ') && active) {
      event.preventDefault();
      return pick(active.row, active.col);
    }
    const cur = active ?? { row: 0, col: -1 };
    let { row, col } = cur;
    if (event.key === 'ArrowRight') col = Math.min(model.cols.length - 1, col + 1);
    else if (event.key === 'ArrowLeft') col = Math.max(0, col - 1);
    else if (event.key === 'ArrowDown') row = Math.min(model.rows.length - 1, active ? row + 1 : 0);
    else if (event.key === 'ArrowUp') row = Math.max(0, row - 1);
    else if (event.key === 'Escape') return setActive(null);
    else return;
    event.preventDefault();
    setActive({ row, col: Math.max(0, col) });
  };

  const activeValue = active ? model.cells.get(`${model.rows[active.row]}\u0000${model.cols[active.col]}`) : undefined;

  return (
    <div
      className={props.className ? `vbx-heatmap ${props.className}` : 'vbx-heatmap'}
      style={{ ...props.style, ...(props.height !== undefined ? { height: props.height } : {}) }}
    >
      <div
        className="vbx-heatmap-grid"
        role="group"
        tabIndex={0}
        aria-label={props.ariaLabel ?? `${value} by ${y} and ${x}. Use arrow keys to read cells.`}
        style={{ gridTemplateColumns: `auto repeat(${model.cols.length}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${model.rows.length}, minmax(0, 1fr)) auto` }}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
      >
        {model.rows.map((row, r) => [
          <span key={`l${r}`} className="vbx-heatmap-row">
            {row}
          </span>,
          ...model.cols.map((col, c) => {
            const v = model.cells.get(`${row}\u0000${col}`);
            const t = v === undefined ? 0 : Math.max(0, Math.min(1, (v - model.lo) / span));
            return (
              <span
                key={`${r}-${c}`}
                className="vbx-heatmap-cell"
                data-empty={v === undefined ? '' : undefined}
                data-active={active?.row === r && active.col === c ? '' : undefined}
                data-ink={t > 0.55 ? 'on-high' : 'on-low'}
                style={v === undefined ? undefined : { ['--t' as string]: `${(t * 100).toFixed(1)}%` }}
                onPointerEnter={() => setActive({ row: r, col: c })}
                onClick={props.onSelect ? () => pick(r, c) : undefined}
                data-clickable={props.onSelect && v !== undefined ? '' : undefined}
              >
                {props.labels && v !== undefined ? fmt(v) : null}
              </span>
            );
          }),
        ])}
        <span />
        {model.cols.map((col, c) => (
          <span key={`c${c}`} className="vbx-heatmap-col">
            {col}
          </span>
        ))}
      </div>
      <div className="vbx-heatmap-foot">
        <span className="vbx-heatmap-readout" role="status">
          {active ? (
            <>
              {model.rows[active.row]} · {model.cols[active.col]}
              <strong>{activeValue === undefined ? '–' : fmt(activeValue)}</strong>
            </>
          ) : null}
        </span>
        <span className="vbx-heatmap-scale" aria-hidden="true">
          {fmt(model.lo)}
          <i />
          {fmt(model.hi)}
        </span>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- Funnel

export interface FunnelChartProps {
  /** Stages in order, first to last. */
  data: readonly Datum[];
  /** Field with each stage's name. Default `label`. */
  label?: string;
  /** Field with each stage's count. Default `value`. */
  value?: string;
  format?: Format;
  /** Called when a stage is clicked. */
  onSelect?: (selection: ChartSelection) => void;
  lang?: string;
  ariaLabel?: string;
  emptyText?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Stages of a process, each as a bar against the first stage, with the
 * conversion from the stage before. Plain bars on a shared baseline: lengths
 * compare honestly, which a tapering funnel shape does not allow.
 */
export function FunnelChart(props: FunnelChartProps): ReactElement {
  const { data, label = 'label', value = 'value', lang } = props;
  const stages = useMemo(
    () => data.map((d) => ({ name: String(d[label] ?? ''), value: Math.max(0, toNumber(d[value]) ?? 0) })),
    [data, label, value],
  );
  if (!stages.length) return <div className="vbx-chart-empty">{props.emptyText ?? 'No data'}</div>;
  const first = stages[0]!.value;
  // Full figures by default: stages span orders of magnitude, and compact
  // notation would print the first as 48K beside a last of 520.
  const fmt = formatter(props.format ?? 'number', lang, first);
  const pct = formatter('percent', lang);
  return (
    <ol className={props.className ? `vbx-funnel ${props.className}` : 'vbx-funnel'} style={props.style} aria-label={props.ariaLabel}>
      {stages.map((stage, i) => {
        const prev = i > 0 ? stages[i - 1]!.value : 0;
        return (
          <li
            key={`${stage.name}-${i}`}
            data-clickable={props.onSelect ? '' : undefined}
            onClick={props.onSelect ? () => props.onSelect!({ datum: data[i]!, index: i }) : undefined}
          >
            <span className="vbx-funnel-name" title={stage.name}>
              {stage.name}
            </span>
            <span className="vbx-funnel-value">{fmt(stage.value)}</span>
            <span className="vbx-funnel-rate">{i > 0 && prev > 0 ? pct(stage.value / prev) : ''}</span>
            <span className="vbx-funnel-track">
              <span style={{ width: `${first > 0 ? Math.min(100, (stage.value / first) * 100) : 0}%` }} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
