import { memo, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import {
  ChartFrame,
  Legend,
  Tooltip,
  nearestIndex,
  resolveSeries,
  toNumber,
  useHidden,
  type Datum,
  type ResolvedSeries,
  type SeriesSpec,
  type Size,
} from './common';
import { dateFormatter, formatter, textWidth, type Format } from './format';
import { linePath, linear, lttb, niceTicks, smoothPath, timeTicks } from './scale';

export interface LineChartProps {
  data: readonly Datum[];
  /** Field holding the x value: a category, a number, or a date. */
  x: string;
  /** One line per entry. */
  series: readonly (SeriesSpec | string)[];
  /** Fill under each line with a light wash of its colour. */
  area?: boolean;
  /** Stack the series on top of each other (implies `area`). */
  stacked?: boolean;
  curve?: 'linear' | 'smooth';
  /** How to read x. `auto` treats Date values as time, numbers as numeric, the rest as categories. */
  xType?: 'auto' | 'category' | 'time' | 'number';
  yFormat?: Format;
  /** Include zero in the y-axis. Defaults to true for areas, false for plain lines. */
  zero?: boolean;
  yMin?: number;
  yMax?: number;
  legend?: boolean;
  /** BCP 47 tag for number and date formatting. */
  lang?: string;
  ariaLabel?: string;
  /** CSS height. Omit inside a sized parent — the chart fills it. */
  height?: number | string;
  emptyText?: string;
  tableLabel?: string;
  className?: string;
  style?: CSSProperties;
}

interface Model {
  kind: 'category' | 'time' | 'number';
  /** x value per row: epoch ms, number, or row index for categories. */
  xv: number[];
  labels: string[];
  /** values[seriesIndex][row] */
  values: (number | null)[][];
}

function buildModel(
  data: readonly Datum[],
  xKey: string,
  series: readonly ResolvedSeries[],
  xType: LineChartProps['xType'],
  lang: string | undefined,
): Model {
  let kind: Model['kind'] = 'category';
  if (xType && xType !== 'auto') kind = xType;
  else {
    const sample = data.find((d) => d[xKey] !== null && d[xKey] !== undefined)?.[xKey];
    if (sample instanceof Date) kind = 'time';
    else if (typeof sample === 'number') kind = 'number';
  }

  let rows: { xv: number; datum: Datum }[];
  if (kind === 'category') {
    rows = data.map((datum, i) => ({ xv: i, datum }));
  } else {
    rows = [];
    for (const datum of data) {
      const raw = datum[xKey];
      const xv = kind === 'time' ? (raw instanceof Date ? raw.getTime() : new Date(raw as string | number).getTime()) : toNumber(raw);
      if (xv !== null && Number.isFinite(xv)) rows.push({ xv, datum });
    }
    rows.sort((a, b) => a.xv - b.xv);
  }

  const xv = rows.map((r) => r.xv);
  let labels: string[];
  if (kind === 'time') {
    const span = xv.length ? xv[xv.length - 1]! - xv[0]! : 0;
    const fmt = dateFormatter(
      lang,
      span < 2 * 86400000 ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' },
    );
    labels = xv.map((t) => fmt(new Date(t)));
  } else if (kind === 'number') {
    const fmt = formatter('number', lang);
    labels = xv.map((v) => fmt(v));
  } else {
    labels = rows.map((r) => String(r.datum[xKey] ?? ''));
  }
  const values = series.map((s) => rows.map((r) => toNumber(r.datum[s.key])));
  return { kind, xv, labels, values };
}

interface Layout {
  left: number;
  top: number;
  innerW: number;
  innerH: number;
  xs: number[];
  yTicks: { y: number; label: string }[];
  xTicks: { x: number; label: string; anchor: 'start' | 'middle' | 'end' }[];
  zeroY: number | null;
  paths: { key: string; color: string; line: string; area: string | null }[];
  /** Pixel y of each visible series at each row (top of its band when stacked). */
  ys: (number | null)[][];
  format: (value: number) => string;
}

function buildLayout(
  model: Model,
  visible: readonly ResolvedSeries[],
  size: Size,
  props: Pick<LineChartProps, 'area' | 'stacked' | 'curve' | 'yFormat' | 'zero' | 'yMin' | 'yMax' | 'lang'>,
): Layout {
  const n = model.xv.length;
  const stacked = !!props.stacked;
  const filled = stacked || !!props.area;

  // Tops and bottoms of each series in data space.
  const tops: (number | null)[][] = [];
  const bottoms: number[][] = [];
  const running = new Array<number>(n).fill(0);
  let min = Infinity;
  let max = -Infinity;
  for (const s of visible) {
    const raw = model.values[s.index]!;
    const top: (number | null)[] = [];
    const bottom: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = raw[i]!;
      if (stacked) {
        bottom.push(running[i]!);
        running[i]! += v ?? 0;
        top.push(running[i]!);
      } else {
        bottom.push(0);
        top.push(v);
      }
      const t = top[i];
      if (t !== null && t !== undefined) {
        if (t < min) min = t;
        if (t > max) max = t;
      }
    }
    tops.push(top);
    bottoms.push(bottom);
  }
  if (min === Infinity) {
    min = 0;
    max = 1;
  }
  if (props.zero ?? filled) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (props.yMin !== undefined) min = props.yMin;
  if (props.yMax !== undefined) max = props.yMax;

  const top = 10;
  const bottom = 24;
  const innerH = Math.max(10, size.height - top - bottom);
  const ticks = niceTicks(min, max, Math.max(2, Math.min(8, Math.floor(innerH / 44))));
  const d0 = props.yMin ?? ticks.min;
  const d1 = props.yMax ?? ticks.max;
  const format = formatter(props.yFormat, props.lang, Math.max(Math.abs(d0), Math.abs(d1)));
  const tickValues = ticks.values.filter((v) => v >= d0 - 1e-9 && v <= d1 + 1e-9);
  const tickLabels = tickValues.map(format);
  const left = Math.ceil(Math.max(...tickLabels.map((l) => textWidth(l)), 12)) + 10;
  const right = 14;
  const innerW = Math.max(10, size.width - left - right);
  const yScale = linear(d0, d1, top + innerH, top);

  // X positions
  let xs: number[];
  if (n === 1) xs = [left + innerW / 2];
  else if (model.kind === 'category') xs = model.xv.map((_, i) => left + (i / (n - 1)) * innerW);
  else {
    const xScale = linear(model.xv[0]!, model.xv[n - 1]!, left, left + innerW);
    xs = model.xv.map(xScale);
  }

  // X ticks
  const xTicks: Layout['xTicks'] = [];
  if (model.kind === 'category') {
    const widest = Math.max(0, ...model.labels.map((l) => textWidth(l)));
    const stepPx = n > 1 ? innerW / (n - 1) : innerW;
    const every = Math.max(1, Math.ceil((widest + 14) / stepPx));
    for (let i = 0; i < n; i += every) xTicks.push({ x: xs[i]!, label: model.labels[i]!, anchor: 'middle' });
  } else if (n > 1) {
    const lo = model.xv[0]!;
    const hi = model.xv[n - 1]!;
    const xScale = linear(lo, hi, left, left + innerW);
    if (model.kind === 'time') {
      const t = timeTicks(lo, hi, Math.max(2, Math.floor(innerW / 92)), props.lang);
      for (const v of t.values) xTicks.push({ x: xScale(v), label: t.format(new Date(v)), anchor: 'middle' });
    } else {
      const t = niceTicks(lo, hi, Math.max(2, Math.floor(innerW / 72)));
      const fmt = formatter('auto', props.lang, Math.max(Math.abs(lo), Math.abs(hi)));
      for (const v of t.values) {
        if (v >= lo && v <= hi) xTicks.push({ x: xScale(v), label: fmt(v), anchor: 'middle' });
      }
    }
  } else if (n === 1) {
    xTicks.push({ x: xs[0]!, label: model.labels[0]!, anchor: 'middle' });
  }
  // Keep the outermost labels inside the plot instead of clipping them.
  for (const tick of xTicks) {
    const half = textWidth(tick.label) / 2;
    if (tick.x - half < 2) tick.anchor = 'start';
    else if (tick.x + half > size.width - 2) tick.anchor = 'end';
  }

  // Paths
  const draw = props.curve === 'smooth' ? smoothPath : linePath;
  const budget = Math.max(64, Math.floor(innerW * 2));
  const ys: (number | null)[][] = [];
  const paths: Layout['paths'] = visible.map((s, si) => {
    const topV = tops[si]!;
    const py = topV.map((v) => (v === null ? null : yScale(v)));
    ys.push(py);
    let line = '';
    let area = '';
    let start = 0;
    while (start < n) {
      while (start < n && py[start] === null) start++;
      let end = start;
      while (end < n && py[end] !== null) end++;
      if (end > start) {
        let idx = Array.from({ length: end - start }, (_, i) => start + i);
        if (idx.length > budget) {
          const segX = idx.map((i) => xs[i]!);
          const segY = idx.map((i) => py[i]!);
          idx = lttb(segX, segY, budget).map((k) => start + k);
        }
        const pts = idx.map((i) => [xs[i]!, py[i]!] as const);
        const segment = draw(pts);
        line += segment;
        if (filled) {
          const base = idx.map((i) => [xs[i]!, yScale(bottoms[si]![i]!)] as const).reverse();
          const back = stacked && props.curve === 'smooth' ? smoothPath(base) : linePath(base);
          area += `${segment}L${back.slice(1)}Z`;
        }
      }
      start = end;
    }
    return { key: s.key, color: s.color, line, area: filled ? area : null };
  });

  return {
    left,
    top,
    innerW,
    innerH,
    xs,
    yTicks: tickValues.map((v, i) => ({ y: yScale(v), label: tickLabels[i]! })),
    xTicks,
    zeroY: d0 <= 0 && d1 >= 0 ? yScale(0) : null,
    paths,
    ys,
    format,
  };
}

