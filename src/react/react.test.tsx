// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDashboard } from '../core/doc';
import type { DashboardDoc } from '../core/types';
import { ja } from '../locales/ja';
import { defineBrick, type BrickRegistry } from './brick';
import { Dashboard, type DashboardHandle } from './Dashboard';
import { DashboardStatic } from './Static';

afterEach(cleanup);

const renders: Record<string, number> = {};
const bricks: BrickRegistry = {
  note: defineBrick<{ text?: string }>({
    label: 'Note',
    defaults: { w: 300, h: 100, title: 'New note', props: { text: 'hello' } },
    render: ({ item, props, data }) => {
      renders[item.id] = (renders[item.id] ?? 0) + 1;
      return <p>{props.text ?? String(data.greeting ?? '')}</p>;
    },
  }),
  boom: defineBrick({
    render: () => {
      throw new Error('kaboom');
    },
  }),
};

const makeDoc = (): DashboardDoc =>
  createDashboard({
    gap: 0,
    items: [
      { id: 'a', type: 'note', title: 'Alpha', x: 0, y: 0, w: 600, h: 200, props: { text: 'first' } },
      { id: 'b', type: 'note', title: 'Beta', x: 600, y: 0, w: 600, h: 200 },
    ],
  });

const item = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-vbx-item="${id}"]`)!;

/** jsdom has no layout: give the canvas a 1200px box so pixel math is 1:1 with design units. */
function fakeLayout(): void {
  const canvas = document.querySelector<HTMLElement>('.vbx-canvas')!;
  canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON: () => ({}) });
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
}

function pointer(target: EventTarget, type: string, x: number, y: number, init: MouseEventInit = {}): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...init });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => {
    target.dispatchEvent(event);
  });
}

async function frame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

describe('<Dashboard> read-only', () => {
  it('renders bricks with titles, data and a compiled stylesheet', () => {
    const { container } = render(<Dashboard defaultValue={makeDoc()} bricks={bricks} data={{ greeting: 'from data' }} />);
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeTruthy();
    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.getByText('from data')).toBeTruthy();
    const css = container.querySelector('style')!.textContent!;
    expect(css).toContain('[data-vbx-item="a"]{left:0px;top:0px;width:50%;height:200px}');
    expect(css).toContain('@container vbx (max-width:600px)');
  });

  it('exposes nothing editable: no toolbar, no tab stops, no grips', () => {
    const { container } = render(<Dashboard defaultValue={makeDoc()} bricks={bricks} />);
    expect(container.querySelector('.vbx-toolbar')).toBeNull();
    expect(container.querySelector('.vbx-grip')).toBeNull();
    expect(item('a').hasAttribute('tabindex')).toBe(false);
  });

  it('isolates a crashing brick and shows unknown types as placeholders', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const doc = createDashboard({
      items: [
        { id: 'x', type: 'boom', x: 0, y: 0, w: 300, h: 100 },
        { id: 'y', type: 'mystery', x: 300, y: 0, w: 300, h: 100 },
        { id: 'z', type: 'note', x: 600, y: 0, w: 300, h: 100, props: { text: 'still here' } },
      ],
    });
    render(<Dashboard defaultValue={doc} bricks={bricks} />);
    expect(screen.getByRole('alert').textContent).toContain('failed to render');
    expect(screen.getByText('Unknown brick type “mystery”')).toBeTruthy();
    expect(screen.getByText('still here')).toBeTruthy();
    spy.mockRestore();
  });

  it('falls back to renderItem for unregistered types', () => {
    const doc = createDashboard({ items: [{ id: 'y', type: 'mystery', x: 0, y: 0, w: 300, h: 100 }] });
    render(<Dashboard defaultValue={doc} renderItem={(i) => <b>custom {i.type}</b>} />);
    expect(screen.getByText('custom mystery')).toBeTruthy();
  });

  it('shows an empty state', () => {
    render(<Dashboard defaultValue={createDashboard()} locale={ja} />);
    expect(screen.getByText('まだ何もありません')).toBeTruthy();
  });
});

describe('<Dashboard> editing', () => {
  const setup = (extra: Partial<React.ComponentProps<typeof Dashboard>> = {}) => {
    const onChange = vi.fn();
    const ref = createRef<DashboardHandle>();
    const view = render(
      <Dashboard ref={ref} defaultValue={makeDoc()} bricks={bricks} editable defaultEditing onChange={onChange} {...extra} />,
    );
    fakeLayout();
    return { onChange, ref, ...view };
  };

  it('toggles edit mode from the toolbar', () => {
    const onEditingChange = vi.fn();
    render(<Dashboard defaultValue={makeDoc()} bricks={bricks} editable onEditingChange={onEditingChange} />);
    expect(document.querySelector('.vbx-grip')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(document.querySelectorAll('.vbx-grip')).toHaveLength(2);
    expect(onEditingChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(document.querySelector('.vbx-grip')).toBeNull();
  });

  it('moves and resizes with the keyboard, coalescing into one undo step', () => {
    const { onChange, ref } = setup();
    const a = item('a');
    act(() => a.focus());
    expect(a.hasAttribute('data-selected')).toBe(true);
    fireEvent.keyDown(a, { key: 'ArrowDown' });
    fireEvent.keyDown(a, { key: 'ArrowDown' });
    fireEvent.keyDown(a, { key: 'ArrowRight', altKey: true });
    expect(ref.current!.getValue().items[0]).toMatchObject({ x: 1, y: 16 });
    fireEvent.keyDown(a, { key: 'ArrowLeft', shiftKey: true });
    expect(ref.current!.getValue().items[0]).toMatchObject({ x: 1, w: 599 });
    expect(onChange).toHaveBeenCalledTimes(4);
    expect(onChange.mock.calls[0]![1]).toMatchObject({ reason: 'move', ids: ['a'] });

    fireEvent.keyDown(a, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(a, { key: 'z', ctrlKey: true });
    expect(ref.current!.getValue().items[0]).toMatchObject({ x: 0, y: 0, w: 600 });
    expect(ref.current!.store.getState().canUndo).toBe(false);
    fireEvent.keyDown(a, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(ref.current!.getValue().items[0]).toMatchObject({ x: 1, y: 16 });
  });

  it('announces keyboard moves in the live region', () => {
    setup({ locale: ja });
    const a = item('a');
    act(() => a.focus());
    fireEvent.keyDown(a, { key: 'ArrowDown' });
    expect(document.querySelector('[aria-live]')!.textContent).toBe('Alpha を 0, 8 に移動しました');
  });

  it('drags with the pointer: previews imperatively, commits once on release', async () => {
    const { onChange, ref } = setup({ snap: false });
    const grip = item('a').querySelector('.vbx-grip')!;
    const before = renders.b;
    pointer(grip, 'pointerdown', 100, 100);
    pointer(window, 'pointermove', 110, 140);
    pointer(window, 'pointermove', 130, 350);
    await frame();
    expect(item('a').style.transform).toBe('translate(30px, 250px)');
    expect(item('a').hasAttribute('data-vbx-dragging')).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    pointer(window, 'pointerup', 130, 350);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(ref.current!.getValue().items[0]).toMatchObject({ x: 30, y: 250 });
    expect(item('a').style.transform).toBe('');
    expect(item('a').hasAttribute('data-vbx-dragging')).toBe(false);
    // The sibling's content never re-rendered during or after the drag.
    expect(renders.b).toBe(before);
  });

  it('snaps to a sibling edge and draws a guide while dragging', async () => {
    const { ref } = setup();
    const grip = item('a').querySelector('.vbx-grip')!;
    pointer(grip, 'pointerdown', 100, 100);
    pointer(window, 'pointermove', 100, 200);
    pointer(window, 'pointermove', 103, 297);
    await frame();
    expect(document.querySelectorAll('.vbx-guide').length).toBeGreaterThan(0);
    pointer(window, 'pointerup', 103, 297);
    // 3px off horizontally snaps back to x=0; 197 snaps to the sibling's bottom edge at 200.
    expect(ref.current!.getValue().items[0]).toMatchObject({ x: 0, y: 200 });
    expect(document.querySelectorAll('.vbx-guide')).toHaveLength(0);
  });

  it('cancels a drag with Escape without committing', async () => {
    const { onChange } = setup();
    const grip = item('a').querySelector('.vbx-grip')!;
    pointer(grip, 'pointerdown', 100, 100);
    pointer(window, 'pointermove', 300, 300);
    await frame();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    pointer(window, 'pointerup', 300, 300);
    expect(onChange).not.toHaveBeenCalled();
    expect(item('a').style.transform).toBe('');
  });

  it('resizes from a handle, holding the opposite edge', async () => {
    const { ref } = setup({ snap: false });
    pointer(item('b').querySelector('.vbx-grip')!, 'pointerdown', 700, 50);
    pointer(window, 'pointerup', 700, 50);
    const handle = item('b').querySelector('[data-vbx-handle="sw"]')!;
    pointer(handle, 'pointerdown', 600, 200);
    pointer(window, 'pointermove', 650, 260);
    pointer(window, 'pointermove', 700, 300);
    await frame();
    expect(item('b').style.width).toBe('500px');
    pointer(window, 'pointerup', 700, 300);
    expect(ref.current!.getValue().items[1]).toMatchObject({ x: 700, y: 0, w: 500, h: 300 });
  });

  it('multi-selects with shift and moves the group together', async () => {
    const { ref } = setup({ snap: false });
    pointer(item('a').querySelector('.vbx-grip')!, 'pointerdown', 10, 10);
    pointer(window, 'pointerup', 10, 10);
    pointer(item('b').querySelector('.vbx-grip')!, 'pointerdown', 700, 10, { shiftKey: true });
    expect(ref.current!.store.getState().selection).toEqual(['a', 'b']);
    pointer(item('b').querySelector('.vbx-grip')!, 'pointerdown', 700, 10);
    pointer(window, 'pointermove', 700, 60);
    pointer(window, 'pointermove', 700, 110);
    await frame();
    pointer(window, 'pointerup', 700, 110);
    expect(ref.current!.getValue().items.map((i) => i.y)).toEqual([100, 100]);
  });

  it('does not move locked bricks', async () => {
    const doc = makeDoc();
    const locked = { ...doc, items: [{ ...doc.items[0]!, locked: true }, doc.items[1]!] };
    const { onChange } = setup({ defaultValue: locked });
    pointer(item('a').querySelector('.vbx-grip')!, 'pointerdown', 10, 10);
    pointer(window, 'pointermove', 200, 200);
    pointer(window, 'pointerup', 200, 200);
    fireEvent.keyDown(item('a'), { key: 'ArrowDown' });
    fireEvent.keyDown(item('a'), { key: 'Delete' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes with Delete and duplicates with Ctrl+D', () => {
    const { ref } = setup();
    act(() => item('b').focus());
    fireEvent.keyDown(item('b'), { key: 'd', ctrlKey: true });
    expect(ref.current!.getValue().items).toHaveLength(3);
    act(() => item('a').focus());
    fireEvent.keyDown(item('a'), { key: 'Delete' });
    expect(ref.current!.getValue().items.map((i) => i.title)).toEqual(['Beta', 'Beta']);
  });

  it('adds a brick from the toolbar with the type defaults', () => {
    const { ref } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Note' }));
    const added = ref.current!.getValue().items[2]!;
    expect(added).toMatchObject({ type: 'note', title: 'New note', x: 0, y: 200, w: 300, h: 100, props: { text: 'hello' } });
    expect(screen.getByText('hello')).toBeTruthy();
    expect(ref.current!.store.getState().selection).toEqual([added.id]);
  });

  it('edits title, geometry and pin from the brick menu', () => {
    const onEditItem = vi.fn();
    const { ref } = setup({ onEditItem });
    fireEvent.click(screen.getByRole('button', { name: 'Brick options: Alpha' }));
    const menu = screen.getByRole('dialog');
    fireEvent.change(within(menu).getByLabelText('Rename'), { target: { value: 'Renamed' } });
    fireEvent.change(within(menu).getByLabelText('W'), { target: { value: '480' } });
    fireEvent.change(within(menu).getByLabelText('When the width changes'), { target: { value: 'left' } });
    expect(ref.current!.getValue().items[0]).toMatchObject({ title: 'Renamed', w: 480, pin: 'left' });
    fireEvent.click(within(menu).getByRole('button', { name: 'Edit…' }));
    expect(onEditItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Brick options: Renamed' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Remove/ }));
    expect(ref.current!.getValue().items.map((i) => i.id)).toEqual(['b']);
  });

  it('works controlled, and adopts an externally replaced document', () => {
    let setDoc!: (doc: DashboardDoc) => void;
    const ref = createRef<DashboardHandle>();
    function Host() {
      const [doc, set] = useState(makeDoc);
      setDoc = set;
      return <Dashboard ref={ref} value={doc} onChange={set} bricks={bricks} editable defaultEditing />;
    }
    render(<Host />);
    act(() => item('a').focus());
    fireEvent.keyDown(item('a'), { key: 'ArrowDown' });
    expect(ref.current!.getValue().items[0]!.y).toBe(8);
    expect(ref.current!.store.getState().canUndo).toBe(true);

    act(() => setDoc(createDashboard({ items: [{ id: 'solo', type: 'note', title: 'Solo', x: 0, y: 0, w: 300, h: 100 }] })));
    expect(screen.getByRole('heading', { name: 'Solo' })).toBeTruthy();
    expect(item('a')).toBeNull();
  });

  it('re-renders only the brick that changed', () => {
    const { ref } = setup();
    const before = { ...renders };
    act(() => ref.current!.update('a', { props: { text: 'changed' } }));
    expect(screen.getByText('changed')).toBeTruthy();
    expect(renders.a).toBe(before.a! + 1);
    expect(renders.b).toBe(before.b);
  });
});

describe('<DashboardStatic>', () => {
  it('produces the same layout CSS and brick markup as the client component, with no handlers', () => {
    const doc = makeDoc();
    const html = renderToStaticMarkup(<DashboardStatic id="dash" value={doc} bricks={bricks} />);
    expect(html).toContain('data-vbx-scope="dash"');
    expect(html).toContain('[data-vbx-item="a"]{left:0px;top:0px;width:50%;height:200px}');
    expect(html).toContain('<h3 class="vbx-brick-title"');
    expect(html).toContain('first');
    expect(html).not.toContain('tabindex');

    const { container } = render(<Dashboard defaultValue={doc} bricks={bricks} />);
    const strip = (s: string): string => s.replace(/id="[^"]*"|aria-labelledby="[^"]*"/g, '');
    const staticBrick = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-vbx-item="a"]')!;
    expect(strip(container.querySelector('[data-vbx-item="a"]')!.outerHTML)).toBe(strip(staticBrick.outerHTML));
  });
});
