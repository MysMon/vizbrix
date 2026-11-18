import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { defineBrick, resolveData, type BrickDefinition } from '../react/brick';
import { buildTheme, readTokens } from './theme';

type Row = Readonly<Record<string, unknown>>;

/** The part of the ECharts module this adapter uses (`echarts` or `echarts/core`). */
export interface EChartsLibrary {
  init(
    dom: HTMLElement,
    theme?: object | string | null,
    opts?: { renderer?: 'canvas' | 'svg'; width?: number; height?: number },
  ): EChartsInstance;
}

/** The part of a chart instance this adapter uses. */
export interface EChartsInstance {
  setOption(option: object, opts?: { notMerge?: boolean; lazyUpdate?: boolean }): void;
  resize(): void;
  dispose(): void;
  on(event: string, handler: (params: EChartsEvent) => void): void;
}

export interface EChartsEvent {
  dataIndex?: number;
  seriesName?: string;
  name?: string;
  value?: unknown;
  data?: unknown;
}

export interface EChartSelection {
  datum: Row;
  index: number;
  series?: string;
}

export interface EChartProps {
  /** An ECharts option object, exactly as ECharts documents it. */
  option: Readonly<Record<string, unknown>>;
  /**
   * Rows to plot. Passed to ECharts as `dataset.source` unless the option
   * already defines a dataset, so series can use `encode` instead of
   * carrying their own data.
   */
  data?: readonly Row[];
  /**
   * `svg` (default) is crisp, prints well and is included in image export.
   * `canvas` is faster for very large series.
   */
  renderer?: 'svg' | 'canvas';
  /** A mark was clicked. `datum` is the dataset row when `data` is used, else what ECharts reports. */
  onSelect?: (selection: EChartSelection) => void;
  /** Receives the chart instance once created (and null when disposed), for anything this wrapper does not cover. */
  onChart?: (chart: EChartsInstance | null) => void;
  /** CSS height. Omit inside a sized parent — the chart fills it. */
  height?: number | string;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

export interface EChartsBrickProps {
  option?: Readonly<Record<string, unknown>>;
  /** Inline rows or the name of a dataset passed to `<Dashboard data>`. */
  data?: string | readonly Row[];
  renderer?: 'svg' | 'canvas';
}

const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The option as given, plus the dataset, accessibility description and motion preference. */
export function prepareOption(option: Readonly<Record<string, unknown>>, data: readonly Row[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { ...option };
  if (data && out.dataset === undefined) out.dataset = { source: data };
  if (out.aria === undefined) out.aria = { enabled: true };
  if (out.animation === undefined && reducedMotion()) out.animation = false;
  return out;
}

/**
 * Bind the adapter to an ECharts module. `vizbrix/echarts` does this with the
 * full `echarts` build; `vizbrix/echarts/core` exports this function so an
 * app can pass its own tree-shaken `echarts/core`.
 */
export function createECharts(library: EChartsLibrary): {
  EChart: (props: EChartProps) => ReactElement;
  echartsBrick: BrickDefinition<EChartsBrickProps>;
} {
  function EChart(props: EChartProps): ReactElement {
    const { option, data, renderer = 'svg' } = props;
    const host = useRef<HTMLDivElement>(null);
    const chart = useRef<EChartsInstance | null>(null);
    const latest = useRef(props);
    latest.current = props;
    // Changes whenever the resolved theme tokens change (theme switch, OS scheme, custom properties).
    const [themeKey, setThemeKey] = useState('');

    // Follow the theme: ECharts cannot read CSS variables, so re-read them when anything that can change them does.
    useEffect(() => {
      const node = host.current;
      if (!node) return;
      const sync = (): void => setThemeKey(JSON.stringify(readTokens(node)));
      sync();
      const observer = new MutationObserver(sync);
      for (let el: Element | null = node; el; el = el.parentElement) {
        observer.observe(el, { attributes: true, attributeFilter: ['data-vbx-theme', 'class', 'style'] });
      }
      const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
      media?.addEventListener('change', sync);
      return () => {
        observer.disconnect();
        media?.removeEventListener('change', sync);
      };
    }, []);

    // Create the chart; recreate it when the theme or renderer changes.
    useEffect(() => {
      const node = host.current;
      if (!node || !themeKey) return;
      const instance = library.init(node, buildTheme(JSON.parse(themeKey)), { renderer });
      chart.current = instance;
      instance.setOption(prepareOption(latest.current.option, latest.current.data), { notMerge: true });
      instance.on('click', (params) => {
        const { onSelect, data: rows } = latest.current;
        if (!onSelect || typeof params.dataIndex !== 'number') return;
        const row = rows?.[params.dataIndex];
        const datum: Row =
          row ??
          (params.data && typeof params.data === 'object' && !Array.isArray(params.data)
            ? (params.data as Row)
            : { name: params.name, value: params.value });
        onSelect({ datum, index: params.dataIndex, series: params.seriesName });
      });
      latest.current.onChart?.(instance);

      let frame = 0;
      const observer =
        typeof ResizeObserver === 'undefined'
          ? null
          : new ResizeObserver(() => {
              cancelAnimationFrame(frame);
              frame = requestAnimationFrame(() => instance.resize());
            });
      observer?.observe(node);
      return () => {
        cancelAnimationFrame(frame);
        observer?.disconnect();
        chart.current = null;
        latest.current.onChart?.(null);
        instance.dispose();
      };
    }, [themeKey, renderer]);

    // Apply option and data changes to the live chart.
    useEffect(() => {
      chart.current?.setOption(prepareOption(option, data), { notMerge: true });
    }, [option, data]);

    return (
      <div
        ref={host}
        className={props.className ? `vbx-echart ${props.className}` : 'vbx-echart'}
        style={{ ...props.style, ...(props.height !== undefined ? { height: props.height } : {}) }}
        role="img"
        aria-label={props.ariaLabel}
        data-clickable={props.onSelect ? '' : undefined}
      />
    );
  }

  const echartsBrick = defineBrick<EChartsBrickProps>({
    label: 'ECharts',
    description: 'Any Apache ECharts chart, from an option object',
    defaults: {
      w: 600,
      h: 340,
      minW: 240,
      minH: 180,
      title: 'ECharts',
      props: {
        option: {
          tooltip: {},
          series: [
            {
              type: 'treemap',
              roam: false,
              nodeClick: false,
              data: [
                { name: 'A', value: 40 },
                { name: 'B', value: 26 },
                { name: 'C', value: 18 },
                { name: 'D', value: 10 },
                { name: 'E', value: 6 },
              ],
            },
          ],
        },
      },
    },
    settings: [
      { key: 'data', type: 'dataset', shape: 'rows' },
      { key: 'option', type: 'json', label: 'ECharts option (JSON)' },
    ],
    render: ({ props, data, item, emit }) => {
      const rows = resolveData<unknown>(props.data, data);
      return (
        <EChart
          option={props.option ?? {}}
          data={Array.isArray(rows) ? (rows as Row[]) : undefined}
          renderer={props.renderer}
          ariaLabel={item.title}
          onSelect={emit}
        />
      );
    },
  });

  return { EChart, echartsBrick };
}
