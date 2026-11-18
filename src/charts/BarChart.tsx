import { memo, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import {
  ChartFrame,
  Legend,
  Tooltip,
  resolveSeries,
  toNumber,
  useHidden,
  type Datum,
  type ResolvedSeries,
  type SeriesSpec,
  type Size,
} from './common';
import { formatter, textWidth, truncate, type Format } from './format';
import { linear, niceTicks } from './scale';

export interface BarChartProps {
  data: readonly Datum[];
  /** Field holding the category of each bar group. */
  x: string;
  series: readonly (SeriesSpec | string)[];
  /**
   * Series drawn as lines over the bars, on the same axis — a plan or target
   * against actuals. Vertical charts only.
   */
  lines?: readonly (SeriesSpec | string)[];
  /** Stack series within a category instead of placing them side by side. */
  stacked?: boolean;
  /** Draw categories down the side with bars growing to the right — best for long labels and rankings. */
  horizontal?: boolean;
  /** Print the value at the tip of each bar (single, unstacked series only). */
  labels?: boolean;
  yFormat?: Format;
  yMax?: number;
  legend?: boolean;
  lang?: string;
  ariaLabel?: string;
  height?: number | string;
  emptyText?: string;
  tableLabel?: string;
  className?: string;
  style?: CSSProperties;
}

const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;

interface Bar {
  key: string;
  d: string;
  color: string;
}

interface Layout {
  horizontal: boolean;
  /** Plot box. */
  left: number;
  top: number;
  innerW: number;
  innerH: number;
  band: number;
  /** Start coordinate of each category band along the band axis. */
  bandStart: number[];
  valueTicks: { pos: number; label: string }[];
  bandTicks: { pos: number; label: string; anchor: 'start' | 'middle' | 'end' }[];
  zero: number;
  bars: Bar[];
  lines: { key: string; color: string; d: string; points: [number, number][] }[];
  tips: { x: number; y: number; label: string; anchor: 'start' | 'middle' | 'end' }[];
  format: (value: number) => string;
}

/** A bar with a rounded data end and a square base, in either orientation. */
function barPath(horizontal: boolean, bandPos: number, thickness: number, from: number, to: number, round: boolean): string {
  const length = Math.abs(to - from);
  const r = round ? Math.min(RADIUS, thickness / 2, length) : 0;
  const dir = to >= from ? 1 : -1;
  const a = bandPos;
  const b = bandPos + thickness;
  const end = to;
  const shoulder = to - dir * r;
  // Described along the value axis (v) and band axis (p), then mapped to x/y.
  const pt = (v: number, p: number): string => (horizontal ? `${f(v)},${f(p)}` : `${f(p)},${f(v)}`);
  return (
    `M${pt(from, a)}L${pt(shoulder, a)}Q${pt(end, a)} ${pt(end, a + r)}` +
    `L${pt(end, b - r)}Q${pt(end, b)} ${pt(shoulder, b)}L${pt(from, b)}Z`
  );
}

const f = (n: number): string => (Math.round(n * 10) / 10).toString();

function buildLayout(
  categories: readonly string[],
  values: readonly (readonly (number | null)[])[],
  allVisible: readonly ResolvedSeries[],
  size: Size,
  props: Pick<BarChartProps, 'stacked' | 'horizontal' | 'labels' | 'yFormat' | 'yMax' | 'lang'>,
  barCount: number,
): Layout {
  const visible = allVisible.filter((s) => s.index < barCount);
  const lineSeries = allVisible.filter((s) => s.index >= barCount);
  const horizontal = !!props.horizontal;
  const stacked = !!props.stacked;
  const n = categories.length;

  let min = 0;
  let max = 0;
  for (let i = 0; i < n; i++) {
    let pos = 0;
    let neg = 0;
    for (const s of visible) {
      const v = values[s.index]![i] ?? 0;
      if (stacked) {
        if (v >= 0) pos += v;
        else neg += v;
      } else {
        max = Math.max(max, v);
        min = Math.min(min, v);
      }
    }
    if (stacked) {
      max = Math.max(max, pos);
      min = Math.min(min, neg);
    }
  }
  for (const s of lineSeries) {
    for (const v of values[s.index]!) {
      if (v === null) continue;
      max = Math.max(max, v);
      min = Math.min(min, v);
    }
  }
  if (props.yMax !== undefined) max = props.yMax;
  if (min === 0 && max === 0) max = 1;

  const showTips = !!props.labels && !stacked && visible.length === 1;
  const valueAxisLength = horizontal ? size.width : size.height;
  const ticks = niceTicks(min, max, Math.max(2, Math.min(8, Math.floor(valueAxisLength / (horizontal ? 90 : 44)))));
  const d0 = ticks.min;
  const d1 = props.yMax ?? ticks.max;
  const format = formatter(props.yFormat, props.lang, Math.max(Math.abs(d0), Math.abs(d1)));
  const tickValues = ticks.values.filter((v) => v <= d1 + 1e-9);
  const tickLabels = tickValues.map(format);

  let left: number;
  let top: number;
  let innerW: number;
  let innerH: number;
  let catLabels: string[];
  if (horizontal) {
    const widest = Math.max(0, ...categories.map((c) => textWidth(c, 12)));
    const labelW = Math.min(Math.ceil(widest), Math.floor(size.width * 0.38));
    catLabels = categories.map((c) => truncate(c, labelW, 12));
    left = labelW + 10;
    top = 6;
    const tipRoom = showTips ? Math.max(0, ...categories.map((_, i) => textWidth(format(values[visible[0]!.index]![i] ?? 0)))) + 10 : 0;
    innerW = Math.max(10, size.width - left - Math.max(14, tipRoom));
    innerH = Math.max(10, size.height - top - 24);
  } else {
    catLabels = [...categories];
    left = Math.ceil(Math.max(...tickLabels.map((l) => textWidth(l)), 12)) + 10;
    top = showTips ? 20 : 10;
    innerW = Math.max(10, size.width - left - 14);
    innerH = Math.max(10, size.height - top - 24);
  }

  const bandLength = horizontal ? innerH : innerW;
  const bandOrigin = horizontal ? top : left;
  const band = bandLength / Math.max(1, n);
  const scale = horizontal ? linear(d0, d1, left, left + innerW) : linear(d0, d1, top + innerH, top);
  const zero = scale(Math.max(d0, Math.min(d1, 0)));

  const count = stacked ? 1 : Math.max(1, visible.length);
  const thickness = Math.max(1, Math.min(MAX_BAR, (band * 0.72 - GAP * (count - 1)) / count));
  const groupWidth = thickness * count + GAP * (count - 1);

  const bars: Bar[] = [];
  const tips: Layout['tips'] = [];
  const bandStart: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = bandOrigin + i * band;
    bandStart.push(start);
    const groupStart = start + (band - groupWidth) / 2;
    if (stacked) {
      let pos = 0;
      let neg = 0;
      const lastPos = lastIndexWhere(visible, (s) => (values[s.index]![i] ?? 0) > 0);
      const lastNeg = lastIndexWhere(visible, (s) => (values[s.index]![i] ?? 0) < 0);
      visible.forEach((s, si) => {
        const v = values[s.index]![i] ?? 0;
        if (v === 0) return;
        const from = v > 0 ? pos : neg;
        const to = from + v;
        if (v > 0) pos = to;
        else neg = to;
        let p0 = scale(from);
        const p1 = scale(to);
        // A surface-coloured gap separates touching segments.
        const dir = p1 >= p0 ? 1 : -1;
        if (from !== 0 && Math.abs(p1 - p0) > GAP + 1) p0 += dir * GAP;
        const outer = si === (v > 0 ? lastPos : lastNeg);
        bars.push({ key: `${i}-${s.key}`, color: s.color, d: barPath(horizontal, groupStart, thickness, p0, p1, outer) });
      });
    } else {
      visible.forEach((s, si) => {
        const v = values[s.index]![i];
        if (v === null || v === undefined || v === 0) return;
        const bandPos = groupStart + si * (thickness + GAP);
        const tip = scale(Math.min(v, d1));
        bars.push({ key: `${i}-${s.key}`, color: s.color, d: barPath(horizontal, bandPos, thickness, zero, tip, true) });
        if (showTips) {
          tips.push(
            horizontal
              ? { x: tip + (v >= 0 ? 6 : -6), y: bandPos + thickness / 2, label: format(v), anchor: v >= 0 ? 'start' : 'end' }
              : { x: bandPos + thickness / 2, y: tip + (v >= 0 ? -6 : 14), label: format(v), anchor: 'middle' },
          );
        }
      });
    }
  }

  const lines: Layout['lines'] = lineSeries.map((s) => {
    const points: [number, number][] = [];
    let d = '';
    let pen = false;
    for (let i = 0; i < n; i++) {
      const v = values[s.index]![i];
      if (v === null || v === undefined) {
        pen = false;
        continue;
      }
      const x = bandStart[i]! + band / 2;
      const y = scale(v);
      d += `${pen ? 'L' : 'M'}${f(x)},${f(y)}`;
      pen = true;
      points.push([x, y]);
    }
    return { key: s.key, color: s.color, d, points };
  });

  // Category labels, thinned so neighbours never collide.
  const bandTicks: Layout['bandTicks'] = [];
  if (horizontal) {
    const every = Math.max(1, Math.ceil(16 / band));
    for (let i = 0; i < n; i += every) bandTicks.push({ pos: bandStart[i]! + band / 2, label: catLabels[i]!, anchor: 'end' });
  } else {
    const widest = Math.max(0, ...catLabels.map((l) => textWidth(l)));
    const every = Math.max(1, Math.ceil((widest + 10) / band));
    for (let i = 0; i < n; i += every) bandTicks.push({ pos: bandStart[i]! + band / 2, label: catLabels[i]!, anchor: 'middle' });
  }

  return {
    horizontal,
    left,
    top,
    innerW,
    innerH,
    band,
    bandStart,
    valueTicks: tickValues.map((v, i) => ({ pos: scale(v), label: tickLabels[i]! })),
    bandTicks,
    zero,
    bars,
    lines,
    tips,
    format,
  };
}

