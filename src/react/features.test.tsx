// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { builtinBricks } from '../bricks';
import { BarChart, DataTable, LineChart } from '../charts';
import { buildHref } from '../charts/DataTable';
import { createDashboard } from '../core/doc';
import { alignRects, nearestFreeRect, resolveOverlap } from '../core/ops';
import { createDashboardStore } from '../core/store';
import { ja } from '../locales/ja';
import { Dashboard, type DashboardHandle } from './Dashboard';
import { brickRows, toCsv } from './export';
import { DashboardStatic } from './Static';

afterEach(cleanup);

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 300 });
});

const rows = ['Jan', 'Feb', 'Mar', 'Apr'].map((month, i) => ({ month, a: 10 + i * 5, b: 40 - i * 3, name: `n${i}` }));
const doc = () =>
  createDashboard({
    gap: 0,
    items: [
      { id: 'bar', type: 'bar', title: 'Bars', x: 0, y: 0, w: 600, h: 300, props: { data: 'rows', x: 'month', series: ['a'] } },
      { id: 'kpi', type: 'stat', title: 'KPI', x: 600, y: 0, w: 600, h: 300, props: { data: 'kpi' } },
    ],
  });
const data = { rows, other: [{ k: 'x', v: 1 }], kpi: { value: 42, delta: 0.1 } };
const item = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-vbx-item="${id}"]`)!;

describe('settings panel', () => {
  const setup = () => {
    const ref = createRef<DashboardHandle>();
    render(<Dashboard ref={ref} defaultValue={doc()} bricks={builtinBricks} data={data} editable defaultEditing />);
    return ref;
  };

  it('opens from the brick menu and edits props live, as one undo step per field', () => {
    const ref = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Brick options: Bars' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit…' }));
    const panel = screen.getByRole('complementary', { name: 'Settings: Bars' });

    // Only row datasets are offered; object-shaped ones are not.
    const dataset = within(panel).getByLabelText('Data') as HTMLSelectElement;
    expect([...dataset.options].map((o) => o.value)).toEqual(['rows', 'other']);
    // Series offers numeric columns only.
    const series = within(panel).getByRole('group', { name: 'Series' });
    expect(within(series).getAllByRole('checkbox').map((c) => (c as HTMLInputElement).checked)).toEqual([true, false]);
    expect(within(series).queryByLabelText('month')).toBeNull();

    fireEvent.click(within(series).getByLabelText('b'));
    fireEvent.click(within(panel).getByLabelText('Stacked'));
    fireEvent.change(within(panel).getByLabelText('Number format'), { target: { value: 'percent' } });
    expect(ref.current!.getValue().items[0]!.props).toEqual({
      data: 'rows',
      x: 'month',
      series: ['a', 'b'],
      stacked: true,
      yFormat: 'percent',
    });
    expect(item('bar').querySelectorAll('.vbx-legend-item')).toHaveLength(2);

    fireEvent.click(within(panel).getByLabelText('Stacked'));
    expect(ref.current!.getValue().items[0]!.props).not.toHaveProperty('stacked');
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('opens for a newly added brick and closes when the brick or edit mode goes away', () => {
    const ref = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Funnel/ }));
    expect(screen.getByRole('complementary', { name: 'Settings: Funnel' })).toBeTruthy();
    act(() => ref.current!.store.remove());
    expect(screen.queryByRole('complementary')).toBeNull();

    act(() => ref.current!.inspect('kpi'));
    expect(screen.getByRole('complementary', { name: 'Settings: KPI' })).toBeTruthy();
    act(() => ref.current!.setEditing(false));
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('hands over to onEditItem when the app provides its own UI', () => {
    const onEditItem = vi.fn();
    render(<Dashboard defaultValue={doc()} bricks={builtinBricks} data={data} editable defaultEditing onEditItem={onEditItem} />);
    fireEvent.click(screen.getByRole('button', { name: 'Brick options: Bars' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit…' }));
    expect(onEditItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'bar' }));
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

describe('loading and error states', () => {
  it('shows a placeholder until data arrives, then dims the previous render while refetching', () => {
    const view = render(<Dashboard defaultValue={doc()} bricks={builtinBricks} data={{ kpi: data.kpi }} status={{ rows: 'loading' }} locale={ja} />);
    expect(within(item('bar')).getByRole('status').textContent).toBe('読み込み中…');
    expect(item('kpi').querySelector('.vbx-stat-value')!.textContent).toBe('42');

    view.rerender(<Dashboard defaultValue={doc()} bricks={builtinBricks} data={data} status={{ rows: 'loading' }} locale={ja} />);
    const stale = item('bar').querySelector('.vbx-brick-stale')!;
    expect(stale.getAttribute('aria-busy')).toBe('true');
    expect(stale.querySelector('.vbx-plot')).toBeTruthy();

    view.rerender(<Dashboard defaultValue={doc()} bricks={builtinBricks} data={data} locale={ja} />);
    expect(item('bar').querySelector('.vbx-brick-stale')).toBeNull();
  });

  it('shows the error with a retry that names the dataset', () => {
    const onRetry = vi.fn();
    render(
      <Dashboard
        defaultValue={doc()}
        bricks={builtinBricks}
        data={data}
        status={{ rows: { state: 'error', message: 'Timed out' } }}
        onRetry={onRetry}
      />,
    );
    const alert = within(item('bar')).getByRole('alert');
    expect(alert.textContent).toContain('Timed out');
    expect(item('bar').querySelector('.vbx-plot')).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('rows');
  });

  it('renders states statically, without a retry button', () => {
    const html = renderToStaticMarkup(<DashboardStatic id="d" value={doc()} bricks={builtinBricks} data={{}} status={{ rows: 'error', kpi: 'loading' }} />);
    expect(html).toContain('Could not load the data.');
    expect(html).toContain('Loading…');
    expect(html).not.toContain('<button');
  });
});

describe('selection', () => {
  it('reports the row behind a clicked mark, with the brick, in view mode only', () => {
    const onSelect = vi.fn();
    const view = render(<Dashboard defaultValue={doc()} bricks={builtinBricks} data={data} onSelect={onSelect} editable />);
    const plot = within(item('bar')).getByRole('group');
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    fireEvent.keyDown(plot, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith({ datum: rows[1], index: 1, item: expect.objectContaining({ id: 'bar' }) });

    view.rerender(<Dashboard defaultValue={doc()} bricks={builtinBricks} data={data} onSelect={onSelect} editable editing />);
    onSelect.mockClear();
    fireEvent.keyDown(within(item('bar')).getByRole('group'), { key: 'ArrowRight' });
    fireEvent.keyDown(within(item('bar')).getByRole('group'), { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('LineChart reports the original index after sorting, and DataTable after sorting and filtering', () => {
    const onSelect = vi.fn();
    const points = [
      { t: 3, v: 30 },
      { t: 1, v: 10 },
      { t: 2, v: 20 },
    ];
    const line = render(<LineChart data={points} x="t" series={['v']} onSelect={onSelect} />);
    const plot = screen.getByRole('group');
    fireEvent.keyDown(plot, { key: 'Home' });
    fireEvent.keyDown(plot, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith({ datum: points[1], index: 1 });
    line.unmount();

    const onRowClick = vi.fn();
    const { container } = render(<DataTable data={rows} columns={['name', 'a']} searchable onRowClick={onRowClick} lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'a' }));
    fireEvent.click(screen.getByRole('button', { name: 'a' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'n' } });
    fireEvent.click(container.querySelector('tbody tr[data-clickable]')!);
    expect(onRowClick).toHaveBeenCalledWith(rows[3], 3);
  });
});

describe('charts: reference lines, zoom, table cells', () => {
  it('draws reference lines and grows the axis to include them', () => {
    const { container } = render(
      <BarChart data={rows} x="month" series={['a']} references={[{ value: 90, label: 'Target', status: 'good' }]} lang="en" />,
    );
    const line = container.querySelector<SVGLineElement>('.vbx-reference')!;
    expect(line.style.stroke).toBe('var(--vbx-status-good)');
    expect(container.querySelector('.vbx-reference-label')!.textContent).toBe('Target');
    expect([...container.querySelectorAll('text.vbx-tick')].map((t) => t.textContent)).toContain('100');
  });

  it('zooms into a dragged range and resets', () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ i: `p${i}`, v: i }));
    const { container } = render(<LineChart data={many} x="i" series={['v']} zoom lang="en" />);
    const plot = screen.getByRole('group');
    plot.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 300, width: 600, height: 300, toJSON: () => ({}) });
    const ticksBefore = [...container.querySelectorAll('text.vbx-tick')].map((t) => t.textContent);
    expect(ticksBefore).toContain('p0');
    // Plot spans x≈32…586 for 21 points; drag across the middle third.
    // jsdom's PointerEvent drops coordinates; a MouseEvent of the same type carries them.
    const pointer = (type: string, x: number): void => {
      act(() => {
        plot.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 100, button: 0 }));
      });
    };
    pointer('pointerdown', 220);
    pointer('pointermove', 300);
    expect(container.querySelector('.vbx-brush')).toBeTruthy();
    pointer('pointermove', 400);
    pointer('pointerup', 400);
    const zoomed = [...container.querySelectorAll('text.vbx-tick')].map((t) => t.textContent);
    expect(zoomed).not.toContain('p0');
    expect(zoomed).not.toContain('p20');
    expect(container.querySelector('.vbx-brush')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    expect([...container.querySelectorAll('text.vbx-tick')].map((t) => t.textContent)).toContain('p0');
  });

  it('renders badge, link and progress cells, and refuses unsafe link targets', () => {
    const data = [{ id: 'a b', stage: 'won', share: 0.25 }];
    const { container } = render(
      <DataTable
        data={data}
        lang="en"
        columns={[
          { key: 'id', kind: 'link', href: '/deals/{id}' },
          { key: 'stage', kind: 'badge', tones: { won: 'good' } },
          { key: 'share', kind: 'progress' },
        ]}
      />,
    );
    expect(container.querySelector('a.vbx-cell-link')!.getAttribute('href')).toBe('/deals/a%20b');
    expect(container.querySelector('.vbx-badge')!.getAttribute('data-tone')).toBe('good');
    expect(container.querySelector<HTMLElement>('.vbx-cell-track > span')!.style.width).toBe('25%');
    expect(container.querySelector('.vbx-cell-progress')!.textContent).toBe('25%');

    expect(buildHref('javascript:alert({id})', data[0]!)).toBeUndefined();
    expect(buildHref('data:text/html,{id}', data[0]!)).toBeUndefined();
    expect(buildHref('https://example.com/?q={id}', data[0]!)).toBe('https://example.com/?q=a%20b');
  });

  it('filters rows with the search box and shows the match count', () => {
    const { container } = render(<DataTable data={rows} searchable lang="en" />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ma' } });
    expect(container.querySelectorAll('tbody tr[aria-rowindex]')).toHaveLength(1);
    expect(container.querySelector('.vbx-table-count')!.textContent).toBe('1');
  });
});

describe('export', () => {
  it('serializes rows as CSV, quoting and neutralising formulas', () => {
    const csv = toCsv([
      { name: 'Plain', note: 'a,b', n: 1 },
      { name: '=SUM(A1)', note: 'say "hi"\nnow', n: -5, when: new Date(Date.UTC(2026, 0, 2)) },
    ]);
    expect(csv).toBe(
      '﻿name,note,n,when\r\nPlain,"a,b",1,\r\n\'=SUM(A1),"say ""hi""\nnow",-5,2026-01-02T00:00:00.000Z\r\n',
    );
  });

  it('exports the dataset behind a brick, flattening object-shaped data', () => {
    const d = doc();
    expect(brickRows(d.items[0]!, data)).toEqual(rows);
    expect(brickRows(d.items[1]!, data)).toEqual([{ value: 42, delta: 0.1 }]);
    const ref = createRef<DashboardHandle>();
    render(<Dashboard ref={ref} defaultValue={d} bricks={builtinBricks} data={data} exportable />);
    expect(ref.current!.toCsv('kpi')).toBe('﻿value,delta\r\n42,0.1\r\n');
    expect(ref.current!.toCsv('missing')).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Brick actions: Bars' }));
    expect(screen.getByRole('menuitem', { name: 'Download CSV' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Download image' })).toBeTruthy();
  });
});

describe('overlap policy and alignment', () => {
  const others = [{ x: 0, y: 0, w: 600, h: 200 }];

  it('finds the nearest free spot flush against a neighbour', () => {
    expect(nearestFreeRect({ x: 500, y: 20, w: 300, h: 100 }, others, 1200)).toEqual({ x: 600, y: 20, w: 300, h: 100 });
    expect(nearestFreeRect({ x: 100, y: 150, w: 300, h: 100 }, others, 1200)).toEqual({ x: 100, y: 200, w: 300, h: 100 });
    const free = { x: 700, y: 0, w: 100, h: 100 };
    expect(nearestFreeRect(free, others, 1200)).toBe(free);
  });

  it('moves a dropped group as one and refuses overlapping resizes', () => {
    const d = createDashboard({
      gap: 0,
      items: [
        { id: 'a', type: 't', x: 0, y: 0, w: 600, h: 200 },
        { id: 'b', type: 't', x: 600, y: 0, w: 300, h: 100 },
        { id: 'c', type: 't', x: 900, y: 0, w: 300, h: 100 },
      ],
    });
    const moved = resolveOverlap(d, 'base', { b: { x: 300, y: 300, w: 300, h: 100 } }, 'move');
    expect(moved).toEqual({ b: { x: 300, y: 300, w: 300, h: 100 } });
    const group = resolveOverlap(d, 'base', { b: { x: 400, y: 150, w: 300, h: 100 }, c: { x: 700, y: 150, w: 300, h: 100 } }, 'move')!;
    expect(group.c!.x - group.b!.x).toBe(300);
    expect(group.b).toEqual({ x: 400, y: 200, w: 300, h: 100 });
    expect(resolveOverlap(d, 'base', { b: { x: 500, y: 0, w: 400, h: 100 } }, 'resize')).toBeNull();

    const store = createDashboardStore({ doc: d, avoidOverlap: () => true });
    store.setRects({ b: { x: 500, y: 0, w: 400, h: 100 } }, 'resize');
    expect(store.getState().canUndo).toBe(false);
    store.setRects({ b: { x: 500, y: 20, w: 300, h: 100 } });
    expect(store.getState().doc.items[1]).toMatchObject({ x: 600, y: 20 });
  });

  it('aligns and distributes', () => {
    const rects = { a: { x: 0, y: 10, w: 100, h: 50 }, b: { x: 300, y: 40, w: 200, h: 100 }, c: { x: 900, y: 0, w: 100, h: 20 } };
    expect(Object.values(alignRects(rects, 'top')).map((r) => r.y)).toEqual([0, 0, 0]);
    expect(Object.values(alignRects(rects, 'right')).map((r) => r.x)).toEqual([900, 800, 900]);
    expect(Object.values(alignRects(rects, 'centerY')).map((r) => r.y)).toEqual([45, 20, 60]);
    // 1000 wide, 400 of bricks → two equal gaps of 300.
    expect(Object.values(alignRects(rects, 'distributeX')).map((r) => r.x)).toEqual([0, 400, 900]);
  });

  it('offers alignment for a multi-selection and pastes copies', () => {
    const ref = createRef<DashboardHandle>();
    render(<Dashboard ref={ref} defaultValue={doc()} bricks={builtinBricks} data={data} editable defaultEditing />);
    expect(screen.queryByRole('group', { name: 'Align' })).toBeNull();
    act(() => ref.current!.store.select(['bar', 'kpi']));
    act(() => ref.current!.store.setRects({ kpi: { x: 600, y: 80, w: 600, h: 300 } }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Align' })).getByRole('button', { name: 'Align top' }));
    expect(ref.current!.getValue().items.map((i) => i.y)).toEqual([0, 0]);

    act(() => item('bar').focus());
    fireEvent.keyDown(item('bar'), { key: 'a', ctrlKey: true });
    expect(ref.current!.store.getState().selection).toEqual(['bar', 'kpi']);
    fireEvent.keyDown(item('bar'), { key: 'c', ctrlKey: true });
    fireEvent.keyDown(item('bar'), { key: 'v', ctrlKey: true });
    const items = ref.current!.getValue().items;
    expect(items).toHaveLength(4);
    expect(items[2]).toMatchObject({ type: 'bar', title: 'Bars', y: 300 });
    expect(new Set(items.map((i) => i.id)).size).toBe(4);
    fireEvent.keyDown(item('bar'), { key: 'z', ctrlKey: true });
    expect(ref.current!.getValue().items).toHaveLength(2);
  });
});
