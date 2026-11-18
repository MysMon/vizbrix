import { memo, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import {
  ChartFrame,
  Legend,
  Tooltip,
  seriesColor,
  toNumber,
  type ChartSelection,
  type Datum,
  type ResolvedSeries,
  type Size,
} from './common';
import { formatter, textWidth, type Format } from './format';
import { linear, niceTicks } from './scale';

export interface ScatterChartProps {
  data: readonly Datum[];
  /** Numeric field for the horizontal axis. */
  x: string;
  /** Numeric field for the vertical axis. */
  y: string;
  /** Field that splits points into coloured groups. Keep it to a few groups: past three, hues get hard to tell apart when scattered. */
  group?: string;
  /** Field naming each point, shown in the tooltip. */
  label?: string;
  /** Numeric field scaling each point's area (a bubble chart). */
  size?: string;
  xFormat?: Format;
  yFormat?: Format;
  /** Axis titles. Default to the field names. */
  xLabel?: string;
  yLabel?: string;
  legend?: boolean;
  /** Called when a point is clicked (or chosen with Enter). */
  onSelect?: (selection: ChartSelection) => void;
  lang?: string;
  ariaLabel?: string;
  height?: number | string;
  emptyText?: string;
  tableLabel?: string;
  className?: string;
  style?: CSSProperties;
}

interface Point {
  x: number;
  y: number;
  size: number | null;
  group: number;
  name: string;
  /** Index of the source row in `data`. */
  row: number;
}

interface Layout {
  left: number;
  top: number;
  innerW: number;
  innerH: number;
  xTicks: { pos: number; label: string }[];
  yTicks: { pos: number; label: string }[];
  /** Pixel position and radius of each visible point, with its index into `points`. */
  dots: { px: number; py: number; r: number; color: string; index: number }[];
  fx: (v: number) => string;
  fy: (v: number) => string;
}

const HIT_RADIUS = 24;

function buildLayout(
  points: readonly Point[],
  groups: readonly ResolvedSeries[],
  hidden: ReadonlySet<string>,
  size: Size,
  props: Pick<ScatterChartProps, 'xFormat' | 'yFormat' | 'lang'>,
): Layout {
  const visible = points.map((p, index) => ({ p, index })).filter(({ p }) => !hidden.has(groups[p.group]!.key));
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let s1 = 0;
  for (const { p } of visible) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
    if (p.size !== null) s1 = Math.max(s1, p.size);
  }
  if (!visible.length) {
    x0 = y0 = 0;
    x1 = y1 = 1;
  }
  const top = 10;
  const bottom = 40;
  const innerH = Math.max(10, size.height - top - bottom);
  const yt = niceTicks(y0, y1, Math.max(2, Math.min(8, Math.floor(innerH / 44))));
  const fy = formatter(props.yFormat, props.lang, Math.max(Math.abs(yt.min), Math.abs(yt.max)));
  const yLabels = yt.values.map(fy);
  const left = Math.ceil(Math.max(...yLabels.map((l) => textWidth(l)), 12)) + 28;
  const innerW = Math.max(10, size.width - left - 16);
  const xt = niceTicks(x0, x1, Math.max(2, Math.min(10, Math.floor(innerW / 80))));
  const fx = formatter(props.xFormat, props.lang, Math.max(Math.abs(xt.min), Math.abs(xt.max)));
  const sx = linear(xt.min, xt.max, left, left + innerW);
  const sy = linear(yt.min, yt.max, top + innerH, top);

  return {
    left,
    top,
    innerW,
    innerH,
    xTicks: xt.values.map((v) => ({ pos: sx(v), label: fx(v) })),
    yTicks: yt.values.map((v, i) => ({ pos: sy(v), label: yLabels[i]! })),
    dots: visible.map(({ p, index }) => ({
      px: sx(p.x),
      py: sy(p.y),
      // Area, not radius, is proportional to the value.
      r: p.size !== null && s1 > 0 ? 3 + Math.sqrt(Math.max(0, p.size) / s1) * 13 : 4,
      color: groups[p.group]!.color,
      index,
    })),
    fx,
    fy,
  };
}