/** Grid, axes and marks. Memoized so hovering re-renders only the hover layer. */
const Marks = memo(function Marks({ layout, size, stacked }: { layout: Layout; size: Size; stacked: boolean }) {
  const { left, top, innerW, innerH } = layout;
  return (
    <svg className="vbx-svg" width={size.width} height={size.height} aria-hidden="true">
      {layout.yTicks.map((t, i) => (
        <g key={i}>
          <line className="vbx-grid" x1={left} x2={left + innerW} y1={t.y} y2={t.y} />
          <text className="vbx-tick" x={left - 8} y={t.y} dy="0.32em" textAnchor="end">
            {t.label}
          </text>
        </g>
      ))}
      <line
        className="vbx-axis"
        x1={left}
        x2={left + innerW}
        y1={layout.zeroY ?? top + innerH}
        y2={layout.zeroY ?? top + innerH}
      />
      {layout.xTicks.map((t, i) => (
        <text key={i} className="vbx-tick" x={t.x} y={top + innerH + 16} textAnchor={t.anchor}>
          {t.label}
        </text>
      ))}
      {layout.paths.map((p) =>
        p.area ? (
          <path key={`a-${p.key}`} d={p.area} style={{ fill: p.color }} opacity={stacked ? 0.22 : layout.paths.length > 1 ? 0.07 : 0.1} stroke="none" />
        ) : null,
      )}
      {layout.paths.map((p) => (
        <path key={p.key} className="vbx-line" d={p.line} style={{ stroke: p.color }} />
      ))}
      {layout.xs.length === 1
        ? layout.paths.map((p, i) =>
            layout.ys[i]![0] !== null ? (
              <circle key={p.key} className="vbx-dot" cx={layout.xs[0]} cy={layout.ys[i]![0]!} r={4} style={{ fill: p.color }} />
            ) : null,
          )
        : null}
    </svg>
  );
});

