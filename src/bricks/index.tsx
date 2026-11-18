import type { ReactElement } from 'react';
import {
  AreaChart,
  BarChart,
  BarList,
  DataTable,
  DonutChart,
  FunnelChart,
  Heatmap,
  LineChart,
  Meter,
  ScatterChart,
  SegmentedBar,
  StatTile,
  type BarChartProps,
  type BarListProps,
  type Column,
  type DonutChartProps,
  type FunnelChartProps,
  type HeatmapProps,
  type LineChartProps,
  type MeterProps,
  type ScatterChartProps,
  type StatTileProps,
} from 'vizbrix/charts';
import { defineBrick, resolveData, type BrickDefinition, type BrickRegistry } from '../react/brick';

/**
 * The built-in bricks. Each one is a thin, serializable configuration over a
 * `vizbrix/charts` component: its props are plain JSON, and `data` is either
 * inline rows or the *name* of a dataset passed to `<Dashboard data={…}>`.
 *
 * This module is server-safe (no hooks); the interactive components it
 * renders live behind the `vizbrix/charts` client boundary.
 */

type Rows = readonly Readonly<Record<string, unknown>>[];
type DataRef = string | Rows;

const rowsOf = (ref: DataRef | undefined, data: Readonly<Record<string, unknown>>): Rows => {
  const resolved = resolveData<unknown>(ref, data);
  return Array.isArray(resolved) ? (resolved as Rows) : [];
};

/** Props that may come inline or from a named dataset object, inline winning. */
function merged<T extends object>(props: T & { data?: string }, data: Readonly<Record<string, unknown>>): T {
  const source = typeof props.data === 'string' ? data[props.data] : undefined;
  return source && typeof source === 'object' && !Array.isArray(source) ? { ...(source as T), ...props } : props;
}

const icon = (path: ReactElement): ReactElement => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);

export type StatBrickProps = Omit<StatTileProps, 'lang' | 'className' | 'style' | 'value'> & {
  value?: StatTileProps['value'];
  /** Name of a dataset object providing `value`, `delta`, `trend`… */
  data?: string;
};

export const stat = defineBrick<StatBrickProps>({
  label: 'Stat',
  description: 'A headline number with change and trend',
  icon: icon(<path d="M3 13.5h2.5V9H3v4.5ZM7.75 13.5h2.5v-9h-2.5v9ZM12.5 13.5H15V7h-2.5v6.5Z" />),
  defaults: { w: 300, h: 144, minW: 160, minH: 96, title: 'Stat', props: { value: 0 } },
  render: ({ props, data, lang }) => {
    const p = merged(props, data);
    return <StatTile {...p} value={p.value} lang={lang} />;
  },
});

type ChartData<T> = Omit<T, 'data' | 'lang' | 'className' | 'style' | 'height'> & { data?: DataRef };

export type LineBrickProps = ChartData<LineChartProps>;

const SAMPLE_SERIES = [
  { month: 'Jan', value: 42 },
  { month: 'Feb', value: 48 },
  { month: 'Mar', value: 45 },
  { month: 'Apr', value: 58 },
  { month: 'May', value: 64 },
  { month: 'Jun', value: 71 },
];

export const line = defineBrick<LineBrickProps>({
  label: 'Line chart',
  description: 'Change over time, one or more series',
  icon: icon(<path d="M2.5 12.5 6.5 8l3 2.5 5.5-6" />),
  defaults: { w: 600, h: 320, minW: 240, minH: 180, title: 'Line chart', props: { data: SAMPLE_SERIES, x: 'month', series: ['value'] } },
  render: ({ props, data, lang }) => <LineChart {...props} data={rowsOf(props.data, data)} lang={lang} />,
});

export const area = defineBrick<LineBrickProps>({
  label: 'Area chart',
  description: 'A line with volume, optionally stacked',
  icon: icon(<path d="M2.5 14.5v-3l4-4.5 3 2.5 6-6v11h-13Z" />),
  defaults: { w: 600, h: 320, minW: 240, minH: 180, title: 'Area chart', props: { data: SAMPLE_SERIES, x: 'month', series: ['value'] } },
  render: ({ props, data, lang }) => <AreaChart {...props} data={rowsOf(props.data, data)} lang={lang} />,
});

export type BarBrickProps = ChartData<BarChartProps>;

