/**
 * Undo/redo semantics matrix (spec §15.5).
 *
 * Every row below pins one clause of spec §8 at the STORE level, because that
 * is the altitude a consumer experiences undo at: a gesture is one entry, an
 * entry replays against whatever the document has since become, and the
 * document that comes back must be the document that was there before —
 * including the ABSENCE of keys the edit created.
 *
 * The three claims a dashboard team actually cares about, and which this file
 * is the evidence for:
 *
 * 1. One gesture is one undo. A three-item multi-select drag is not three
 *    presses of Cmd+Z.
 * 2. Undo never silently loses newer work. An entry touching a since-deleted
 *    item reports that op as `skipped` and applies the rest.
 * 3. Undo restores documents, not just values. An override created at a
 *    breakpoint is DELETED on undo — the key is gone, not set to null.
 */

import { describe, expect, it } from 'vitest';
import type { LayoutDoc, LayoutItem, Op, Rect, VizbrixStore } from '../schema/types';
import { createStore } from '../store/store';
import { deriveLabel } from './ops';

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

function px(offset: number, size: number) {
  return { mode: 'start', offset, size } as const;
}

/**
 * Three items, both axes anchored in pixels, `md` declared but NOT active at
 * the base width — so ordinary commits target the base fields and the one row
 * that exercises `at` does so explicitly.
 */
function baseDoc(): LayoutDoc {
  return {
    version: 1,
    container: {
      base: { width: 1000, height: 600 },
      height: 'fill',
      sizes: { md: { maxWidth: 900 } },
      stackBelow: 0,
    },
    items: [
      { id: 'a', z: 'a0', x: px(0, 100), y: px(0, 80) },
      { id: 'b', z: 'a1', x: px(200, 100), y: px(0, 80) },
      { id: 'c', z: 'a2', x: px(400, 100), y: px(0, 80) },
    ],
  };
}

function editStore(): VizbrixStore {
  return createStore(baseDoc(), { mode: 'edit' });
}

function rectOf(store: VizbrixStore, id: string): Rect {
  const view = store.getItemView(id);
  if (!view) throw new Error(`no item view for ${id}`);
  return view.rect;
}

/** A `move` op built from observed state, the way an interaction commits one. */
function moveOp(store: VizbrixStore, id: string, dx: number): Op {
  const item = store.getItem(id);
  if (!item) throw new Error(`no item ${id}`);
  const before = { x: item.x, y: item.y };
  const rect = rectOf(store, id);
  return {
    type: 'move',
    id,
    before,
    after: { x: px(rect.x + dx, rect.w), y: item.y },
  };
}

interface MatrixRow {
  /** The §8 clause this row is evidence for. */
  clause: string;
  run(): void;
}

/* ------------------------------------------------------------------ */
/* The matrix                                                          */
/* ------------------------------------------------------------------ */