function lastIndexWhere<T>(list: readonly T[], test: (item: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i]!)) return i;
  return -1;
}

const Marks = memo(function Marks({ layout, size }: { layout: Layout; size: Size }) {
  const { left, top, innerW, innerH, horizontal } = layout;
  return (
    <svg className="vbx-svg" width={size.width} height={size.height} aria-hidden="true">
      {layout.valueTicks.map((t, i) =>
        horizontal ? (
          <g key={i}>
            <line className="vbx-grid" x1={t.pos} x2={t.pos} y1={top} y2={top + innerH} />
            <text className="vbx-tick" x={t.pos} y={top + innerH + 16} textAnchor="middle">
              {t.label}
            </text>
          </g>
        ) : (
          <g key={i}>
            <line className="vbx-grid" x1={left} x2={left + innerW} y1={t.pos} y2={t.pos} />
            <text className="vbx-tick" x={left - 8} y={t.pos} dy="0.32em" textAnchor="end">
              {t.label}
            </text>
          </g>
        ),
      )}
      {layout.bars.map((bar) => (
        <path key={bar.key} d={bar.d} style={{ fill: bar.color }} />
      ))}
      {horizontal ? (
        <line className="vbx-axis" x1={layout.zero} x2={layout.zero} y1={top} y2={top + innerH} />
      ) : (
        <line className="vbx-axis" x1={left} x2={left + innerW} y1={layout.zero} y2={layout.zero} />
      )}
      {layout.bandTicks.map((t, i) =>
        horizontal ? (
          <text key={i} className="vbx-tick vbx-tick-category" x={left - 10} y={t.pos} dy="0.32em" textAnchor="end">
            {t.label}
          </text>
        ) : (
          <text key={i} className="vbx-tick" x={t.pos} y={top + innerH + 16} textAnchor="middle">
            {t.label}
          </text>
        ),
      )}
      {layout.lines.map((l) => (
        <g key={l.key}>
          <path className="vbx-line" d={l.d} style={{ stroke: l.color }} />
          {l.points.length <= 40
            ? l.points.map(([x, y], i) => <circle key={i} className="vbx-dot" cx={x} cy={y} r={4} style={{ fill: l.color }} />)
            : null}
        </g>
      ))}
      {layout.tips.map((t, i) => (
        <text key={i} className="vbx-tip" x={t.x} y={t.y} dy={horizontal ? '0.32em' : undefined} textAnchor={t.anchor}>
          {t.label}
        </text>
      ))}
    </svg>
  );
});