const Marks = memo(function Marks(props: { layout: Layout; size: Size; xLabel: string; yLabel: string; bubble: boolean }) {
  const { layout, size } = props;
  const { left, top, innerW, innerH } = layout;
  return (
    <svg className="vbx-svg" width={size.width} height={size.height} aria-hidden="true">
      {layout.yTicks.map((t, i) => (
        <g key={`y${i}`}>
          <line className="vbx-grid" x1={left} x2={left + innerW} y1={t.pos} y2={t.pos} />
          <text className="vbx-tick" x={left - 8} y={t.pos} dy="0.32em" textAnchor="end">
            {t.label}
          </text>
        </g>
      ))}
      {layout.xTicks.map((t, i) => (
        <g key={`x${i}`}>
          <line className="vbx-grid" x1={t.pos} x2={t.pos} y1={top} y2={top + innerH} />
          <text className="vbx-tick" x={t.pos} y={top + innerH + 16} textAnchor="middle">
            {t.label}
          </text>
        </g>
      ))}
      <text className="vbx-axis-title" x={left + innerW / 2} y={size.height - 4} textAnchor="middle">
        {props.xLabel}
      </text>
      <text className="vbx-axis-title" transform={`translate(11 ${top + innerH / 2}) rotate(-90)`} textAnchor="middle">
        {props.yLabel}
      </text>
      {layout.dots.map((d) => (
        <circle key={d.index} className="vbx-dot" cx={d.px} cy={d.py} r={d.r} style={{ fill: d.color }} opacity={props.bubble ? 0.7 : 0.9} />
      ))}
    </svg>
  );
});