export const bar = defineBrick<BarBrickProps>({
  label: 'Bar chart',
  description: 'Compare categories, grouped or stacked',
  icon: icon(<path d="M4 14.5V8M9 14.5v-11M14 14.5V6" />),
  defaults: { w: 600, h: 320, minW: 240, minH: 180, title: 'Bar chart', props: { data: SAMPLE_SERIES, x: 'month', series: ['value'] } },
  render: ({ props, data, lang }) => <BarChart {...props} data={rowsOf(props.data, data)} lang={lang} />,
});

const SAMPLE_PARTS = [
  { label: 'Direct', value: 46 },
  { label: 'Search', value: 31 },
  { label: 'Referral', value: 15 },
  { label: 'Social', value: 8 },
];

export type DonutBrickProps = ChartData<DonutChartProps>;

export const donut = defineBrick<DonutBrickProps>({
  label: 'Donut',
  description: 'Share of a whole, for a few parts',
  icon: icon(
    <>
      <circle cx="9" cy="9" r="6.5" />
      <circle cx="9" cy="9" r="2.75" />
    </>,
  ),
  defaults: { w: 400, h: 280, minW: 220, minH: 180, title: 'Breakdown', props: { data: SAMPLE_PARTS } },
  render: ({ props, data, lang }) => <DonutChart {...props} data={rowsOf(props.data, data)} lang={lang} />,
});

export type SegmentedBrickProps = ChartData<DonutChartProps>;

export const segmented = defineBrick<SegmentedBrickProps>({
  label: 'Segmented bar',
  description: 'One whole split into parts, compact',
  icon: icon(<path d="M2.5 9h4M8 9h4.5M14 9h1.5" strokeWidth="3" />),
  defaults: { w: 400, h: 200, minW: 220, minH: 140, title: 'Breakdown', props: { data: SAMPLE_PARTS } },
  render: ({ props, data, lang }) => <SegmentedBar {...props} data={rowsOf(props.data, data)} lang={lang} />,
});

export type BarListBrickProps = ChartData<BarListProps>;

export const barlist = defineBrick<BarListBrickProps>({
  label: 'Ranking',
  description: 'Top items with amounts',
  icon: icon(<path d="M3 4.5h12M3 9h8M3 13.5h5" />),
  defaults: { w: 400, h: 280, minW: 200, minH: 140, title: 'Ranking', props: { data: SAMPLE_PARTS } },
  render: ({ props, data, lang }) => <BarList {...props} data={rowsOf(props.data, data)} lang={lang} />,
});

export type ScatterBrickProps = ChartData<ScatterChartProps>;

const SAMPLE_POINTS = [
  { name: 'A', spend: 12, revenue: 38 },
  { name: 'B', spend: 18, revenue: 44 },
  { name: 'C', spend: 25, revenue: 71 },
  { name: 'D', spend: 31, revenue: 69 },
  { name: 'E', spend: 40, revenue: 96 },
];

export const scatter = defineBrick<ScatterBrickProps>({
  label: 'Scatter plot',
  description: 'How two measures relate',
  icon: icon(
    <>
      <circle cx="5" cy="12" r="1.25" />
      <circle cx="8.5" cy="8.5" r="1.25" />
      <circle cx="12" cy="10" r="1.25" />
      <circle cx="13.5" cy="5" r="1.25" />
    </>,
  ),
  defaults: { w: 600, h: 340, minW: 260, minH: 200, title: 'Scatter plot', props: { data: SAMPLE_POINTS, x: 'spend', y: 'revenue', label: 'name' } },
  render: ({ props, data, lang }) => <ScatterChart {...props} data={rowsOf(props.data, data)} lang={lang} />,
});

export type HeatmapBrickProps = ChartData<HeatmapProps>;

const SAMPLE_GRID = ['Mon', 'Tue', 'Wed'].flatMap((day, r) =>
  ['AM', 'Noon', 'PM', 'Night'].map((slot, c) => ({ day, slot, value: ((r + 2) * (c + 3) * 7) % 40 })),
);

export const heatmap = defineBrick<HeatmapBrickProps>({
  label: 'Heatmap',
  description: 'Magnitude across two categories',
  icon: icon(<path d="M3 3h3.5v3.5H3zM7.5 3H11v3.5H7.5zM12 3h3v3.5h-3zM3 7.5h3.5V11H3zM7.5 7.5H11V11H7.5zM12 7.5h3V11h-3zM3 12h3.5v3H3zM7.5 12H11v3H7.5zM12 12h3v3h-3z" strokeWidth="1" />),
  defaults: { w: 600, h: 300, minW: 240, minH: 160, title: 'Heatmap', props: { data: SAMPLE_GRID, x: 'slot', y: 'day', value: 'value' } },
  render: ({ props, data, lang }) => <Heatmap {...props} data={rowsOf(props.data, data)} lang={lang} />,
});