function HoverLayer(props: {
  layout: Layout;
  categories: readonly string[];
  values: readonly (readonly (number | null)[])[];
  visible: readonly ResolvedSeries[];
  size: Size;
  label: string;
}): ReactElement {
  const { layout, categories, values, visible, size } = props;
  const [index, setIndex] = useState<number | null>(null);
  const n = categories.length;
  const active = index !== null && index < n ? index : null;

  const fromPointer = (event: React.PointerEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const pos = layout.horizontal ? event.clientY - box.top - layout.top : event.clientX - box.left - layout.left;
    const i = Math.floor(pos / layout.band);
    setIndex(i >= 0 && i < n ? i : null);
  };

  const onKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!n) return;
    const next = layout.horizontal ? 'ArrowDown' : 'ArrowRight';
    const prev = layout.horizontal ? 'ArrowUp' : 'ArrowLeft';
    if (event.key === next) setIndex((i) => Math.min(n - 1, (i ?? -1) + 1));
    else if (event.key === prev) setIndex((i) => Math.max(0, (i ?? n) - 1));
    else if (event.key === 'Home') setIndex(0);
    else if (event.key === 'End') setIndex(n - 1);
    else if (event.key === 'Escape') setIndex(null);
    else return;
    event.preventDefault();
  };

  const start = active !== null ? layout.bandStart[active]! : 0;
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
          <div
            className="vbx-band"
            style={
              layout.horizontal
                ? { left: layout.left, width: layout.innerW, top: start, height: layout.band }
                : { left: start, width: layout.band, top: layout.top, height: layout.innerH }
            }
          />
          <Tooltip
            title={categories[active]!}
            x={layout.horizontal ? layout.left + layout.innerW / 2 : start + layout.band / 2}
            y={layout.horizontal ? Math.min(start + layout.band, size.height - 30 - visible.length * 20) : layout.top}
            bounds={size.width}
            offset={layout.horizontal ? 12 : layout.band / 2 + 6}
            rows={visible.map((s) => {
              const v = values[s.index]![active];
              return { key: s.key, label: s.label, color: s.color, value: v === null || v === undefined ? '–' : layout.format(v) };
            })}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * Bar chart: grouped or stacked, vertical or horizontal. Bars are capped at
 * 24px so sparse data does not turn into slabs; touching marks are separated
 * by a gap rather than an outline; the whole category band is the hover
 * target, so the pointer never has to land on a thin bar.
 */
