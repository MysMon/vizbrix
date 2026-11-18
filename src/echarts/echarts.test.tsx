// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDashboard } from '../core/doc';
import { Dashboard, type DashboardHandle } from '../react/Dashboard';
import { createECharts, prepareOption, type EChartsEvent, type EChartsInstance } from './create';
import { buildTheme, readTokens } from './theme';

afterEach(cleanup);

/** A stand-in for the ECharts module that records what the adapter asks of it. */
function fakeLibrary() {
  const instances: (EChartsInstance & {
    theme: Record<string, unknown>;
    renderer: string | undefined;
    options: Record<string, unknown>[];
    disposed: boolean;
    click(params: EChartsEvent): void;
  })[] = [];
  return {
    instances,
    init: vi.fn((_: HTMLElement, theme?: object | string | null, opts?: { renderer?: 'canvas' | 'svg' }) => {
      let handler: ((params: EChartsEvent) => void) | undefined;
      const instance = {
        theme: theme as Record<string, unknown>,
        renderer: opts?.renderer,
        options: [] as Record<string, unknown>[],
        disposed: false,
        setOption: (option: object) => void instance.options.push(option as Record<string, unknown>),
        resize: vi.fn(),
        dispose: () => void (instance.disposed = true),
        on: (_event: string, fn: (params: EChartsEvent) => void) => void (handler = fn),
        click: (params: EChartsEvent) => handler?.(params),
      };
      instances.push(instance);
      return instance;
    }),
  };
}

const rows = [
  { month: 'Jan', sales: 10 },
  { month: 'Feb', sales: 20 },
];

describe('EChart', () => {
  it('creates a themed SVG chart, feeds it the rows as a dataset, and disposes on unmount', () => {
    const lib = fakeLibrary();
    const { EChart } = createECharts(lib);
    const option = { xAxis: { type: 'category' }, yAxis: {}, series: [{ type: 'bar' }] };
    const view = render(<EChart option={option} data={rows} ariaLabel="Sales" />);
    expect(lib.init).toHaveBeenCalledTimes(1);
    const chart = lib.instances[0]!;
    expect(chart.renderer).toBe('svg');
    expect(chart.theme.color).toHaveLength(8);
    expect(chart.theme.backgroundColor).toBe('transparent');
    expect(chart.options.at(-1)).toMatchObject({ ...option, dataset: { source: rows }, aria: { enabled: true } });
    expect(screen.getByRole('img', { name: 'Sales' })).toBeTruthy();

    const next = { ...option, series: [{ type: 'line' }] };
    view.rerender(<EChart option={next} data={rows} ariaLabel="Sales" />);
    expect(lib.init).toHaveBeenCalledTimes(1);
    expect(chart.options.at(-1)).toMatchObject({ series: [{ type: 'line' }] });

    view.unmount();
    expect(chart.disposed).toBe(true);
  });

  it('recreates the chart when the theme changes', async () => {
    const lib = fakeLibrary();
    const { EChart } = createECharts(lib);
    // jsdom does not inherit custom properties, so the tokens are set on the chart element itself;
    // inheritance from an ancestor's data-vbx-theme is covered by the browser tests.
    const { container } = render(<EChart option={{}} style={{ ['--vbx-text' as string]: '#111111' }} />);
    const titleColor = (i: number): string => (lib.instances[i]!.theme.title as { textStyle: { color: string } }).textStyle.color;
    expect(titleColor(0)).toBe('#111111');
    const host = container.querySelector<HTMLElement>('.vbx-echart')!;
    await act(async () => {
      host.style.setProperty('--vbx-text', '#eeeeee');
      await Promise.resolve();
    });
    expect(lib.instances).toHaveLength(2);
    expect(lib.instances[0]!.disposed).toBe(true);
    expect(titleColor(1)).toBe('#eeeeee');
    // The current option is replayed on the new instance.
    expect(lib.instances[1]!.options).toHaveLength(1);
  });

  it('reports clicks with the dataset row, or what ECharts reports when there is no dataset', () => {
    const lib = fakeLibrary();
    const { EChart } = createECharts(lib);
    const onSelect = vi.fn();
    const view = render(<EChart option={{}} data={rows} onSelect={onSelect} />);
    lib.instances[0]!.click({ dataIndex: 1, seriesName: 'Sales' });
    expect(onSelect).toHaveBeenLastCalledWith({ datum: rows[1], index: 1, series: 'Sales' });
    lib.instances[0]!.click({});
    expect(onSelect).toHaveBeenCalledTimes(1);

    view.rerender(<EChart option={{}} onSelect={onSelect} />);
    lib.instances[0]!.click({ dataIndex: 0, name: 'A', value: 40, data: { name: 'A', value: 40 } });
    expect(onSelect).toHaveBeenLastCalledWith({ datum: { name: 'A', value: 40 }, index: 0, series: undefined });
    lib.instances[0]!.click({ dataIndex: 2, name: 'B', value: [1, 2], data: [1, 2] });
    expect(onSelect).toHaveBeenLastCalledWith({ datum: { name: 'B', value: [1, 2] }, index: 2, series: undefined });
  });

  it('leaves an explicit dataset, aria and animation setting alone', () => {
    const own = { dataset: { source: [[1, 2]] }, aria: { enabled: false }, animation: true };
    expect(prepareOption(own, rows)).toEqual(own);
    expect(prepareOption({}, undefined)).toEqual({ aria: { enabled: true } });
  });
});