function HoverLayer(props: {
  layout: Layout;
  points: readonly Point[];
  groups: readonly ResolvedSeries[];
  size: Size;
  label: string;
  xLabel: string;
  yLabel: string;
  sizeLabel?: string;
  grouped: boolean;
  lang?: string;
  onPick?: (row: number) => void;
}): ReactElement {
  const { layout, points, groups, size } = props;
  const [active, setActive] = useState<number | null>(null);
  // Keyboard order: left to right.
  const order = useMemo(() => layout.dots.map((_, i) => i).sort((a, b) => layout.dots[a]!.px - layout.dots[b]!.px), [layout]);
  const dot = active !== null ? layout.dots[active] : undefined;

  const fromPointer = (event: React.PointerEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const mx = event.clientX - box.left;
    const my = event.clientY - box.top;
    // The pointer only has to be closest, not dead-centre.
    let best = -1;
    let bestDist = HIT_RADIUS * HIT_RADIUS;
    for (let i = 0; i < layout.dots.length; i++) {
      const d = layout.dots[i]!;
      const dist = (d.px - mx) ** 2 + (d.py - my) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    setActive(best >= 0 ? best : null);
  };

  const onKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!order.length) return;
    const at = active === null ? -1 : order.indexOf(active);
    if (event.key === 'ArrowRight') setActive(order[Math.min(order.length - 1, at + 1)]!);
    else if (event.key === 'ArrowLeft') setActive(order[Math.max(0, at < 0 ? order.length - 1 : at - 1)]!);
    else if (event.key === 'Home') setActive(order[0]!);
    else if (event.key === 'End') setActive(order[order.length - 1]!);
    else if (event.key === 'Escape') setActive(null);
    else if ((event.key === 'Enter' || event.key === ' ') && dot && props.onPick) props.onPick(points[dot.index]!.row);
    else return;
    event.preventDefault();
  };

  const point = dot ? points[dot.index]! : null;
  return (
    <div
      className="vbx-hover"
      role="group"
      tabIndex={0}
      aria-label={props.label}
      onPointerMove={fromPointer}
      onPointerDown={fromPointer}
      onClick={() => {
        if (dot && props.onPick) props.onPick(points[dot.index]!.row);
      }}
      data-clickable={props.onPick && dot ? '' : undefined}
      onPointerLeave={() => setActive(null)}
      onBlur={() => setActive(null)}
      onKeyDown={onKey}
    >
      {dot && point ? (
        <>
          <svg className="vbx-svg" width={size.width} height={size.height} aria-hidden="true">
            <circle className="vbx-dot-focus" cx={dot.px} cy={dot.py} r={dot.r + 4} style={{ stroke: dot.color }} />
          </svg>
          <Tooltip
            title={point.name || (props.grouped ? groups[point.group]!.label : `${layout.fx(point.x)}, ${layout.fy(point.y)}`)}
            x={dot.px}
            y={Math.max(0, Math.min(dot.py - 20, size.height - 96))}
            bounds={size.width}
            offset={dot.r + 10}
            rows={[
              ...(props.grouped && point.name
                ? [{ key: 'g', label: groups[point.group]!.label, value: '', color: dot.color }]
                : []),
              { key: 'x', label: props.xLabel, value: layout.fx(point.x), color: 'transparent' },
              { key: 'y', label: props.yLabel, value: layout.fy(point.y), color: 'transparent' },
              ...(point.size !== null && props.sizeLabel
                ? [{ key: 's', label: props.sizeLabel, value: formatter('auto', props.lang, point.size)(point.size), color: 'transparent' }]
                : []),
            ]}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * Scatter plot: how two measures relate, one dot per row. Optional groups
 * (colour) and a third measure (dot area). The nearest dot within reach
 * answers the pointer, so small marks stay easy to read.
 */
export function ScatterChart(props: ScatterChartProps): ReactElement {
  const { data, x, y, group, label, size: sizeKey, lang } = props;
  const model = useMemo(() => {
    const names: string[] = [];
    const points: Point[] = [];
    for (let row = 0; row < data.length; row++) {
      const d = data[row]!;
      const px = toNumber(d[x]);
      const py = toNumber(d[y]);
      if (px === null || py === null) continue;
      const g = group ? String(d[group] ?? '') : '';
      let gi = names.indexOf(g);
      if (gi < 0) gi = names.push(g) - 1;
      points.push({ x: px, y: py, size: sizeKey ? toNumber(d[sizeKey]) : null, group: gi, name: label ? String(d[label] ?? '') : '', row });
    }
    const groups: ResolvedSeries[] = names.map((name, index) => ({ key: name, label: name, color: seriesColor(index), index }));
    return { points, groups };
  }, [data, x, y, group, label, sizeKey]);

  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (key: string): void =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < model.groups.length - 1) next.add(key);
      return next;
    });
  const xLabel = props.xLabel ?? x;
  const yLabel = props.yLabel ?? y;
  const showLegend = props.legend ?? (!!group && model.groups.length > 1);
  const aria = props.ariaLabel ?? `${yLabel} vs ${xLabel} — ${model.points.length} points. Use arrow keys to read values.`;

  return (
    <ChartFrame
      className={props.className}
      style={props.style}
      height={props.height}
      empty={model.points.length === 0}
      emptyText={props.emptyText}
      tableLabel={props.tableLabel}
      legend={showLegend ? <Legend series={model.groups} hidden={hidden} onToggle={toggle} shape="block" /> : undefined}
      table={() => {
        const fx = formatter(props.xFormat, lang);
        const fy = formatter(props.yFormat, lang);
        return {
          columns: [label ?? group ?? '#', xLabel, yLabel],
          rows: model.points.map((p, i) => [p.name || model.groups[p.group]!.label || String(i + 1), fx(p.x), fy(p.y)]),
        };
      }}
    >
      {(size) => (
        <ScatterPlot model={model} hidden={hidden} size={size} label={aria} xLabel={xLabel} yLabel={yLabel} options={props} />
      )}
    </ChartFrame>
  );
}

function ScatterPlot(props: {
  model: { points: Point[]; groups: ResolvedSeries[] };
  hidden: ReadonlySet<string>;
  size: Size;
  label: string;
  xLabel: string;
  yLabel: string;
  options: ScatterChartProps;
}): ReactElement {
  const { model, hidden, size, options } = props;
  const { xFormat, yFormat, lang } = options;
  const layout = useMemo(
    () => buildLayout(model.points, model.groups, hidden, size, { xFormat, yFormat, lang }),
    [model, hidden, size, xFormat, yFormat, lang],
  );
  return (
    <>
      <Marks layout={layout} size={size} xLabel={props.xLabel} yLabel={props.yLabel} bubble={!!options.size} />
      <HoverLayer
        layout={layout}
        points={model.points}
        groups={model.groups}
        size={size}
        label={props.label}
        xLabel={props.xLabel}
        yLabel={props.yLabel}
        sizeLabel={options.size}
        grouped={!!options.group}
        lang={lang}
        onPick={options.onSelect ? (row) => options.onSelect!({ datum: options.data[row]!, index: row }) : undefined}
      />
    </>
  );
}
