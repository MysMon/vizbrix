import { describe, expect, it } from 'vitest';
import { createDashboard } from './doc';
import { resolveVariant } from './geometry';
import { clampResize } from './interaction';
import { addItem, duplicateItems, findFreeSpot, removeItems, reorderItem, resetVariant, setRects, updateItem } from './ops';
import { DEFAULT_SNAP, MOVE, snapRect } from './snap';
import { createDashboardStore } from './store';

const base = () =>
  createDashboard({
    items: [
      { id: 'a', type: 't', x: 0, y: 0, w: 600, h: 200 },
      { id: 'b', type: 't', x: 600, y: 0, w: 600, h: 200 },
    ],
  });

describe('ops', () => {
  it('returns the same document when nothing changes', () => {
    const doc = base();
    expect(setRects(doc, 'base', { a: { x: 0, y: 0, w: 600, h: 200 } })).toBe(doc);
    expect(updateItem(doc, 'a', { title: undefined })).toBe(doc);
    expect(removeItems(doc, ['nope'])).toBe(doc);
    expect(reorderItem(doc, 'b', 'front')).toBe(doc);
    expect(resetVariant(doc, 'sm')).toBe(doc);
  });

  it('clamps rects to the canvas and the minimum size', () => {
    const doc = setRects(base(), 'base', { a: { x: -50, y: -10, w: 5, h: 5 }, b: { x: 1100, y: 0, w: 600, h: 200 } });
    expect(doc.items[0]).toMatchObject({ x: 0, y: 0, w: 64, h: 48 });
    expect(doc.items[1]).toMatchObject({ x: 600, w: 600 });
  });

  it('materialises a breakpoint layout on first edit and resets it', () => {
    const doc = base();
    const edited = setRects(doc, 'sm', { b: { x: 0, y: 300, w: 600, h: 150 } });
    expect(edited.items).toBe(doc.items);
    expect(edited.layouts.sm).toEqual({ a: { x: 0, y: 0, w: 600, h: 200 }, b: { x: 0, y: 300, w: 600, h: 150 } });
    expect(resolveVariant(edited, 'sm').auto).toBe(false);
    expect(resolveVariant(resetVariant(edited, 'sm'), 'sm').auto).toBe(true);
  });

  it('adds into the first free spot and removes layout entries with the brick', () => {
    const doc = base();
    expect(findFreeSpot(doc, 400, 100)).toEqual({ x: 0, y: 200 });
    const narrow = createDashboard({ items: [{ id: 'a', type: 't', x: 0, y: 0, w: 600, h: 200 }] });
    expect(findFreeSpot(narrow, 400, 100)).toEqual({ x: 600, y: 0 });

    const added = addItem(doc, { type: 'stat', w: 300, h: 100 });
    expect(added.doc.items[2]).toMatchObject({ type: 'stat', x: 0, y: 200, w: 300, h: 100 });
    const withLayout = setRects(added.doc, 'sm', { [added.id]: { x: 0, y: 0, w: 600, h: 100 } });
    const removed = removeItems(withLayout, [added.id]);
    expect(removed.items).toHaveLength(2);
    expect(Object.keys(removed.layouts.sm!)).toEqual(['a', 'b']);
  });

  it('does not remove locked bricks, and duplicates without the lock', () => {
    const locked = updateItem(base(), 'a', { locked: true });
    expect(removeItems(locked, ['a'])).toBe(locked);
    const dup = duplicateItems(locked, ['a']);
    const copy = dup.doc.items.find((i) => i.id === dup.ids[0])!;
    expect(copy.locked).toBeUndefined();
    expect(copy).toMatchObject({ x: 0, y: 200, w: 600, h: 200 });
  });

  it('reorders paint order', () => {
    expect(reorderItem(base(), 'a', 'front').items.map((i) => i.id)).toEqual(['b', 'a']);
  });
});

describe('snapRect', () => {
  const req = { width: 1200, options: DEFAULT_SNAP, toleranceX: 6, toleranceY: 6 };
  const target = { x: 0, y: 0, w: 600, h: 200 };

  it('snaps a moving rect to a sibling edge and reports a guide', () => {
    const { rect, guides } = snapRect({ ...req, rect: { x: 603, y: 204, w: 300, h: 100 }, edges: MOVE, move: true, targets: [target] });
    expect(rect).toEqual({ x: 600, y: 200, w: 300, h: 100 });
    expect(guides).toEqual([
      { axis: 'x', pos: 600, from: 0, to: 300 },
      { axis: 'y', pos: 200, from: 0, to: 900 },
    ]);
  });

  it('falls back to the grid when nothing is near', () => {
    const { rect, guides } = snapRect({ ...req, rect: { x: 733, y: 451, w: 300, h: 100 }, edges: MOVE, move: true, targets: [target] });
    expect(rect).toMatchObject({ x: 736, y: 448 });
    expect(guides).toEqual([]);
  });

  it('snaps only the dragged edge on resize, preserving the opposite one', () => {
    const { rect } = snapRect({
      ...req,
      rect: { x: 700, y: 300, w: 497, h: 100 },
      edges: { left: false, right: true, top: false, bottom: false },
      move: false,
      targets: [target],
    });
    expect(rect).toEqual({ x: 700, y: 300, w: 500, h: 100 });
  });

  it('does nothing when disabled', () => {
    const rect = { x: 603, y: 204, w: 300, h: 100 };
    const out = snapRect({ ...req, options: { grid: 0, items: false, threshold: 0 }, rect, edges: MOVE, move: true, targets: [target] });
    expect(out.rect).toEqual(rect);
  });
});