describe('theme', () => {
  it('reads custom properties and falls back to the default palette', () => {
    const el = document.createElement('div');
    el.style.setProperty('--vbx-series-1', '#123456');
    el.style.setProperty('--vbx-grid', 'rgb(1, 2, 3)');
    document.body.appendChild(el);
    const tokens = readTokens(el);
    expect(tokens.series[0]).toBe('#123456');
    expect(tokens.series[1]).toBe('#eb6834');
    expect(tokens.grid).toBe('rgb(1, 2, 3)');
    const theme = buildTheme(tokens) as { color: string[]; valueAxis: { splitLine: { lineStyle: { color: string } } } };
    expect(theme.color[0]).toBe('#123456');
    expect(theme.valueAxis.splitLine.lineStyle.color).toBe('rgb(1, 2, 3)');
    el.remove();
  });
});

describe('echartsBrick', () => {
  it('renders in a dashboard, binds a named dataset and is editable as JSON', () => {
    const lib = fakeLibrary();
    const { echartsBrick } = createECharts(lib);
    const doc = createDashboard({
      items: [{ id: 'e', type: 'echarts', title: 'Flow', w: 600, h: 300, props: { data: 'rows', option: { series: [{ type: 'bar' }] } } }],
    });
    const onSelect = vi.fn();
    const ref = createRef<DashboardHandle>();
    render(<Dashboard ref={ref} defaultValue={doc} bricks={{ echarts: echartsBrick }} data={{ rows }} onSelect={onSelect} editable />);
    expect(lib.instances[0]!.options.at(-1)).toMatchObject({ dataset: { source: rows }, series: [{ type: 'bar' }] });
    lib.instances[0]!.click({ dataIndex: 0 });
    expect(onSelect).toHaveBeenCalledWith({ datum: rows[0], index: 0, series: undefined, item: expect.objectContaining({ id: 'e' }) });

    act(() => ref.current!.setEditing(true));
    act(() => ref.current!.inspect('e'));
    const editor = within(screen.getByRole('complementary')).getByLabelText('ECharts option (JSON)') as HTMLTextAreaElement;
    expect(JSON.parse(editor.value)).toEqual({ series: [{ type: 'bar' }] });

    // Invalid JSON is flagged and not applied; valid JSON is applied.
    fireEvent.change(editor, { target: { value: '{ "series": [' } });
    expect(editor.getAttribute('aria-invalid')).toBe('true');
    expect(ref.current!.getValue().items[0]!.props!.option).toEqual({ series: [{ type: 'bar' }] });
    fireEvent.change(editor, { target: { value: '{ "series": [{ "type": "line" }] }' } });
    expect(editor.getAttribute('aria-invalid')).toBe('false');
    expect(ref.current!.getValue().items[0]!.props!.option).toEqual({ series: [{ type: 'line' }] });
    expect(lib.instances.at(-1)!.options.at(-1)).toMatchObject({ series: [{ type: 'line' }] });
  });
});