const MATRIX: Record<string, MatrixRow> = {
  'move → undo restores placement and selection': {
    clause: 'inverse-op transactions; undo restores selection to affected ids',
    run() {
      const store = editStore();
      const before = store.getItem('b')!.x;

      expect(store.moveItem('b', { x: 250, y: 40, w: 100, h: 80 }).status).toBe('applied');
      expect(rectOf(store, 'b')).toStrictEqual({ x: 250, y: 40, w: 100, h: 80 });
      expect(store.canUndo()).toBe(true);

      expect(store.undo().status).toBe('applied');
      expect(store.getItem('b')!.x).toStrictEqual(before);
      expect(rectOf(store, 'b')).toStrictEqual({ x: 200, y: 0, w: 100, h: 80 });
      expect(store.getSelection()).toStrictEqual(['b']);
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(true);

      expect(store.redo().status).toBe('applied');
      expect(rectOf(store, 'b')).toStrictEqual({ x: 250, y: 40, w: 100, h: 80 });
    },
  },

  'resize → undo restores the size': {
    clause: 'resize carries the same before/after shape as move',
    run() {
      const store = editStore();
      const before = store.getItem('c')!.x;

      expect(store.resizeItem('c', { x: 400, y: 0, w: 160, h: 120 }).status).toBe('applied');
      expect(rectOf(store, 'c')).toStrictEqual({ x: 400, y: 0, w: 160, h: 120 });
      expect(store.peekUndo()?.label.kind).toBe('resize');

      expect(store.undo().status).toBe('applied');
      expect(store.getItem('c')!.x).toStrictEqual(before);
      expect(rectOf(store, 'c')).toStrictEqual({ x: 400, y: 0, w: 100, h: 80 });
    },
  },

  'remove → undo restores the item at the same z and selects it': {
    clause: 'remove inverts to add; z is persisted state, not a rank',
    run() {
      const store = editStore();
      const original = store.getItem('b')!;

      expect(store.removeItem('b').status).toBe('applied');
      expect(store.getItem('b')).toBeUndefined();
      expect(store.getOrder()).toStrictEqual(['a', 'c']);

      expect(store.undo().status).toBe('applied');
      expect(store.getItem('b')).toStrictEqual(original);
      expect(store.getItem('b')!.z).toBe('a1');
      // Restored BETWEEN its neighbours, not on top of the stack.
      expect(store.getOrder()).toStrictEqual(['a', 'b', 'c']);
      expect(store.getSelection()).toStrictEqual(['b']);
    },
  },

  'add → undo removes the item again': {
    clause: 'add inverts to remove',
    run() {
      const store = editStore();
      const added: LayoutItem = { id: 'd', z: 'a3', x: px(600, 100), y: px(0, 80) };

      expect(store.addItem(added).status).toBe('applied');
      expect(store.getOrder()).toStrictEqual(['a', 'b', 'c', 'd']);
      expect(store.peekUndo()?.label).toStrictEqual({ kind: 'add', ids: ['d'] });

      expect(store.undo().status).toBe('applied');
      expect(store.getItem('d')).toBeUndefined();
      expect(store.getOrder()).toStrictEqual(['a', 'b', 'c']);
      // Nothing to select: the affected item no longer exists.
      expect(store.getSelection()).toStrictEqual([]);
    },
  },

  'placeAt override → undo DELETES the override key entirely': {
    clause: '§1.14 — placeAt with before: undefined DELETES; never writes null',
    run() {
      const store = editStore();
      const override = { x: px(5, 50) };

      const applied = store.apply([
        { type: 'placeAt', id: 'a', size: 'md', before: undefined, after: override },
      ]);
      expect(applied.status).toBe('applied');
      expect(store.getItem('a')!.at).toStrictEqual({ md: override });

      expect(store.undo().status).toBe('applied');

      const item = store.getItem('a')!;
      expect('at' in item).toBe(false);
      expect(item.at).toBeUndefined();
      // The distinction that matters on the wire: the key is GONE, it is not
      // present with a null or an empty object.
      expect(JSON.stringify(item)).not.toContain('"at"');
      expect(JSON.parse(JSON.stringify(item))).toStrictEqual({
        id: 'a',
        z: 'a0',
        x: px(0, 100),
        y: px(0, 80),
      });
    },
  },

  'undo of an op on a since-deleted item → skipped, the rest applies': {
    clause: "rebase-before-invert with onConflict:'skip' reporting TxResult.skipped",
    run() {
      const store = editStore();
      const originalB = store.getItem('b')!.x;
      const ops = [moveOp(store, 'a', 40), moveOp(store, 'b', 40)];

      expect(store.apply(ops).status).toBe('applied');
      // The deletion itself is not recorded, so the next undo targets the move
      // transaction — with one of its two targets gone.
      expect(store.removeItem('a', { transient: true }).status).toBe('applied');

      const undone = store.undo();
      expect(undone.status).toBe('applied');
      expect(undone.skipped).toHaveLength(1);
      expect(undone.skipped[0]).toBe(ops[0]);
      // The survivor was restored; the missing item was not resurrected.
      expect(store.getItem('b')!.x).toStrictEqual(originalB);
      expect(store.getItem('a')).toBeUndefined();
      expect(store.getSelection()).toStrictEqual(['b']);
    },
  },

  'view-mode undo → blocked': {
    clause: '§1.16 — history is frozen in view mode',
    run() {
      const store = editStore();
      expect(store.moveItem('a', { x: 60, y: 0, w: 100, h: 80 }).status).toBe('applied');

      store.setMode('view');
      expect(store.undo()).toStrictEqual({ status: 'blocked', skipped: [] });
      expect(store.redo()).toStrictEqual({ status: 'blocked', skipped: [] });
      expect(store.canUndo()).toBe(false);
      expect(store.canRedo()).toBe(false);
      // Blocked, not discarded: the entry is still there for edit mode.
      expect(rectOf(store, 'a')).toStrictEqual({ x: 60, y: 0, w: 100, h: 80 });

      store.setMode('edit');
      expect(store.canUndo()).toBe(true);
      expect(store.undo().status).toBe('applied');
      expect(rectOf(store, 'a')).toStrictEqual({ x: 0, y: 0, w: 100, h: 80 });
    },
  },

  "no-op transaction → status 'empty', history untouched": {
    clause: '§8 — canceled and no-op gestures are never pushed',
    run() {
      const store = editStore();
      // A drag dropped exactly where it was picked up.
      const dropAtOrigin = store.moveItem('a', rectOf(store, 'a'));
      expect(dropAtOrigin.status).toBe('empty');
      expect(dropAtOrigin.tx).toBeUndefined();
      expect(store.canUndo()).toBe(false);

      expect(store.moveItem('a', { x: 90, y: 0, w: 100, h: 80 }).status).toBe('applied');
      const entry = store.peekUndo();

      expect(store.moveItem('a', rectOf(store, 'a')).status).toBe('empty');
      // Same entry object: nothing was pushed, nothing was popped.
      expect(store.peekUndo()).toBe(entry);
    },
  },

  'redo after a new commit → impossible (the redo branch is discarded)': {
    clause: '§8 — a new transaction clears the redo stack',
    run() {
      const store = editStore();
      expect(store.moveItem('a', { x: 70, y: 0, w: 100, h: 80 }).status).toBe('applied');
      expect(store.undo().status).toBe('applied');
      expect(store.canRedo()).toBe(true);

      expect(store.moveItem('b', { x: 300, y: 0, w: 100, h: 80 }).status).toBe('applied');
      expect(store.canRedo()).toBe(false);
      expect(store.redo().status).toBe('empty');
      // The forked branch is gone; the item stays where the newer edit left it.
      expect(rectOf(store, 'a')).toStrictEqual({ x: 0, y: 0, w: 100, h: 80 });
      expect(rectOf(store, 'b')).toStrictEqual({ x: 300, y: 0, w: 100, h: 80 });
    },
  },

  'multi-op transaction (3 moves) → ONE undo reverts all three': {
    clause: '§8 — one gesture / multi-select drag is ONE transaction',
    run() {
      const store = editStore();
      const ops = [moveOp(store, 'a', 50), moveOp(store, 'b', 50), moveOp(store, 'c', 50)];

      const applied = store.apply(ops);
      expect(applied.status).toBe('applied');
      expect(applied.tx?.ops).toHaveLength(3);
      expect(applied.tx?.label).toStrictEqual({ kind: 'move', ids: ['a', 'b', 'c'] });
      expect(rectOf(store, 'a').x).toBe(50);
      expect(rectOf(store, 'b').x).toBe(250);
      expect(rectOf(store, 'c').x).toBe(450);

      expect(store.undo().status).toBe('applied');
      expect(rectOf(store, 'a').x).toBe(0);
      expect(rectOf(store, 'b').x).toBe(200);
      expect(rectOf(store, 'c').x).toBe(400);
      // ONE entry, not three.
      expect(store.canUndo()).toBe(false);
      expect(store.getSelection()).toStrictEqual(['a', 'b', 'c']);
    },
  },
};

describe('undo/redo semantics matrix (spec §8)', () => {
  for (const [name, row] of Object.entries(MATRIX)) {
    it(`${name}  [${row.clause}]`, row.run);
  }
});

describe('undo labels', () => {
  it('names the ids a transaction touched', () => {
    const store = editStore();
    store.apply([moveOp(store, 'a', 10), moveOp(store, 'c', 10)]);
    expect(store.peekUndo()?.label).toStrictEqual(deriveLabel(store.peekUndo()!.ops));
    expect(store.peekUndo()?.label.ids).toStrictEqual(['a', 'c']);
  });

  it('records the source of the transaction', () => {
    const store = editStore();
    store.moveItem('a', { x: 33, y: 0, w: 100, h: 80 }, { source: 'keyboard' });
    expect(store.peekUndo()?.source).toBe('keyboard');
  });
});
