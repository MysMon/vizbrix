// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BarChart, DataTable, DonutChart, FunnelChart, Heatmap, LineChart, Meter, ScatterChart, StatTile } from '../charts';
import { createDashboard } from '../core/doc';
import { brickLabelsJa } from '../locales/ja';
import { Dashboard } from '../react/Dashboard';
import { DashboardStatic } from '../react/Static';
import { builtinBricks, withLabels } from './index';

afterEach(cleanup);

// jsdom has no layout engine: report a fixed box so charts have a size to draw into.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 300 });
});

const months = ['Jan', 'Feb', 'Mar', 'Apr'];
const rows = months.map((month, i) => ({ month, a: 10 + i * 5, b: 40 - i * 3 }));

describe('LineChart', () => {
  it('draws one path per series, a legend, and nice y ticks', () => {
    const { container } = render(<LineChart data={rows} x="month" series={['a', { key: 'b', label: 'Beta' }]} lang="en" />);
    expect(container.querySelectorAll('path.vbx-line')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Beta' })).toBeTruthy();
    const ticks = [...container.querySelectorAll('text.vbx-tick')].map((t) => t.textContent);
    expect(ticks).toEqual(expect.arrayContaining(['10', '20', '30', '40', 'Jan', 'Apr']));
  });

  it('keeps series colours when another series is hidden', () => {
    const { container } = render(<LineChart data={rows} x="month" series={['a', 'b']} />);
    fireEvent.click(screen.getByRole('button', { name: 'a' }));
    const lines = container.querySelectorAll<SVGPathElement>('path.vbx-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.style.stroke).toBe('var(--vbx-series-2)');
    // The last visible series cannot be hidden.
    fireEvent.click(screen.getByRole('button', { name: 'b' }));
    expect(container.querySelectorAll('path.vbx-line')).toHaveLength(1);
  });

  it('reads every series at a position from the keyboard', () => {
    render(<LineChart data={rows} x="month" series={['a', 'b']} lang="en" />);
    const plot = screen.getByRole('group');
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    const tip = screen.getByRole('status');
    expect(tip.textContent).toContain('Feb');
    expect(tip.textContent).toContain('15');
    expect(tip.textContent).toContain('37');
    fireEvent.keyDown(plot, { key: 'Escape' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('sorts time data, breaks lines at gaps and offers a table twin', () => {
    const data = [
      { t: new Date(2026, 0, 3), v: 3 },
      { t: new Date(2026, 0, 1), v: 1 },
      { t: new Date(2026, 0, 2), v: null },
      { t: new Date(2026, 0, 4), v: 4 },
    ];
    const { container } = render(<LineChart data={data} x="t" series={['v']} lang="en" />);
    expect(container.querySelector('path.vbx-line')!.getAttribute('d')!.match(/M/g)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
    const cells = [...container.querySelectorAll('tbody tr')].map((tr) => tr.lastElementChild!.textContent);
    expect(cells).toEqual(['1', '–', '3', '4']);
  });

  it('downsamples large series to the pixels available', () => {
    const big = Array.from({ length: 50000 }, (_, i) => ({ i, v: Math.sin(i / 100) }));
    const { container } = render(<LineChart data={big} x="i" series={['v']} />);
    const points = container.querySelector('path.vbx-line')!.getAttribute('d')!.split('L').length;
    expect(points).toBeLessThan(1300);
    expect(points).toBeGreaterThan(500);
  });

  it('shows an empty state instead of an empty axis', () => {
    render(<LineChart data={[]} x="month" series={['a']} emptyText="Nothing yet" />);
    expect(screen.getByText('Nothing yet')).toBeTruthy();
  });
});

describe('BarChart', () => {
  it('draws grouped bars capped at 24px and stacked bars from a zero baseline', () => {
    const grouped = render(<BarChart data={rows} x="month" series={['a', 'b']} />);
    expect(grouped.container.querySelectorAll('.vbx-plot svg path')).toHaveLength(8);
    const d = grouped.container.querySelector('.vbx-plot svg path')!.getAttribute('d')!;
    const xs = [...d.matchAll(/[MLQ ](-?[\d.]+),/g)].map((m) => Number(m[1]));
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(24.01);
    grouped.unmount();

    const stacked = render(<BarChart data={rows} x="month" series={['a', 'b']} stacked lang="en" />);
    const ticks = [...stacked.container.querySelectorAll('text.vbx-tick')].map((t) => t.textContent);
    expect(ticks).toContain('60'); // 10+40 rounds up to a 60 axis
    expect(ticks).toContain('0');
  });

  it('shows the hovered category with every series', () => {
    render(<BarChart data={rows} x="month" series={['a', 'b']} horizontal lang="en" />);
    const plot = screen.getByRole('group');
    fireEvent.keyDown(plot, { key: 'ArrowDown' });
    expect(screen.getByRole('status').textContent).toMatch(/Jan.*a.*10.*b.*40/);
  });
});

describe('combo, scatter, heatmap, funnel', () => {
  it('BarChart overlays line series on the same axis and keys them as lines', () => {
    const data = rows.map((r) => ({ ...r, target: 80 }));
    const { container } = render(<BarChart data={data} x="month" series={['a', 'b']} lines={['target']} stacked lang="en" />);
    expect(container.querySelectorAll('.vbx-plot path.vbx-line')).toHaveLength(1);
    expect(container.querySelector<SVGPathElement>('.vbx-plot path.vbx-line')!.style.stroke).toBe('var(--vbx-series-3)');
    // The axis grows to include the line (stack max is 50, target is 80).
    expect([...container.querySelectorAll('text.vbx-tick')].map((t) => t.textContent)).toContain('80');
    const swatch = screen.getByRole('button', { name: 'target' }).querySelector('.vbx-swatch')!;
    expect(swatch.getAttribute('data-shape')).toBe('line');
    fireEvent.keyDown(screen.getByRole('group'), { key: 'ArrowRight' });
    expect(screen.getByRole('status').textContent).toMatch(/target.*80/);
  });

  it('ScatterChart colours by group, sizes bubbles by area and reads points from the keyboard', () => {
    const data = [
      { name: 'p1', x: 1, y: 10, g: 'A', s: 100 },
      { name: 'p2', x: 5, y: 30, g: 'B', s: 25 },
      { name: 'p3', x: 9, y: 20, g: 'A', s: 0 },
      { name: 'bad', x: 'n/a', y: 1, g: 'A', s: 1 },
    ];
    const { container } = render(<ScatterChart data={data} x="x" y="y" group="g" label="name" size="s" lang="en" />);
    const dots = [...container.querySelectorAll<SVGCircleElement>('circle.vbx-dot')];
    expect(dots).toHaveLength(3);
    expect(dots.map((d) => d.style.fill)).toEqual(['var(--vbx-series-1)', 'var(--vbx-series-2)', 'var(--vbx-series-1)']);
    expect(dots.map((d) => Number(d.getAttribute('r')))).toEqual([16, 9.5, 3]);
    const plot = screen.getByRole('group');
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    expect(screen.getByRole('status').textContent).toMatch(/p2.*B.*x.*5.*y.*30/);
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    expect(container.querySelectorAll('circle.vbx-dot')).toHaveLength(1);
  });

  it('Heatmap maps values onto one ramp, honours explicit order and reads cells', () => {
    const data = [
      { d: 'Mon', h: 'AM', v: 0 },
      { d: 'Mon', h: 'PM', v: 50 },
      { d: 'Tue', h: 'PM', v: 100 },
    ];
    const { container } = render(<Heatmap data={data} x="h" y="d" value="v" yOrder={['Tue', 'Mon']} labels lang="en" />);
    const cells = [...container.querySelectorAll<HTMLElement>('.vbx-heatmap-cell')];
    expect(cells).toHaveLength(4);
    expect(cells.map((c) => c.style.getPropertyValue('--t'))).toEqual(['', '100.0%', '0.0%', '50.0%']);
    expect(cells[0]!.hasAttribute('data-empty')).toBe(true);
    expect(cells[1]!.getAttribute('data-ink')).toBe('on-high');
    expect(cells[3]!.textContent).toBe('50');
    const grid = screen.getByRole('group');
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    expect(screen.getByRole('status').textContent).toBe('Tue · PM100');
    expect(container.querySelector('.vbx-heatmap-scale')!.textContent).toBe('0100');
  });

  it('FunnelChart sizes bars against the first stage and shows step conversion', () => {
    const data = [
      { label: 'Visits', value: 48200 },
      { label: 'Leads', value: 9640 },
      { label: 'Won', value: 0 },
    ];
    const { container } = render(<FunnelChart data={data} lang="en" />);
    const widths = [...container.querySelectorAll<HTMLElement>('.vbx-funnel-track > span')].map((s) => s.style.width);
    expect(widths).toEqual(['100%', '20%', '0%']);
    expect([...container.querySelectorAll('.vbx-funnel-value')].map((n) => n.textContent)).toEqual(['48,200', '9,640', '0']);
    expect([...container.querySelectorAll('.vbx-funnel-rate')].map((n) => n.textContent)).toEqual(['', '20%', '0%']);
  });
});

describe('figures', () => {
  it('StatTile colours the delta by direction and whether up is good', () => {
    const up = render(<StatTile label="Revenue" value={12900} delta={0.12} deltaLabel="vs last month" lang="en" />);
    expect(up.container.querySelector('.vbx-stat-value')!.textContent).toBe('12.9K');
    expect(up.container.querySelector('.vbx-stat-delta')!.getAttribute('data-tone')).toBe('good');
    expect(up.container.querySelector('.vbx-stat-delta')!.textContent).toBe('+12%');
    up.unmount();
    const churn = render(<StatTile value={0.02} format="percent" delta={0.004} upIsGood={false} lang="en" />);
    expect(churn.container.querySelector('.vbx-stat-delta')!.getAttribute('data-tone')).toBe('bad');
  });

  it('Meter exposes its value to assistive tech and clamps the fill', () => {
    const { container } = render(<Meter label="Quota" value={150} max={100} lang="en" />);
    const meter = screen.getByRole('meter', { name: 'Quota' });
    expect(meter.getAttribute('aria-valuenow')).toBe('150');
    expect(container.querySelector<HTMLElement>('.vbx-meter-fill')!.style.width).toBe('100%');
  });

  it('DonutChart folds the tail past eight parts into Other', () => {
    const data = Array.from({ length: 11 }, (_, i) => ({ label: `P${i}`, value: 11 - i }));
    const { container } = render(<DonutChart data={data} lang="en" />);
    expect(container.querySelectorAll('.vbx-donut-arc')).toHaveLength(8);
    const names = [...container.querySelectorAll('.vbx-parts-name')].map((n) => n.textContent);
    expect(names[7]).toBe('Other');
    expect(container.querySelector('.vbx-donut-total')!.textContent).toBe('66');
  });
});

describe('DataTable', () => {
  const data = Array.from({ length: 5000 }, (_, i) => ({ name: `Row ${i}`, amount: (i * 37) % 1000 }));

  it('mounts only the rows in view and windows on scroll', () => {
    const { container } = render(<DataTable data={data} lang="en" />);
    const wrap = container.querySelector<HTMLElement>('.vbx-table-wrap')!;
    expect(container.querySelectorAll('tbody tr[aria-rowindex]').length).toBeLessThan(40);
    expect(screen.getByText('Row 0')).toBeTruthy();
    act(() => {
      wrap.scrollTop = 36 * 3000;
      fireEvent.scroll(wrap);
    });
    expect(screen.getByText('Row 3000')).toBeTruthy();
    expect(screen.queryByText('Row 0')).toBeNull();
    expect(container.querySelector('table')!.getAttribute('aria-rowcount')).toBe('5001');
  });

  it('sorts ascending, descending, then back to source order', () => {
    const { container } = render(<DataTable data={data} lang="en" />);
    const first = (): string => container.querySelector('tbody tr[aria-rowindex] td:last-child')!.textContent!;
    const header = screen.getByRole('button', { name: 'amount' });
    fireEvent.click(header);
    expect(first()).toBe('0');
    expect(header.closest('th')!.getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(header);
    expect(first()).toBe('999');
    fireEvent.click(header);
    expect(header.closest('th')!.hasAttribute('aria-sort')).toBe(false);
    expect(container.querySelector('td[data-align="right"]')).toBeTruthy();
  });
});

describe('built-in bricks', () => {
  const doc = createDashboard({
    items: [
      { id: 'kpi', type: 'stat', title: 'MRR', w: 300, h: 140, props: { data: 'mrr', format: 'currency:USD' } },
      { id: 'trend', type: 'line', title: 'Trend', w: 600, h: 300, props: { data: 'rows', x: 'month', series: ['a'] } },
      { id: 'inline', type: 'bar', title: 'Inline', w: 300, h: 300, props: { data: rows, x: 'month', series: ['b'] } },
      { id: 'tbl', type: 'table', title: 'Rows', w: 600, h: 300, props: { data: 'rows' } },
      { id: 'h', type: 'text', w: 600, h: 60, props: { text: 'Section', variant: 'heading' } },
    ],
  });
  const data = { rows, mrr: { value: 4200, delta: 0.05 } };

  it('bind named datasets and inline rows', () => {
    const { container } = render(<Dashboard defaultValue={doc} bricks={builtinBricks} data={data} />);
    expect(container.querySelector('.vbx-stat-value')!.textContent).toBe('$4,200.00');
    expect(container.querySelectorAll('path.vbx-line')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Section', level: 2 })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Rows' })).toBeTruthy();
    expect(container.querySelector('[data-chrome="bare"]')).toBeTruthy();
  });

  it('render on the server without a client runtime', () => {
    const html = renderToStaticMarkup(<DashboardStatic id="d" value={doc} bricks={builtinBricks} data={data} />);
    expect(html).toContain('$4,200.00');
    expect(html).toContain('Section');
    expect(html).toContain('class="vbx-plot"');
  });

  it('can be relabelled without redefining them', () => {
    const jaBricks = withLabels(builtinBricks, brickLabelsJa);
    expect(jaBricks.line.label).toBe('折れ線グラフ');
    expect(jaBricks.line.defaults!.title).toBe('折れ線グラフ');
    expect(jaBricks.line.render).toBe(builtinBricks.line.render);
    expect(builtinBricks.line.label).toBe('Line chart');
  });
});