describe('clampResize', () => {
  it('holds the opposite edge when hitting the minimum from the left/top', () => {
    const start = { x: 100, y: 100, w: 300, h: 200 };
    const edges = { left: true, right: false, top: true, bottom: false };
    expect(clampResize({ x: 390, y: 290, w: 10, h: 10 }, start, edges, {}, 1200)).toEqual({ x: 336, y: 252, w: 64, h: 48 });
    expect(clampResize({ x: -40, y: -40, w: 440, h: 340 }, start, edges, {}, 1200)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });

  it('stops the right edge at the canvas', () => {
    const start = { x: 900, y: 0, w: 200, h: 100 };
    const edges = { left: false, right: true, top: false, bottom: true };
    expect(clampResize({ x: 900, y: 0, w: 500, h: 10 }, start, edges, { minH: 80 }, 1200)).toEqual({ x: 900, y: 0, w: 300, h: 80 });
  });
});

describe('store', () => {
  it('commits, undoes and redoes, notifying once per change', () => {
    const changes: string[] = [];
    const store = createDashboardStore({ doc: base(), onChange: (_, meta) => changes.push(meta.reason) });
    const initial = store.getState().doc;
    store.setRects({ a: { x: 0, y: 200, w: 600, h: 200 } });
    expect(store.getState().canUndo).toBe(true);
    store.undo();
    expect(store.getState().doc).toBe(initial);
    expect(store.getState().canRedo).toBe(true);
    store.redo();
    expect(store.getState().doc.items[0]!.y).toBe(200);
    expect(changes).toEqual(['move', 'undo', 'redo']);
  });

  it('skips no-op commits entirely', () => {
    let calls = 0;
    const store = createDashboardStore({ doc: base(), onChange: () => calls++ });
    store.setRects({ a: { x: 0, y: 0, w: 600, h: 200 } });
    store.remove(['missing']);
    expect(calls).toBe(0);
    expect(store.getState().canUndo).toBe(false);
  });

  it('coalesces keyed commits into one undo step', () => {
    const store = createDashboardStore({ doc: base() });
    const initial = store.getState().doc;
    for (let i = 1; i <= 5; i++) store.setRects({ a: { x: 0, y: i * 8, w: 600, h: 200 } }, 'move', 'kbd');
    store.setRects({ b: { x: 600, y: 8, w: 600, h: 200 } }, 'move', 'other');
    store.undo();
    expect(store.getState().doc.items[0]!.y).toBe(40);
    store.undo();
    expect(store.getState().doc).toBe(initial);
    expect(store.getState().canUndo).toBe(false);
  });

  it('caps history and prunes selection when bricks disappear', () => {
    const store = createDashboardStore({ doc: base(), historyLimit: 3 });
    for (let i = 1; i <= 10; i++) store.setRects({ a: { x: 0, y: i, w: 600, h: 200 } });
    let undos = 0;
    while (store.getState().canUndo) {
      store.undo();
      undos++;
    }
    expect(undos).toBe(3);

    const id = store.add({ type: 'stat' });
    expect(store.getState().selection).toEqual([id]);
    store.undo();
    expect(store.getState().selection).toEqual([]);
  });

  it('edits the variant on screen', () => {
    const store = createDashboardStore({ doc: base() });
    store.setVariant('sm');
    store.setRects({ a: { x: 0, y: 0, w: 300, h: 200 } }, 'resize');
    const doc = store.getState().doc;
    expect(doc.items[0]).toMatchObject({ w: 600 });
    expect(doc.layouts.sm!.a).toEqual({ x: 0, y: 0, w: 300, h: 200 });
    store.resetLayout();
    expect(store.getState().doc.layouts.sm).toBeUndefined();
  });

  it('leaves edit mode with an empty selection', () => {
    const store = createDashboardStore({ doc: base(), editing: true });
    store.select(['a', 'a', 'ghost', 'b']);
    expect(store.getState().selection).toEqual(['a', 'b']);
    store.setEditing(false);
    expect(store.getState().selection).toEqual([]);
  });
});
