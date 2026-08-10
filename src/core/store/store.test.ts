import { describe, expect, it, vi } from 'vitest';
import type {
  AxisPlacement,
  ContainerConfig,
  LayoutDoc,
  LayoutItem,
  LayoutItemBase,
  Op,
} from '../schema/types';
import { createStore } from './store';
import { buildServerViews } from './server-view';

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

const px = (offset: number, size: number): AxisPlacement => ({ mode: 'start', offset, size });

function item(
  id: string,
  z: string,
  rect: { x: number; y: number; w: number; h: number },
  extra: Partial<LayoutItemBase> = {},
): LayoutItem {
  return { id, z, x: px(rect.x, rect.w), y: px(rect.y, rect.h), ...extra };
}

function makeDoc(
  items: LayoutItem[],
  container: Partial<ContainerConfig> = {},
): LayoutDoc {
  return {
    version: 1,
    container: { base: { width: 1000, height: 600 }, ...container },
    items,
  };
}

/** Two px-anchored items, `a` below `b` in z. */
function twoItemDoc(container: Partial<ContainerConfig> = {}): LayoutDoc {
  return makeDoc(
    [
      item('a', 'a0', { x: 10, y: 10, w: 100, h: 50 }),
      item('b', 'a1', { x: 300, y: 10, w: 100, h: 50 }),
    ],
    container,
  );
}

function editStore(doc: LayoutDoc = twoItemDoc()) {
  return createStore(doc, { mode: 'edit' });
}

/* ------------------------------------------------------------------ */
/* construction + derived state                                        */
/* ------------------------------------------------------------------ */

describe('construction', () => {
  it('starts at base.width and exposes z-sorted order', () => {
    const store = editStore();
    expect(store.getContainerWidth()).toBe(1000);
    expect(store.getContainerHeight()).toBe(600);
    expect(store.getOrder()).toEqual(['a', 'b']);
    expect(store.getItem('a')?.id).toBe('a');
    expect(store.getItemView('a')?.rect).toEqual({ x: 10, y: 10, w: 100, h: 50 });
  });

  it('re-keys hand-authored non-canonical z keys at construction, preserving order', () => {
    // "b0" / "c0" are not generator-canonical; without the construction
    // defense, bringToFront would throw from keyBetween mid-gesture.
    const store = editStore(
      makeDoc([
        item('a', 'a0', { x: 0, y: 0, w: 10, h: 10 }),
        item('b', 'b0', { x: 20, y: 0, w: 10, h: 10 }),
        item('c', 'c0', { x: 40, y: 0, w: 10, h: 10 }),
      ]),
    );
    expect(store.getOrder()).toEqual(['a', 'b', 'c']);
    expect(store.bringToFront('a').status).toBe('applied');
    expect(store.getOrder()).toEqual(['b', 'c', 'a']);
  });

  it('orders by fractional key with plain string comparison', () => {
    const store = editStore(
      makeDoc([
        item('late', 'Zz', { x: 0, y: 0, w: 10, h: 10 }),
        item('early', 'Z0', { x: 0, y: 0, w: 10, h: 10 }),
        item('mid', 'a0', { x: 0, y: 0, w: 10, h: 10 }),
      ]),
    );
    // ASCII ordinal: 'Z0' < 'Zz' < 'a0'
    expect(store.getOrder()).toEqual(['early', 'late', 'mid']);
  });

  it('derives ascending sparse z-indexes', () => {
    const store = editStore();
    const za = store.getItemView('a')!.zIndex;
    const zb = store.getItemView('b')!.zIndex;
    expect(zb).toBeGreaterThan(za);
  });

  it('defaults to view mode and touches no globals', () => {
    const store = createStore(twoItemDoc());
    expect(store.getMode()).toBe('view');
    expect(store.getNode('a')).toBeNull();
    expect(store.getInteraction()).toEqual({ phase: 'idle' });
  });
});

/* ------------------------------------------------------------------ */
/* subscription precision — the core marketing guarantee               */
/* ------------------------------------------------------------------ */