export type FunnelBrickProps = ChartData<FunnelChartProps>;

const SAMPLE_STAGES = [
  { label: 'Visits', value: 12400 },
  { label: 'Sign-ups', value: 3100 },
  { label: 'Trials', value: 1240 },
  { label: 'Paid', value: 410 },
];

export const funnel = defineBrick<FunnelBrickProps>({
  label: 'Funnel',
  description: 'Stages and the conversion between them',
  icon: icon(<path d="M3 4.5h12M3 9h8.5M3 13.5h4.5" strokeWidth="2.5" />),
  defaults: { w: 400, h: 280, minW: 220, minH: 160, title: 'Funnel', props: { data: SAMPLE_STAGES } },
  render: ({ props, data, lang }) => <FunnelChart {...props} data={rowsOf(props.data, data)} lang={lang} />,
});

export type MeterBrickProps = Omit<MeterProps, 'lang' | 'className' | 'style' | 'value'> & {
  value?: number;
  data?: string;
};

export const meter = defineBrick<MeterBrickProps>({
  label: 'Meter',
  description: 'Progress toward a target',
  icon: icon(<path d="M2.5 9h13M2.5 9h7" strokeWidth="3" />),
  defaults: { w: 300, h: 144, minW: 160, minH: 96, title: 'Progress', props: { value: 0.62 } },
  render: ({ props, data, lang }) => {
    const p = merged(props, data);
    return <Meter {...p} value={p.value ?? 0} lang={lang} />;
  },
});

export interface TableBrickProps {
  data?: DataRef;
  columns?: readonly (Column | string)[];
  rowHeight?: number;
  sortable?: boolean;
  emptyText?: string;
}

export const table = defineBrick<TableBrickProps>({
  label: 'Table',
  description: 'Sortable rows; handles large datasets',
  icon: icon(
    <>
      <rect x="2.5" y="3.5" width="13" height="11" rx="1.5" />
      <path d="M2.5 7.5h13M2.5 11h13M7 7.5v7" />
    </>,
  ),
  flush: true,
  defaults: { w: 600, h: 320, minW: 240, minH: 160, title: 'Table', props: { data: SAMPLE_SERIES } },
  render: ({ props, data, lang, item }) => (
    <DataTable {...props} data={rowsOf(props.data, data)} lang={lang} ariaLabel={item.title} />
  ),
});

export interface TextBrickProps {
  /** Plain text. Blank lines separate paragraphs. */
  text?: string;
  /** `heading` renders a section title. */
  variant?: 'body' | 'heading';
  align?: 'left' | 'center' | 'right';
}

export const text = defineBrick<TextBrickProps>({
  label: 'Text',
  description: 'A heading or a note between bricks',
  icon: icon(<path d="M3.5 5V3.5h11V5M9 3.5v11M7 14.5h4" />),
  chrome: 'bare',
  defaults: { w: 400, h: 64, minW: 120, minH: 40, props: { text: 'Section title', variant: 'heading' } },
  render: ({ props }) => {
    const paragraphs = (props.text ?? '').split(/\n{2,}/).filter(Boolean);
    return (
      <div className="vbx-text" data-variant={props.variant ?? 'body'} style={{ textAlign: props.align }}>
        {props.variant === 'heading' ? <h2>{props.text}</h2> : paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      </div>
    );
  },
});

/** Every built-in brick, ready to pass to `<Dashboard bricks={…}>` or to extend. */
export const builtinBricks = { stat, line, area, bar, scatter, heatmap, funnel, donut, segmented, barlist, meter, table, text } satisfies BrickRegistry;

/**
 * Relabel bricks for another language without redefining them:
 * `withLabels(builtinBricks, brickLabelsJa)`.
 */
export function withLabels<R extends BrickRegistry>(
  registry: R,
  labels: Readonly<Record<string, { label?: string; description?: string; title?: string }>>,
): R {
  const out: Record<string, BrickDefinition<never>> = {};
  for (const type of Object.keys(registry)) {
    const def = registry[type] as BrickDefinition<never>;
    const l = labels[type];
    out[type] = l
      ? {
          ...def,
          label: l.label ?? def.label,
          description: l.description ?? def.description,
          defaults: l.title !== undefined && def.defaults?.title !== undefined ? { ...def.defaults, title: l.title } : def.defaults,
        }
      : def;
  }
  return out as unknown as R;
}

export { defineBrick, resolveData } from '../react/brick';
export type { BrickContext, BrickDefinition, BrickRegistry, DataMap } from '../react/brick';