export function BarChart(props: BarChartProps): ReactElement {
  const { data, x, lang } = props;
  const barCount = props.series.length;
  const overlay = props.horizontal ? undefined : props.lines;
  const series = useMemo(() => resolveSeries([...props.series, ...(overlay ?? [])]), [props.series, overlay]);
  const lineKeys = useMemo(() => new Set(series.filter((s) => s.index >= barCount).map((s) => s.key)), [series, barCount]);
  const [hidden, toggle] = useHidden(series);
  const categories = useMemo(() => data.map((d) => String(d[x] ?? '')), [data, x]);
  const values = useMemo(() => series.map((s) => data.map((d) => toNumber(d[s.key]))), [data, series]);
  const visible = useMemo(() => series.filter((s) => !hidden.has(s.key)), [series, hidden]);
  const showLegend = props.legend ?? series.length > 1;
  const label =
    props.ariaLabel ??
    `${series.map((s) => s.label).join(', ')} — ${categories.length} categories. Use arrow keys to read values.`;

  return (
    <ChartFrame
      className={props.className}
      style={props.style}
      height={props.height}
      empty={categories.length === 0 || series.length === 0}
      emptyText={props.emptyText}
      tableLabel={props.tableLabel}
      legend={showLegend ? <Legend series={series} hidden={hidden} onToggle={toggle} shape="block" lineKeys={lineKeys} /> : undefined}
      table={() => {
        const fmt = formatter(props.yFormat, lang);
        return {
          columns: [x, ...series.map((s) => s.label)],
          rows: categories.map((c, i) => [
            c,
            ...series.map((s) => {
              const v = values[s.index]![i];
              return v === null || v === undefined ? '–' : fmt(v);
            }),
          ]),
        };
      }}
    >
      {(size) => (
        <BarPlot categories={categories} values={values} visible={visible} size={size} label={label} options={props} barCount={barCount} />
      )}
    </ChartFrame>
  );
}

function BarPlot(props: {
  categories: readonly string[];
  values: readonly (readonly (number | null)[])[];
  visible: readonly ResolvedSeries[];
  size: Size;
  label: string;
  options: BarChartProps;
  barCount: number;
}): ReactElement {
  const { categories, values, visible, size, options, barCount } = props;
  const { stacked, horizontal, labels, yFormat, yMax, lang } = options;
  const layout = useMemo(
    () => buildLayout(categories, values, visible, size, { stacked, horizontal, labels, yFormat, yMax, lang }, barCount),
    [categories, values, visible, size, stacked, horizontal, labels, yFormat, yMax, lang, barCount],
  );
  return (
    <>
      <Marks layout={layout} size={size} />
      <HoverLayer layout={layout} categories={categories} values={values} visible={visible} size={size} label={props.label} />
    </>
  );
}
