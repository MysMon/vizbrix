import { useMemo, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { seriesColor, toNumber, type ChartSelection, type Datum } from './common';
import { formatter, type Format } from './format';

// ------------------------------------------------------------------ Sparkline

export interface SparklineProps {
  /** Values in order. */
  data: readonly number[];
  color?: string;
  /** Fill under the line. Default true. */
  area?: boolean;
  /** Mark the last point. Default true. */
  endDot?: boolean;
  height?: number | string;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * A word-sized trend line. Drawn in a stretchable 100×100 box with
 * non-scaling strokes, so it needs no measurement and costs nothing to resize.
 */
export function Sparkline(props: SparklineProps): ReactElement | null {
  const { data, color = 'var(--vbx-series-1)', area = true, endDot = true } = props;
  const geometry = useMemo(() => {
    const values = data.filter((v) => Number.isFinite(v));
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 92 - ((v - min) / span) * 84] as const);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join('');
    return { line, fill: `${line}L100,100L0,100Z`, last: pts[pts.length - 1]! };
  }, [data]);
  if (!geometry) return null;
  return (
    <div
      className={props.className ? `vbx-spark ${props.className}` : 'vbx-spark'}
      style={{ ...props.style, ...(props.height !== undefined ? { height: props.height } : {}) }}
      role="img"
      aria-label={props.ariaLabel ?? 'Trend'}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {area ? <path d={geometry.fill} style={{ fill: color }} opacity={0.1} /> : null}
        <path d={geometry.line} className="vbx-line" style={{ stroke: color }} vectorEffect="non-scaling-stroke" />
      </svg>
      {endDot ? (
        <span className="vbx-spark-dot" style={{ left: `${geometry.last[0]}%`, top: `${geometry.last[1]}%`, background: color }} />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------- StatTile

export interface StatTileProps {
  label?: string;
  value: number | string | null | undefined;
  format?: Format;
  /** Change versus a comparison period, as a ratio (0.12 = +12%) unless `deltaFormat` says otherwise. */
  delta?: number | null;
  deltaFormat?: Format;
  /** What the delta is measured against, e.g. "vs last month". */
  deltaLabel?: string;
  /** Whether an increase is good news. Decides the delta's colour. Default true. */
  upIsGood?: boolean;
  /** Recent values for a sparkline. */
  trend?: readonly number[];
  lang?: string;
  className?: string;
  style?: CSSProperties;
}

/** The figure: a headline number with an optional signed delta and trend. */
export function StatTile(props: StatTileProps): ReactElement {
  const { value, delta, upIsGood = true, lang } = props;
  const text = typeof value === 'number' ? formatter(props.format, lang, value)(value) : (value ?? '–');
  let deltaNode: ReactNode = null;
  if (typeof delta === 'number' && Number.isFinite(delta)) {
    const fmt = formatter(props.deltaFormat ?? 'percent', lang);
    const tone = delta === 0 ? 'flat' : delta > 0 === upIsGood ? 'good' : 'bad';
    deltaNode = (
      <span className="vbx-stat-delta" data-tone={tone}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          {delta === 0 ? <path d="M1 5h8" stroke="currentColor" strokeWidth="1.6" /> : <path d={delta > 0 ? 'M5 1.5 9 8H1Z' : 'M5 8.5 1 2h8Z'} fill="currentColor" />}
        </svg>
        {delta > 0 ? '+' : ''}
        {fmt(delta)}
      </span>
    );
  }
  return (
    <div className={props.className ? `vbx-stat ${props.className}` : 'vbx-stat'} style={props.style}>
      <div className="vbx-stat-main">
        {props.label ? <div className="vbx-stat-label">{props.label}</div> : null}
        <div className="vbx-stat-value">{text}</div>
        {deltaNode || props.deltaLabel ? (
          <div className="vbx-stat-foot">
            {deltaNode}
            {props.deltaLabel ? <span className="vbx-stat-period">{props.deltaLabel}</span> : null}
          </div>
        ) : null}
      </div>
      {props.trend && props.trend.length > 1 ? <Sparkline data={props.trend} className="vbx-stat-trend" /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------- Meter

export type Status = 'good' | 'warning' | 'serious' | 'critical';

export interface MeterProps {
  label?: string;
  value: number;
  /** Default 1 (so `value` is a ratio). */
  max?: number;
  format?: Format;
  /** Colour the fill by state instead of the accent. Shown with a text label, never colour alone. */
  status?: Status;
  /** Text for the status, e.g. "On track". */
  statusLabel?: string;
  lang?: string;
  className?: string;
  style?: CSSProperties;
}

/** Progress toward a limit. The track is a lighter step of the fill's own colour. */
export function Meter(props: MeterProps): ReactElement {
  const { value, max = 1, lang } = props;
  const ratio = Math.max(0, Math.min(1, max ? value / max : 0));
  const color = props.status ? `var(--vbx-status-${props.status})` : 'var(--vbx-series-1)';
  const fmt = formatter(props.format ?? (max === 1 ? 'percent' : 'auto'), lang, value);
  return (
    <div className={props.className ? `vbx-meter ${props.className}` : 'vbx-meter'} style={props.style}>
      <div className="vbx-meter-head">
        {props.label ? <span className="vbx-meter-label">{props.label}</span> : null}
        <span className="vbx-meter-value">
          {fmt(value)}
          {max !== 1 ? <span className="vbx-meter-max"> / {formatter(props.format, lang, max)(max)}</span> : null}
        </span>
      </div>
      <div
        className="vbx-meter-track"
        role="meter"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={fmt(value)}
        style={{ ['--vbx-meter-color' as string]: color }}
      >
        <div className="vbx-meter-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      {props.statusLabel ? (
        <div className="vbx-meter-status">
          <span className="vbx-status-dot" style={{ background: color }} />
          {props.statusLabel}
        </div>
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------- shared parts

export interface PartsProps {
  data: readonly Datum[];
  /** Field with each part's name. Default `label`. */
  label?: string;
  /** Field with each part's amount. Default `value`. */
  value?: string;
  format?: Format;
  /** Called when a part is clicked. The folded "Other" part reports nothing. */
  onSelect?: (selection: ChartSelection) => void;
  emptyText?: string;
  lang?: string;
  className?: string;
  style?: CSSProperties;
}

interface Part {
  name: string;
  value: number;
  color: string;
  share: number;
  /** Index of the source row, or -1 for the folded tail. */
  index: number;
}

function useParts(props: PartsProps, limit = 8): { parts: Part[]; total: number } {
  const { data, label = 'label', value = 'value' } = props;
  return useMemo(() => {
    let parts = data
      .map((d, index) => ({ name: String(d[label] ?? ''), value: Math.max(0, toNumber(d[value]) ?? 0), index }))
      .filter((p) => p.value > 0);
    // Past the palette, the tail folds into one neutral "Other" part.
    if (parts.length > limit) {
      const head = parts.slice(0, limit - 1);
      const rest = parts.slice(limit - 1).reduce((sum, p) => sum + p.value, 0);
      parts = [...head, { name: 'Other', value: rest, index: -1 }];
    }
    const total = parts.reduce((sum, p) => sum + p.value, 0);
    const folded = parts.some((p) => p.index < 0);
    return {
      total,
      parts: parts.map((p, i) => ({
        ...p,
        share: total ? p.value / total : 0,
        color: folded && i === parts.length - 1 ? 'var(--vbx-series-other)' : seriesColor(i),
      })),
    };
  }, [data, label, value, limit]);
}

function PartsLegend(props: {
  parts: Part[];
  fmt: (v: number) => string;
  lang?: string;
  active: number | null;
  onActive: (i: number | null) => void;
  onPick?: (part: Part) => void;
}): ReactElement {
  const pct = formatter('percent', props.lang);
  return (
    <ul className="vbx-parts-legend">
      {props.parts.map((p, i) => (
        <li
          key={p.name}
          data-dim={props.active !== null && props.active !== i ? '' : undefined}
          onPointerEnter={() => props.onActive(i)}
          onPointerLeave={() => props.onActive(null)}
          onClick={props.onPick && p.index >= 0 ? () => props.onPick!(p) : undefined}
          data-clickable={props.onPick && p.index >= 0 ? '' : undefined}
        >
          <span className="vbx-swatch" data-shape="block" style={{ background: p.color }} />
          <span className="vbx-parts-name">{p.name}</span>
          <span className="vbx-parts-value">{props.fmt(p.value)}</span>
          <span className="vbx-parts-share">{pct(p.share)}</span>
        </li>
      ))}
    </ul>
  );
}

function usePick(props: PartsProps): ((part: Part) => void) | undefined {
  const { onSelect, data } = props;
  return onSelect ? (part) => onSelect({ datum: data[part.index]!, index: part.index }) : undefined;
}

// --------------------------------------------------------------- SegmentedBar

/** One whole split into parts: a thin bar with the names and amounts listed beneath. */
export function SegmentedBar(props: PartsProps): ReactElement {
  const { parts, total } = useParts(props);
  const [active, setActive] = useState<number | null>(null);
  const fmt = formatter(props.format, props.lang, total);
  const pick = usePick(props);
  if (!parts.length) return <div className="vbx-chart-empty">{props.emptyText ?? 'No data'}</div>;
  return (
    <div className={props.className ? `vbx-segmented ${props.className}` : 'vbx-segmented'} style={props.style}>
      <div className="vbx-segmented-bar" role="img" aria-label={parts.map((p) => `${p.name} ${fmt(p.value)}`).join(', ')}>
        {parts.map((p, i) => (
          <span
            key={p.name}
            style={{ flexGrow: p.value, background: p.color }}
            data-dim={active !== null && active !== i ? '' : undefined}
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
            onClick={pick && p.index >= 0 ? () => pick(p) : undefined}
            data-clickable={pick && p.index >= 0 ? '' : undefined}
          />
        ))}
      </div>
      <PartsLegend parts={parts} fmt={fmt} lang={props.lang} active={active} onActive={setActive} onPick={pick} />
    </div>
  );
}

// ----------------------------------------------------------------- DonutChart

export interface DonutChartProps extends PartsProps {
  /** Caption under the total in the centre. */
  centerLabel?: string;
}

function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number): string => `${(cx + r * Math.sin(a)).toFixed(2)},${(cy - r * Math.cos(a)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r1, a0)}A${r1},${r1} 0 ${large} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0},${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
}

/**
 * Part-to-whole at a glance, for a handful of parts. The centre reads the
 * total, or the hovered part; every amount is also printed in the legend, so
 * nothing depends on hovering or on telling colours apart.
 */
export function DonutChart(props: DonutChartProps): ReactElement {
  const { parts, total } = useParts(props);
  const [active, setActive] = useState<number | null>(null);
  const fmt = formatter(props.format, props.lang, total);
  const pick = usePick(props);
  if (!parts.length) return <div className="vbx-chart-empty">{props.emptyText ?? 'No data'}</div>;

  let angle = 0;
  const arcs = parts.map((p) => {
    const a0 = angle;
    angle += p.share * Math.PI * 2;
    // A full circle cannot be drawn as one arc; stop a hair short.
    return arc(50, 50, 31, 46, a0, Math.min(angle, a0 + Math.PI * 2 - 0.0001));
  });
  const focus = active !== null ? parts[active]! : null;

  return (
    <div className={props.className ? `vbx-donut ${props.className}` : 'vbx-donut'} style={props.style}>
      <div className="vbx-donut-ring">
        <svg viewBox="0 0 100 100" role="img" aria-label={parts.map((p) => `${p.name} ${fmt(p.value)}`).join(', ')}>
          {arcs.map((d, i) => (
            <path
              key={parts[i]!.name}
              d={d}
              className="vbx-donut-arc"
              style={{ fill: parts[i]!.color }}
              data-dim={active !== null && active !== i ? '' : undefined}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onClick={pick && parts[i]!.index >= 0 ? () => pick(parts[i]!) : undefined}
              data-clickable={pick && parts[i]!.index >= 0 ? '' : undefined}
            />
          ))}
        </svg>
        <div className="vbx-donut-center">
          <span className="vbx-donut-total">{fmt(focus ? focus.value : total)}</span>
          <span className="vbx-donut-caption">{focus ? focus.name : (props.centerLabel ?? '')}</span>
        </div>
      </div>
      <PartsLegend parts={parts} fmt={fmt} lang={props.lang} active={active} onActive={setActive} onPick={pick} />
    </div>
  );
}

// -------------------------------------------------------------------- BarList

export interface BarListProps extends PartsProps {
  /** Show at most this many rows. */
  limit?: number;
  /** Sort descending by value. Default true. */
  sort?: boolean;
}

/** A ranking: name, amount, and a thin bar for scale. Reads faster than a chart for "top N". */
export function BarList(props: BarListProps): ReactElement {
  const { data, label = 'label', value = 'value', sort = true, limit, lang } = props;
  const rows = useMemo(() => {
    let list = data.map((d, index) => ({ name: String(d[label] ?? ''), value: toNumber(d[value]) ?? 0, index }));
    if (sort) list = [...list].sort((a, b) => b.value - a.value);
    return limit ? list.slice(0, limit) : list;
  }, [data, label, value, sort, limit]);
  const max = Math.max(0, ...rows.map((r) => r.value));
  const fmt = formatter(props.format, lang, max);
  if (!rows.length) return <div className="vbx-chart-empty">{props.emptyText ?? 'No data'}</div>;
  return (
    <ol className={props.className ? `vbx-barlist ${props.className}` : 'vbx-barlist'} style={props.style}>
      {rows.map((row, i) => (
        <li
          key={`${row.name}-${i}`}
          data-clickable={props.onSelect ? '' : undefined}
          onClick={props.onSelect ? () => props.onSelect!({ datum: data[row.index]!, index: row.index }) : undefined}
        >
          <span className="vbx-barlist-name" title={row.name}>
            {row.name}
          </span>
          <span className="vbx-barlist-value">{fmt(row.value)}</span>
          <span className="vbx-barlist-track">
            <span style={{ width: `${max ? Math.max(0, (row.value / max) * 100) : 0}%` }} />
          </span>
        </li>
      ))}
    </ol>
  );
}