function HoverLayer(props: {
  layout: Layout;
  model: Model;
  visible: readonly ResolvedSeries[];
  size: Size;
  label: string;
}): ReactElement {
  const { layout, model, visible, size } = props;
  const [index, setIndex] = useState<number | null>(null);
  const n = layout.xs.length;
  const active = index !== null && index < n ? index : null;

  const fromPointer = (event: React.PointerEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const i = nearestIndex(layout.xs, event.clientX - box.left);
    if (i >= 0) setIndex(i);
  };

  const onKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!n) return;
    if (event.key === 'ArrowRight') setIndex((i) => Math.min(n - 1, (i ?? -1) + 1));
    else if (event.key === 'ArrowLeft') setIndex((i) => Math.max(0, (i ?? n) - 1));
    else if (event.key === 'Home') setIndex(0);
    else if (event.key === 'End') setIndex(n - 1);
    else if (event.key === 'Escape') setIndex(null);
    else return;
    event.preventDefault();
  };

  return (
    <div
      className="vbx-hover"
      role="group"
      tabIndex={0}
      aria-label={props.label}
      onPointerMove={fromPointer}
      onPointerDown={fromPointer}
      onPointerLeave={() => setIndex(null)}
      onBlur={() => setIndex(null)}
      onKeyDown={onKey}
    >
      {active !== null ? (
        <>
          <svg className="vbx-svg" width={size.width} height={size.height} aria-hidden="true">
            <line
              className="vbx-crosshair"
              x1={layout.xs[active]}
              x2={layout.xs[active]}
              y1={layout.top}
              y2={layout.top + layout.innerH}
            />
            {visible.map((s, i) => {
              const y = layout.ys[i]![active];
              return y === null || y === undefined ? null : (
                <circle key={s.key} className="vbx-dot" cx={layout.xs[active]} cy={y} r={4.5} style={{ fill: s.color }} />
              );
            })}
          </svg>
          <Tooltip
            title={model.labels[active]!}
            x={layout.xs[active]!}
            y={layout.top}
            bounds={size.width}
            rows={visible.map((s) => {
              const v = model.values[s.index]![active];
              return {
                key: s.key,
                label: s.label,
                color: s.color,
                value: v === null || v === undefined ? '–' : layout.format(v),
              };
            })}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * Line / area chart. One y-axis, a crosshair that snaps to the nearest x and
 * lists every series, a legend that toggles series, and a table view. Large
 * series are downsampled to the pixels available, so 100k points cost about
 * the same as 1k.
 */
export function LineChart(props: LineChartProps): ReactElement {
  const { data, x, lang, xType } = props;
  const series = useMemo(() => resolveSeries(props.series), [props.series]);
  const [hidden, toggle] = useHidden(series);
  const model = useMemo(() => buildModel(data, x, series, xType, lang), [data, x, series, xType, lang]);
  const visible = useMemo(() => series.filter((s) => !hidden.has(s.key)), [series, hidden]);
  const showLegend = props.legend ?? series.length > 1;
  const label =
    props.ariaLabel ?? `${series.map((s) => s.label).join(', ')} — ${model.xv.length} points. Use arrow keys to read values.`;

  return (
    <ChartFrame
      className={props.className}
      style={props.style}
      height={props.height}
      empty={model.xv.length === 0 || series.length === 0}
      emptyText={props.emptyText}
      tableLabel={props.tableLabel}
      legend={
        showLegend ? (
          <Legend series={series} hidden={hidden} onToggle={toggle} shape={props.area || props.stacked ? 'block' : 'line'} />
        ) : undefined
      }
      table={() => {
        const fmt = formatter(props.yFormat, lang);
        return {
          columns: [x, ...series.map((s) => s.label)],
          rows: model.labels.map((l, i) => [
            l,
            ...series.map((s) => {
              const v = model.values[s.index]![i];
              return v === null || v === undefined ? '–' : fmt(v);
            }),
          ]),
        };
      }}
    >
      {(size) => <LinePlot model={model} visible={visible} size={size} label={label} options={props} />}
    </ChartFrame>
  );
}

function LinePlot(props: {
  model: Model;
  visible: readonly ResolvedSeries[];
  size: Size;
  label: string;
  options: LineChartProps;
}): ReactElement {
  const { model, visible, size, options } = props;
  const { area, stacked, curve, yFormat, zero, yMin, yMax, lang } = options;
  const layout = useMemo(
    () => buildLayout(model, visible, size, { area, stacked, curve, yFormat, zero, yMin, yMax, lang }),
    [model, visible, size, area, stacked, curve, yFormat, zero, yMin, yMax, lang],
  );
  return (
    <>
      <Marks layout={layout} size={size} stacked={!!stacked} />
      <HoverLayer layout={layout} model={model} visible={visible} size={size} label={props.label} />
    </>
  );
}

/** `LineChart` with the area wash on. */
export function AreaChart(props: LineChartProps): ReactElement {
  return <LineChart {...props} area={props.area ?? true} />;
}