describe('subscription precision', () => {
  it('moving item A never fires item B’s callback', () => {
    const store = editStore();
    const onA = vi.fn();
    const onB = vi.fn();
    store.subscribeItem('a', onA);
    store.subscribeItem('b', onB);

    store.moveItem('a', { x: 40, y: 60, w: 100, h: 50 });

    expect(onA).toHaveBeenCalledTimes(1);
    expect(onB).not.toHaveBeenCalled();
  });

  it('scales to many items: one commit fires exactly one item channel', () => {
    const items = Array.from({ length: 50 }, (_, i) =>
      item(`i${i}`, `k${String(i).padStart(3, '0')}`, { x: i * 2, y: i * 2, w: 20, h: 20 }),
    );
    const store = editStore(makeDoc(items));
    const calls = new Map<string, number>();
    for (const it of items) {
      calls.set(it.id, 0);
      store.subscribeItem(it.id, () => calls.set(it.id, (calls.get(it.id) ?? 0) + 1));
    }

    store.moveItem('i25', { x: 500, y: 500, w: 20, h: 20 });

    expect(calls.get('i25')).toBe(1);
    const others = [...calls.entries()].filter(([id]) => id !== 'i25');
    expect(others.every(([, n]) => n === 0)).toBe(true);
  });

  it('routes each channel independently', () => {
    const store = editStore();
    const onDoc = vi.fn();
    const onOrder = vi.fn();
    const onSelection = vi.fn();
    const onContainer = vi.fn();
    const onInteraction = vi.fn();
    store.subscribeDoc(onDoc);
    store.subscribeOrder(onOrder);
    store.subscribeSelection(onSelection);
    store.subscribeContainer(onContainer);
    store.subscribeInteraction(onInteraction);

    store.moveItem('a', { x: 40, y: 60, w: 100, h: 50 });
    expect(onDoc).toHaveBeenCalledTimes(1);
    expect(onOrder).not.toHaveBeenCalled();
    expect(onSelection).not.toHaveBeenCalled();
    expect(onContainer).not.toHaveBeenCalled();
    expect(onInteraction).not.toHaveBeenCalled();

    store.setSelection(['a']);
    expect(onSelection).toHaveBeenCalledTimes(1);
    expect(onDoc).toHaveBeenCalledTimes(1);

    store.setContainerSize(800);
    expect(onContainer).toHaveBeenCalledTimes(1);
    expect(onDoc).toHaveBeenCalledTimes(1);

    store.setInteraction({ phase: 'placing', id: 'a' });
    expect(onInteraction).toHaveBeenCalledTimes(1);
    expect(onDoc).toHaveBeenCalledTimes(1);
  });

  it('fires the order channel on add, remove and z changes only', () => {
    const store = editStore();
    const onOrder = vi.fn();
    store.subscribeOrder(onOrder);

    store.moveItem('a', { x: 1, y: 1, w: 100, h: 50 });
    expect(onOrder).not.toHaveBeenCalled();

    store.addItem(item('c', 'a2', { x: 0, y: 0, w: 10, h: 10 }));
    expect(onOrder).toHaveBeenCalledTimes(1);

    store.bringToFront('a');
    expect(onOrder).toHaveBeenCalledTimes(2);

    store.removeItem('c');
    expect(onOrder).toHaveBeenCalledTimes(3);
  });

  it('unsubscribes cleanly', () => {
    const store = editStore();
    const onA = vi.fn();
    const off = store.subscribeItem('a', onA);
    off();
    store.moveItem('a', { x: 40, y: 60, w: 100, h: 50 });
    expect(onA).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* memoized snapshots                                                  */
/* ------------------------------------------------------------------ */

describe('snapshot memoization', () => {
  it('returns the identical object until the item changes', () => {
    const store = editStore();
    const first = store.getItemView('a');
    expect(store.getItemView('a')).toBe(first);
    expect(store.getItemView('a')).toBe(first);

    store.moveItem('a', { x: 40, y: 60, w: 100, h: 50 });
    const second = store.getItemView('a');
    expect(second).not.toBe(first);
    expect(second!.version).toBe(first!.version + 1);
    expect(store.getItemView('a')).toBe(second);
  });

  it('keeps a sibling’s snapshot identical across another item’s commit', () => {
    const store = editStore();
    const b = store.getItemView('b');
    store.moveItem('a', { x: 40, y: 60, w: 100, h: 50 });
    expect(store.getItemView('b')).toBe(b);
  });

  it('bumps on selection membership flips only for the items involved', () => {
    const store = editStore();
    const a0 = store.getItemView('a');
    const b0 = store.getItemView('b');
    const onB = vi.fn();
    store.subscribeItem('b', onB);

    store.setSelection(['a']);
    expect(store.getItemView('a')).not.toBe(a0);
    expect(store.getItemView('a')!.selected).toBe(true);
    expect(store.getItemView('b')).toBe(b0);
    expect(onB).not.toHaveBeenCalled();
  });

  it('bumps when the item’s place in the derived z order changes', () => {
    const store = editStore();
    const b0 = store.getItemView('b')!;
    store.sendToBack('b');
    expect(store.getOrder()).toEqual(['b', 'a']);
    const a1 = store.getItemView('a')!;
    const b1 = store.getItemView('b')!;
    expect(b1.zIndex).toBeLessThan(a1.zIndex);
    expect(b1.version).toBe(b0.version + 1);
  });

  it('inserting between two items leaves the neighbours’ snapshots untouched', () => {
    const store = editStore(
      makeDoc([
        item('a', 'a0', { x: 0, y: 0, w: 10, h: 10 }),
        item('c', 'a2', { x: 0, y: 0, w: 10, h: 10 }),
      ]),
    );
    const a0 = store.getItemView('a');
    const c0 = store.getItemView('c');
    const onA = vi.fn();
    const onC = vi.fn();
    store.subscribeItem('a', onA);
    store.subscribeItem('c', onC);

    store.addItem(item('b', 'a1', { x: 0, y: 0, w: 10, h: 10 }));

    expect(store.getOrder()).toEqual(['a', 'b', 'c']);
    expect(store.getItemView('a')).toBe(a0);
    expect(store.getItemView('c')).toBe(c0);
    expect(onA).not.toHaveBeenCalled();
    expect(onC).not.toHaveBeenCalled();
    const zs = ['a', 'b', 'c'].map((id) => store.getItemView(id)!.zIndex);
    expect(zs[0]!).toBeLessThan(zs[1]!);
    expect(zs[1]!).toBeLessThan(zs[2]!);
  });

  it('drops the snapshot of a removed item', () => {
    const store = editStore();
    store.removeItem('b');
    expect(store.getItemView('b')).toBeUndefined();
    expect(store.getOrder()).toEqual(['a']);
  });

  it('keeps getOrder() identity stable while the order is unchanged', () => {
    const store = editStore();
    const order = store.getOrder();
    store.moveItem('a', { x: 40, y: 60, w: 100, h: 50 });
    expect(store.getOrder()).toBe(order);
  });
});

/* ------------------------------------------------------------------ */
/* server view                                                         */
/* ------------------------------------------------------------------ */

describe('server view', () => {
  const scaled = (): LayoutDoc =>
    makeDoc([
      {
        id: 'a',
        z: 'a0',
        x: { mode: 'scale', offset: { pct: 10 }, size: { pct: 20 } },
        y: px(10, 50),
      },
    ]);

  it('resolves at base.width, not at the measured width', () => {
    const store = createStore(scaled(), { mode: 'edit' });
    expect(store.getServerItemView('a')!.rect).toEqual({ x: 100, y: 10, w: 200, h: 50 });
    store.setContainerSize(500);
    expect(store.getItemView('a')!.rect.w).toBe(100);
    // The server snapshot is history: it still describes the base width.
    expect(store.getServerItemView('a')!.rect).toEqual({ x: 100, y: 10, w: 200, h: 50 });
  });

  it('is frozen at construction and never re-issued', () => {
    const store = editStore();
    const before = store.getServerItemView('a');
    store.moveItem('a', { x: 400, y: 400, w: 100, h: 50 });
    store.setContainerSize(300);
    store.setSelection(['a']);
    expect(store.getServerItemView('a')).toBe(before);
    expect(before!.selected).toBe(false);
    expect(before!.version).toBe(0);
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before!.rect)).toBe(true);
  });

  it('is a pure function of the document', () => {
    const doc = twoItemDoc();
    const one = buildServerViews(doc);
    const two = buildServerViews(doc);
    expect(one.get('a')!.rect).toEqual(two.get('a')!.rect);
    expect(one.get('a')!.zIndex).toBe(two.get('a')!.zIndex);
  });
});

/* ------------------------------------------------------------------ */
/* container size                                                      */
/* ------------------------------------------------------------------ */

describe('container size', () => {
  const mixedDoc = () =>
    makeDoc([
      item('fixed', 'a0', { x: 10, y: 10, w: 100, h: 50 }),
      {
        id: 'fluid',
        z: 'a1',
        x: { mode: 'scale', offset: { pct: 10 }, size: { pct: 20 } },
        y: px(10, 50),
      },
    ]);

  it('bumps only the items whose resolved rect actually changed', () => {
    const store = createStore(mixedDoc(), { mode: 'edit' });
    const onFixed = vi.fn();
    const onFluid = vi.fn();
    store.subscribeItem('fixed', onFixed);
    store.subscribeItem('fluid', onFluid);
    const fixedView = store.getItemView('fixed');

    store.setContainerSize(800);

    expect(onFixed).not.toHaveBeenCalled();
    expect(store.getItemView('fixed')).toBe(fixedView);
    expect(onFluid).toHaveBeenCalledTimes(1);
    expect(store.getItemView('fluid')!.rect.w).toBe(160);
  });

  it('ignores a resize to the same size', () => {
    const store = editStore();
    const onContainer = vi.fn();
    store.subscribeContainer(onContainer);
    store.setContainerSize(1000, 600);
    expect(onContainer).not.toHaveBeenCalled();
    store.setContainerSize(900, 600);
    expect(onContainer).toHaveBeenCalledTimes(1);
  });

  it('recomputes active sizes from the measured width', () => {
    const store = editStore(twoItemDoc({ sizes: { md: { maxWidth: 900 }, sm: { maxWidth: 600 } } }));
    expect(store.getActiveSizes()).toEqual([]);
    store.setContainerSize(800);
    expect(store.getActiveSizes()).toEqual(['md']);
    store.setContainerSize(500);
    // outermost -> innermost
    expect(store.getActiveSizes()).toEqual(['md', 'sm']);
  });

  it('bumps a px-anchored item when the stacking state changes its rect', () => {
    const store = editStore();
    const onFixed = vi.fn();
    store.subscribeItem('a', onFixed);

    store.setContainerSize(700); // still free placement
    expect(onFixed).not.toHaveBeenCalled();
    expect(store.isStacked()).toBe(false);

    store.setContainerSize(400); // below the default stackBelow of 480
    expect(store.isStacked()).toBe(true);
    expect(onFixed).toHaveBeenCalledTimes(1);
    expect(store.getItemView('a')!.rect).toEqual({ x: 0, y: 0, w: 400, h: 50 });
    // second item stacks below the first, separated by the 8px stack gap
    expect(store.getItemView('b')!.rect).toEqual({ x: 0, y: 58, w: 400, h: 50 });
  });

  it('disables tier-3 and the size cascade under responsive:"scale"', () => {
    const store = editStore(
      twoItemDoc({ responsive: 'scale', sizes: { md: { maxWidth: 900 } } }),
    );
    store.setContainerSize(300);
    expect(store.isStacked()).toBe(false);
    expect(store.getActiveSizes()).toEqual([]);
    // resolution stays in design space
    expect(store.getItemView('a')!.rect).toEqual({ x: 10, y: 10, w: 100, h: 50 });
  });
});

/* ------------------------------------------------------------------ */
/* commits                                                             */
/* ------------------------------------------------------------------ */

describe('commits', () => {
  it('preserves each axis’s current mode when re-encoding', () => {
    const doc = makeDoc(
      [
        {
          id: 'a',
          z: 'a0',
          x: { mode: 'end', offset: 100, size: 200 },
          y: { mode: 'center', offset: 0, size: 50 },
        },
      ],
      { height: 'fill' },
    );
    const store = createStore(doc, { mode: 'edit' });
    store.moveItem('a', { x: 300, y: 100, w: 200, h: 50 });
    const next = store.getItem('a')!;
    expect(next.x.mode).toBe('end');
    expect(next.y.mode).toBe('center');
    expect(store.getItemView('a')!.rect).toEqual({ x: 300, y: 100, w: 200, h: 50 });
  });

  it('re-encodes against the design extent under responsive:"scale"', () => {
    const store = editStore(twoItemDoc({ responsive: 'scale' }));
    store.setContainerSize(500); // the canvas is transform-scaled, not reflowed
    store.moveItem('a', { x: 250, y: 30, w: 100, h: 50 });
    // written in design space (base.width = 1000), not against the 500px box
    expect(store.getItem('a')!.x).toEqual({ mode: 'start', offset: 250, size: 100 });
    expect(store.getItemView('a')!.rect).toEqual({ x: 250, y: 30, w: 100, h: 50 });
  });

  it('labels moves and resizes distinctly', () => {
    const store = editStore();
    const moved = store.moveItem('a', { x: 40, y: 60, w: 100, h: 50 });
    expect(moved.tx!.label).toEqual({ kind: 'move', ids: ['a'] });
    const resized = store.resizeItem('a', { x: 40, y: 60, w: 220, h: 90 });
    expect(resized.tx!.label).toEqual({ kind: 'resize', ids: ['a'] });
  });

  it('records nothing when an item is dropped where it was picked up', () => {
    const store = editStore();
    const onA = vi.fn();
    store.subscribeItem('a', onA);
    const result = store.moveItem('a', { x: 10, y: 10, w: 100, h: 50 });
    expect(result.status).toBe('empty');
    expect(result.tx).toBeUndefined();
    expect(store.canUndo()).toBe(false);
    expect(onA).not.toHaveBeenCalled();
  });

  it('blocks moves of locked items', () => {
    const store = editStore(
      makeDoc([item('a', 'a0', { x: 10, y: 10, w: 100, h: 50 }, { locked: true })]),
    );
    expect(store.moveItem('a', { x: 99, y: 99, w: 100, h: 50 }).status).toBe('blocked');
    expect(store.getItemView('a')!.rect.x).toBe(10);
  });

  it('assigns a top z key to an added item that has none', () => {
    const store = editStore();
    const added = { id: 'c', x: px(0, 10), y: px(0, 10) } as unknown as LayoutItem;
    store.addItem(added);
    expect(store.getOrder()).toEqual(['a', 'b', 'c']);
    expect(typeof store.getItem('c')!.z).toBe('string');
    expect(store.getItem('c')!.z > 'a1').toBe(true);
  });

  it('bringToFront/sendToBack change exactly one key', () => {
    const store = editStore(
      makeDoc([
        item('a', 'a0', { x: 0, y: 0, w: 10, h: 10 }),
        item('b', 'a1', { x: 0, y: 0, w: 10, h: 10 }),
        item('c', 'a2', { x: 0, y: 0, w: 10, h: 10 }),
      ]),
    );
    const before = new Map(store.getOrder().map((id) => [id, store.getItem(id)!.z]));
    const result = store.bringToFront('a');
    expect(result.status).toBe('applied');
    expect(result.tx!.ops).toHaveLength(1);
    expect(store.getOrder()).toEqual(['b', 'c', 'a']);
    expect(store.getItem('b')!.z).toBe(before.get('b'));
    expect(store.getItem('c')!.z).toBe(before.get('c'));

    store.sendToBack('a');
    expect(store.getOrder()).toEqual(['a', 'b', 'c']);
    // already at the requested edge
    expect(store.sendToBack('a').status).toBe('empty');
  });
});

/* ------------------------------------------------------------------ */
/* setAnchor                                                           */
/* ------------------------------------------------------------------ */

describe('setAnchor', () => {
  it('changes the x encoding without moving the item', () => {
    const store = editStore();
    const before = store.getItemView('a')!.rect;
    store.setAnchor('a', 'x', 'end');
    expect(store.getItem('a')!.x).toEqual({ mode: 'end', offset: 890, size: 100 });
    expect(store.getItemView('a')!.rect).toEqual(before);
  });

  it('changes the y encoding without moving the item under height:"fill"', () => {
    const store = editStore(twoItemDoc({ height: 'fill' }));
    store.setContainerSize(1000, 600);
    const before = store.getItemView('a')!.rect;
    store.setAnchor('a', 'y', 'center');
    expect(store.getItem('a')!.y.mode).toBe('center');
    expect(store.getItemView('a')!.rect).toEqual(before);
  });

  it('survives every mode round trip without moving the item', () => {
    const store = editStore(twoItemDoc({ height: 'fill' }));
    store.setContainerSize(1000, 600);
    const before = store.getItemView('a')!.rect;
    for (const mode of ['end', 'both', 'center', 'scale', 'start'] as const) {
      store.setAnchor('a', 'x', mode);
      expect(store.getItem('a')!.x.mode).toBe(mode);
      const rect = store.getItemView('a')!.rect;
      expect(Math.abs(rect.x - before.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(rect.w - before.w)).toBeLessThanOrEqual(0.5);
    }
  });

  it('is a no-op when the mode is already active', () => {
    const store = editStore();
    expect(store.setAnchor('a', 'x', 'start').status).toBe('empty');
    expect(store.canUndo()).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* responsive commit targeting (§1.19)                                 */
/* ------------------------------------------------------------------ */

describe('commit targeting when a named size is active', () => {
  const sized = () => twoItemDoc({ sizes: { md: { maxWidth: 900 }, sm: { maxWidth: 600 } } });

  it('writes placeAt into the innermost active size, leaving base untouched', () => {
    const store = editStore(sized());
    store.setContainerSize(500); // md + sm active
    const baseX = store.getItem('a')!.x;

    const result = store.moveItem('a', { x: 20, y: 30, w: 100, h: 50 });

    expect(result.status).toBe('applied');
    expect(result.tx!.ops[0]!.type).toBe('placeAt');
    expect(result.tx!.label).toEqual({ kind: 'move', ids: ['a'], size: 'sm' });
    const next = store.getItem('a')!;
    expect(next.x).toEqual(baseX); // base untouched
    expect(next.at!.sm!.x).toEqual({ mode: 'start', offset: 20, size: 100 });
    expect(next.at!.md).toBeUndefined();
    expect(store.getItemView('a')!.rect).toEqual({ x: 20, y: 30, w: 100, h: 50 });
  });

  it('mutates base fields when no size is active', () => {
    const store = editStore(sized());
    const result = store.moveItem('a', { x: 20, y: 30, w: 100, h: 50 });
    expect(result.tx!.ops[0]!.type).toBe('move');
    expect(result.tx!.label.size).toBeUndefined();
    expect(store.getItem('a')!.at).toBeUndefined();
  });

  it('re-encodes against the folded mode of the active size', () => {
    const doc = sized();
    doc.items[0]!.at = { md: { x: { mode: 'end', offset: 50, size: 100 } } };
    const store = editStore(doc);
    store.setContainerSize(800); // md active
    store.moveItem('a', { x: 100, y: 30, w: 100, h: 50 });
    const override = store.getItem('a')!.at!.md!;
    expect(override.x!.mode).toBe('end');
    expect(store.getItemView('a')!.rect.x).toBe(100);
  });

  it('undo of a first placeAt DELETES the override key rather than writing null', () => {
    const store = editStore(sized());
    store.setContainerSize(800);
    store.moveItem('a', { x: 20, y: 30, w: 100, h: 50 });
    expect(store.getItem('a')!.at!.md).toBeDefined();

    expect(store.undo().status).toBe('applied');

    const after = store.getItem('a')!;
    const hasKey = after.at !== undefined && Object.prototype.hasOwnProperty.call(after.at, 'md');
    expect(hasKey).toBe(false);
    expect(JSON.stringify(after)).not.toContain('null');
  });
});

/* ------------------------------------------------------------------ */
/* history                                                             */
/* ------------------------------------------------------------------ */

describe('undo / redo', () => {
  it('round-trips a move', () => {
    const store = editStore();
    const before = store.getItemView('a')!.rect;
    store.moveItem('a', { x: 400, y: 200, w: 100, h: 50 });
    expect(store.canUndo()).toBe(true);

    const undone = store.undo();
    expect(undone.status).toBe('applied');
    expect(store.getItemView('a')!.rect).toEqual(before);
    expect(store.canRedo()).toBe(true);

    const redone = store.redo();
    expect(redone.status).toBe('applied');
    expect(store.getItemView('a')!.rect).toEqual({ x: 400, y: 200, w: 100, h: 50 });
  });

  it('undoes several transactions in reverse and redoes them in order', () => {
    const store = editStore();
    store.moveItem('a', { x: 100, y: 100, w: 100, h: 50 });
    store.moveItem('a', { x: 200, y: 200, w: 100, h: 50 });
    store.moveItem('a', { x: 300, y: 300, w: 100, h: 50 });

    store.undo();
    expect(store.getItemView('a')!.rect.x).toBe(200);
    store.undo();
    expect(store.getItemView('a')!.rect.x).toBe(100);

    store.redo();
    expect(store.getItemView('a')!.rect.x).toBe(200);
    store.redo();
    expect(store.getItemView('a')!.rect.x).toBe(300);
    expect(store.canRedo()).toBe(false);
  });

  it('inverts a multi-op transaction in reverse order', () => {
    const store = editStore();
    const a = store.getItem('a')!;
    const b = store.getItem('b')!;
    const ops: Op[] = [
      {
        type: 'move',
        id: 'a',
        before: { x: a.x, y: a.y },
        after: { x: px(500, 100), y: px(500, 50) },
      },
      {
        type: 'move',
        id: 'b',
        before: { x: b.x, y: b.y },
        after: { x: px(600, 100), y: px(600, 50) },
      },
    ];
    const result = store.apply(ops, { label: { kind: 'move', ids: ['a', 'b'] } });
    expect(result.status).toBe('applied');
    expect(store.getItemView('a')!.rect.x).toBe(500);
    expect(store.getItemView('b')!.rect.x).toBe(600);

    store.undo();
    expect(store.getItemView('a')!.rect.x).toBe(10);
    expect(store.getItemView('b')!.rect.x).toBe(300);
  });

  it('restores the selection to the affected ids', () => {
    const store = editStore();
    store.setSelection(['a']);
    store.moveItem('a', { x: 400, y: 200, w: 100, h: 50 });
    store.setSelection(['b']);
    expect(store.getSelection()).toEqual(['b']);

    const onSelection = vi.fn();
    store.subscribeSelection(onSelection);
    store.undo();

    expect(store.getSelection()).toEqual(['a']);
    expect(onSelection).toHaveBeenCalledTimes(1);
    expect(store.getItemView('a')!.selected).toBe(true);
    expect(store.getItemView('b')!.selected).toBe(false);
  });

  it('is blocked in view mode', () => {
    const store = editStore();
    store.moveItem('a', { x: 400, y: 200, w: 100, h: 50 });
    store.setMode('view');

    expect(store.undo()).toEqual({ status: 'blocked', skipped: [] });
    expect(store.redo()).toEqual({ status: 'blocked', skipped: [] });
    expect(store.canUndo()).toBe(false);
    expect(store.getItemView('a')!.rect.x).toBe(400);

    store.setMode('edit');
    expect(store.canUndo()).toBe(true);
    expect(store.undo().status).toBe('applied');
  });

  it('records no history while in view mode', () => {
    const store = createStore(twoItemDoc());
    store.moveItem('a', { x: 400, y: 200, w: 100, h: 50 });
    expect(store.getItemView('a')!.rect.x).toBe(400);
    store.setMode('edit');
    expect(store.canUndo()).toBe(false);
  });

  it('skips ops whose target drifted, per onConflict:"skip"', () => {
    const store = editStore();
    store.moveItem('a', { x: 400, y: 200, w: 100, h: 50 });

    // Somebody else moved the item afterwards without recording history.
    store.apply(
      [
        {
          type: 'move',
          id: 'a',
          before: { x: px(400, 100), y: px(200, 50) },
          after: { x: px(700, 100), y: px(700, 50) },
        },
      ],
      { transient: true },
    );

    const result = store.undo();
    expect(result.status).toBe('empty');
    expect(result.skipped).toHaveLength(1);
    // The drifted state is left alone rather than clobbered.
    expect(store.getItemView('a')!.rect.x).toBe(700);
  });

  it('aborts the whole transaction under onConflict:"abort"', () => {
    const store = createStore(twoItemDoc(), { mode: 'edit', onConflict: 'abort' });
    store.moveItem('a', { x: 400, y: 200, w: 100, h: 50 });
    store.apply(
      [
        {
          type: 'move',
          id: 'a',
          before: { x: px(400, 100), y: px(200, 50) },
          after: { x: px(700, 100), y: px(700, 50) },
        },
      ],
      { transient: true },
    );

    const result = store.undo();
    expect(result.status).toBe('blocked');
    expect(store.getItemView('a')!.rect.x).toBe(700);
    // The entry stays available rather than being silently consumed.
    expect(store.canUndo()).toBe(true);
  });

  it('clears the redo stack when a new transaction lands', () => {
    const store = editStore();
    store.moveItem('a', { x: 100, y: 100, w: 100, h: 50 });
    store.undo();
    expect(store.canRedo()).toBe(true);

    store.moveItem('b', { x: 700, y: 100, w: 100, h: 50 });
    expect(store.canRedo()).toBe(false);
  });

  it('records nothing for a transient apply', () => {
    const store = editStore();
    const a = store.getItem('a')!;
    const result = store.apply(
      [
        {
          type: 'move',
          id: 'a',
          before: { x: a.x, y: a.y },
          after: { x: px(400, 100), y: px(400, 50) },
        },
      ],
      { transient: true },
    );
    expect(result.status).toBe('applied');
    expect(store.getItemView('a')!.rect.x).toBe(400);
    expect(store.canUndo()).toBe(false);
  });

  it('exposes the labels of the next undo and redo', () => {
    const store = editStore();
    store.moveItem('a', { x: 100, y: 100, w: 100, h: 50 });
    expect(store.peekUndo()!.label).toEqual({ kind: 'move', ids: ['a'] });
    expect(store.peekRedo()).toBeUndefined();
    store.undo();
    expect(store.peekRedo()!.label).toEqual({ kind: 'move', ids: ['a'] });
  });

  it('returns empty when there is nothing to undo', () => {
    const store = editStore();
    expect(store.undo()).toEqual({ status: 'empty', skipped: [] });
    expect(store.redo()).toEqual({ status: 'empty', skipped: [] });
  });

  it('honors the history depth', () => {
    const store = createStore(twoItemDoc(), { mode: 'edit', historyDepth: 2 });
    store.moveItem('a', { x: 100, y: 100, w: 100, h: 50 });
    store.moveItem('a', { x: 200, y: 100, w: 100, h: 50 });
    store.moveItem('a', { x: 300, y: 100, w: 100, h: 50 });
    expect(store.undo().status).toBe('applied');
    expect(store.undo().status).toBe('applied');
    expect(store.undo().status).toBe('empty');
    expect(store.getItemView('a')!.rect.x).toBe(100);
  });

  it('restores add/remove and notifies the order channel', () => {
    const store = editStore();
    store.removeItem('b');
    expect(store.getOrder()).toEqual(['a']);

    const onOrder = vi.fn();
    store.subscribeOrder(onOrder);
    store.undo();

    expect(store.getOrder()).toEqual(['a', 'b']);
    expect(onOrder).toHaveBeenCalledTimes(1);
    expect(store.getSelection()).toEqual(['b']);
  });
});

/* ------------------------------------------------------------------ */
/* selection, interaction, nodes, lifecycle                            */
/* ------------------------------------------------------------------ */

describe('selection', () => {
  it('deduplicates and drops unknown ids', () => {
    const store = editStore();
    store.setSelection(['a', 'a', 'ghost', 'b']);
    expect(store.getSelection()).toEqual(['a', 'b']);
  });

  it('does not notify when the selection is unchanged', () => {
    const store = editStore();
    store.setSelection(['a']);
    const onSelection = vi.fn();
    store.subscribeSelection(onSelection);
    store.setSelection(['a']);
    expect(onSelection).not.toHaveBeenCalled();
  });
});

describe('interaction channel', () => {
  it('never bumps item snapshots', () => {
    const store = editStore();
    const a = store.getItemView('a');
    const onA = vi.fn();
    store.subscribeItem('a', onA);

    store.setInteraction({
      phase: 'dragging',
      ids: ['a'],
      rects: new Map([['a', { x: 99, y: 99, w: 100, h: 50 }]]),
      guides: [],
      valid: true,
      lastValidRects: null,
    });

    expect(store.getInteraction().phase).toBe('dragging');
    expect(store.getItemView('a')).toBe(a);
    expect(onA).not.toHaveBeenCalled();
  });

  it('registers and clears DOM nodes without touching the DOM', () => {
    const store = editStore();
    const fake = { nodeName: 'DIV' } as unknown as HTMLElement;
    store.registerNode('a', fake);
    expect(store.getNode('a')).toBe(fake);
    store.registerNode('a', null);
    expect(store.getNode('a')).toBeNull();
  });
});

describe('lifecycle', () => {
  it('drops every subscriber on destroy', () => {
    const store = editStore();
    const onItem = vi.fn();
    const onDoc = vi.fn();
    const onInteraction = vi.fn();
    store.subscribeItem('a', onItem);
    store.subscribeDoc(onDoc);
    store.subscribeInteraction(onInteraction);

    store.destroy();
    store.moveItem('a', { x: 400, y: 400, w: 100, h: 50 });
    store.setInteraction({ phase: 'placing', id: 'a' });

    expect(onItem).not.toHaveBeenCalled();
    expect(onDoc).not.toHaveBeenCalled();
    expect(onInteraction).not.toHaveBeenCalled();
    expect(store.getItemView('a')!.rect.x).toBe(10);
  });

  it('signals runaway fractional key growth', () => {
    const onKeyGrowth = vi.fn();
    const longKey = 'a'.repeat(44);
    createStore(makeDoc([item('a', longKey, { x: 0, y: 0, w: 10, h: 10 })]), {
      mode: 'edit',
      onKeyGrowth,
    });
    expect(onKeyGrowth).toHaveBeenCalledWith({ maxLength: 44 });
  });

  it('tolerates unknown ids and empty op lists', () => {
    const store = editStore();
    expect(store.apply([]).status).toBe('empty');
    expect(store.moveItem('ghost', { x: 0, y: 0, w: 1, h: 1 }).status).toBe('empty');
    expect(store.removeItem('ghost').status).toBe('empty');
    expect(store.bringToFront('ghost').status).toBe('empty');
    expect(store.setAnchor('ghost', 'x', 'end').status).toBe('empty');
    expect(store.getItemView('ghost')).toBeUndefined();
    expect(store.getServerItemView('ghost')).toBeUndefined();
  });
});
