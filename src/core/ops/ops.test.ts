/**
 * Op algebra unit + property tests.
 *
 * These run against `ops.ts` and `schema/types.ts` alone. The seeded document
 * generator is inlined rather than imported from `schema/testing.ts` on
 * purpose: the op algebra is a LEAF of the dependency graph (its only import is
 * `geometry/len`), and a property test that dragged in the schema module would
 * make a failure here indistinguishable from a failure there.
 */

import { describe, expect, it } from 'vitest';
import type {
  AxisMode,
  AxisPlacement,
  ItemOverride,
  LayoutDoc,
  LayoutItem,
  Len,
  Op,
} from '../schema/types';
import { affectedIds, applyOp, deriveLabel, invertOp, rebaseOk } from './ops';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

type Doc = LayoutDoc<unknown>;
type Item = LayoutItem<unknown>;

function start(offset: Len, size: Len): AxisPlacement {
  return { mode: 'start', offset, size };
}

function item(id: string, z: string, extra: Partial<Item> = {}): Item {
  return { id, z, x: start(10, 100), y: start(20, 50), ...extra } as Item;
}

function docOf(...items: Item[]): Doc {
  return { version: 1, container: { base: { width: 1000, height: 600 } }, items };
}

/** As `LayoutItem<never>`, the shape the `add`/`remove` ops declare. */
function asOpItem(value: Item): LayoutItem<never> {
  return value as unknown as LayoutItem<never>;
}

/** Freeze a document all the way down so any mutation throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* applyOp — purity and structural sharing                             */
/* ------------------------------------------------------------------ */

describe('applyOp — purity and structural sharing', () => {
  const base = deepFreeze(docOf(item('a', 'a0'), item('b', 'a1'), item('c', 'a2')));

  it('leaves the input document untouched', () => {
    const snapshot = JSON.parse(JSON.stringify(base)) as Doc;
    applyOp(base, { type: 'move', id: 'b', before: { x: base.items[1]!.x, y: base.items[1]!.y }, after: { x: start(1, 2), y: start(3, 4) } });
    expect(JSON.parse(JSON.stringify(base))).toStrictEqual(snapshot);
  });

  it('shares every untouched item by reference', () => {
    const next = applyOp(base, {
      type: 'move',
      id: 'b',
      before: { x: base.items[1]!.x, y: base.items[1]!.y },
      after: { x: start(1, 2), y: start(3, 4) },
    });
    expect(next).not.toBe(base);
    expect(next.items).not.toBe(base.items);
    expect(next.items[0]).toBe(base.items[0]);
    expect(next.items[2]).toBe(base.items[2]);
    expect(next.items[1]).not.toBe(base.items[1]);
  });

  it('shares the container config by reference', () => {
    const next = applyOp(base, { type: 'setHidden', id: 'a', before: false, after: true });
    expect(next.container).toBe(base.container);
  });

  it('keeps sibling identity when an item is added or removed', () => {
    const added = applyOp(base, { type: 'add', item: asOpItem(item('d', 'a15')) });
    expect(added.items.map((i) => i.id)).toStrictEqual(['a', 'b', 'd', 'c']);
    expect(added.items[0]).toBe(base.items[0]);
    expect(added.items[1]).toBe(base.items[1]);
    expect(added.items[3]).toBe(base.items[2]);

    const removed = applyOp(base, { type: 'remove', item: asOpItem(base.items[1]!) });
    expect(removed.items.map((i) => i.id)).toStrictEqual(['a', 'c']);
    expect(removed.items[0]).toBe(base.items[0]);
    expect(removed.items[1]).toBe(base.items[2]);
  });

  it('preserves $unknown and data on the patched item', () => {
    const rich = deepFreeze(
      docOf(item('a', 'a0', { $unknown: { futureFlag: 7 }, data: { kind: 'chart' } } as Partial<Item>)),
    );
    const next = applyOp(rich, { type: 'setLocked', id: 'a', before: false, after: true });
    expect(next.items[0]!.$unknown).toStrictEqual({ futureFlag: 7 });
    expect(next.items[0]!.$unknown).toBe(rich.items[0]!.$unknown);
    expect((next.items[0] as { data?: unknown }).data).toBe((rich.items[0] as { data?: unknown }).data);
    expect(next.items[0]!.locked).toBe(true);
  });

  it('preserves document-level $unknown', () => {
    const doc = deepFreeze({ ...docOf(item('a', 'a0')), $unknown: { futureDoc: true } } as Doc);
    const next = applyOp(doc, { type: 'setOrder', id: 'a', before: undefined, after: 3 });
    expect(next.$unknown).toBe(doc.$unknown);
  });
});

describe('applyOp — no-ops return the same document reference', () => {
  const doc = deepFreeze(docOf(item('a', 'a0', { order: 2, hidden: true, at: { md: { hidden: true } } })));

  const noops: ReadonlyArray<readonly [string, Op]> = [
    ['move to the same placement', { type: 'move', id: 'a', before: { x: start(10, 100), y: start(20, 50) }, after: { x: start(10, 100), y: start(20, 50) } }],
    ['move re-encoded as an equivalent Len', { type: 'move', id: 'a', before: { x: start(10, 100), y: start(20, 50) }, after: { x: start({ px: 10 }, { pct: 0, px: 100 }), y: start({ px: 20 }, 50) } }],
    ['resize to the same placement', { type: 'resize', id: 'a', before: { x: start(10, 100), y: start(20, 50) }, after: { x: start(10, 100), y: start(20, 50) } }],
    ['setZ to the current key', { type: 'setZ', id: 'a', before: 'a0', after: 'a0' }],
    ['setHidden to the current flag', { type: 'setHidden', id: 'a', before: true, after: true }],
    ['setLocked false on an item without the key', { type: 'setLocked', id: 'a', before: false, after: false }],
    ['setOrder to the current order', { type: 'setOrder', id: 'a', before: 2, after: 2 }],
    ['setData undefined on an item without data', { type: 'setData', id: 'a', before: undefined, after: undefined }],
    ['placeAt with an equal override', { type: 'placeAt', id: 'a', size: 'md', before: { hidden: true }, after: { hidden: true } }],
    ['placeAt deleting an override that does not exist', { type: 'placeAt', id: 'a', size: 'sm', before: undefined, after: undefined }],
  ];

  for (const [name, op] of noops) {
    it(name, () => {
      expect(applyOp(doc, op)).toBe(doc);
    });
  }
});

/* ------------------------------------------------------------------ */
/* applyOp — per-op semantics                                          */
/* ------------------------------------------------------------------ */

describe('applyOp — semantics', () => {
  it('inserts an added item at its z position, not at the end', () => {
    const doc = docOf(item('a', 'a0'), item('c', 'a2'));
    const next = applyOp(doc, { type: 'add', item: asOpItem(item('b', 'a1')) });
    expect(next.items.map((i) => i.id)).toStrictEqual(['a', 'b', 'c']);
  });

  it('re-sorts on setZ', () => {
    const doc = docOf(item('a', 'a0'), item('b', 'a1'), item('c', 'a2'));
    const next = applyOp(doc, { type: 'setZ', id: 'a', before: 'a0', after: 'a5' });
    expect(next.items.map((i) => i.id)).toStrictEqual(['b', 'c', 'a']);
    expect(next.items[2]!.z).toBe('a5');
  });

  it('breaks equal z keys by id so the order is total', () => {
    const doc = docOf(item('b', 'a0'), item('d', 'a0'));
    const next = applyOp(doc, { type: 'add', item: asOpItem(item('c', 'a0')) });
    expect(next.items.map((i) => i.id)).toStrictEqual(['b', 'c', 'd']);
  });

  it('writes, replaces and DELETES a size override', () => {
    const doc = docOf(item('a', 'a0'));
    const override: ItemOverride = { x: start(5, 60) };

    const written = applyOp(doc, { type: 'placeAt', id: 'a', size: 'md', before: undefined, after: override });
    expect(written.items[0]!.at).toStrictEqual({ md: override });

    const second = applyOp(written, { type: 'placeAt', id: 'a', size: 'sm', before: undefined, after: { hidden: true } });
    expect(Object.keys(second.items[0]!.at!)).toStrictEqual(['md', 'sm']);

    const oneLeft = applyOp(second, { type: 'placeAt', id: 'a', size: 'sm', before: { hidden: true }, after: undefined });
    expect(oneLeft.items[0]!.at).toStrictEqual({ md: override });

    const cleared = applyOp(oneLeft, { type: 'placeAt', id: 'a', size: 'md', before: override, after: undefined });
    // The whole `at` map goes with the last override — never left as `{}`,
    // never written as null.
    expect('at' in cleared.items[0]!).toBe(false);
    expect(JSON.stringify(cleared.items[0])).not.toContain('at');
  });

  it('encodes a false flag as absence, never as a redundant false', () => {
    const doc = docOf(item('a', 'a0'));
    const hidden = applyOp(doc, { type: 'setHidden', id: 'a', before: false, after: true });
    expect(hidden.items[0]!.hidden).toBe(true);
    const shown = applyOp(hidden, { type: 'setHidden', id: 'a', before: true, after: false });
    expect('hidden' in shown.items[0]!).toBe(false);
  });

  it('deletes order and data when the op sets them to undefined', () => {
    const doc = docOf(item('a', 'a0', { order: 4, data: { n: 1 } } as Partial<Item>));
    const noOrder = applyOp(doc, { type: 'setOrder', id: 'a', before: 4, after: undefined });
    expect('order' in noOrder.items[0]!).toBe(false);
    const noData = applyOp(doc, { type: 'setData', id: 'a', before: { n: 1 }, after: undefined });
    expect('data' in noData.items[0]!).toBe(false);
  });

  it('replaces the document wholesale', () => {
    const before = docOf(item('a', 'a0'));
    const after = docOf(item('x', 'a0'), item('y', 'a1'));
    const next = applyOp(before, {
      type: 'replaceDoc',
      before: before as unknown as LayoutDoc<never>,
      after: after as unknown as LayoutDoc<never>,
    });
    expect(next).toBe(after);
  });

  it('throws rather than corrupting when the target is missing or duplicated', () => {
    const doc = docOf(item('a', 'a0'));
    expect(() => applyOp(doc, { type: 'setZ', id: 'ghost', before: 'a0', after: 'a1' })).toThrow(/no item/);
    expect(() => applyOp(doc, { type: 'remove', item: asOpItem(item('ghost', 'a0')) })).toThrow(/no item/);
    expect(() => applyOp(doc, { type: 'add', item: asOpItem(item('a', 'a9')) })).toThrow(/already exists/);
    expect(() => applyOp(doc, { type: 'bogus' } as unknown as Op)).toThrow();
  });
});

/* ------------------------------------------------------------------ */
/* invertOp                                                            */
/* ------------------------------------------------------------------ */

describe('invertOp', () => {
  it('turns add into remove and back', () => {
    const op: Op = { type: 'add', item: asOpItem(item('a', 'a0')) };
    expect(invertOp(op)).toStrictEqual({ type: 'remove', item: op.item });
    expect(invertOp(invertOp(op))).toStrictEqual(op);
  });

  it('swaps before and after for every endpoint op', () => {
    const ops: Op[] = [
      { type: 'move', id: 'a', before: { x: start(0, 1), y: start(0, 1) }, after: { x: start(2, 3), y: start(2, 3) } },
      { type: 'resize', id: 'a', before: { x: start(0, 1), y: start(0, 1) }, after: { x: start(2, 3), y: start(2, 3) } },
      { type: 'setZ', id: 'a', before: 'a0', after: 'a1' },
      { type: 'placeAt', id: 'a', size: 'md', before: undefined, after: { hidden: true } },
      { type: 'setHidden', id: 'a', before: false, after: true },
      { type: 'setLocked', id: 'a', before: false, after: true },
      { type: 'setOrder', id: 'a', before: undefined, after: 2 },
      { type: 'setData', id: 'a', before: undefined, after: { n: 1 } },
    ];
    for (const op of ops) {
      const inverted = invertOp(op) as Extract<Op, { before: unknown }>;
      expect(inverted.type).toBe(op.type);
      expect(inverted.before).toStrictEqual((op as Extract<Op, { before: unknown }>).after);
      expect(inverted.after).toStrictEqual((op as Extract<Op, { before: unknown }>).before);
      expect(invertOp(invertOp(op))).toStrictEqual(op);
    }
  });

  it('inverts a placeAt that created an override into a DELETE', () => {
    const op: Op = { type: 'placeAt', id: 'a', size: 'md', before: undefined, after: { hidden: true } };
    const inverted = invertOp(op) as Extract<Op, { type: 'placeAt' }>;
    expect(inverted.after).toBeUndefined();
  });

  it('does not consult a document', () => {
    // Inversion is a pure swap: no argument beyond the op itself.
    expect(invertOp.length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* rebaseOk                                                            */
/* ------------------------------------------------------------------ */

describe('rebaseOk', () => {
  const doc = docOf(item('a', 'a0', { order: 1 }), item('b', 'a1'));

  it('accepts an op whose `after` still describes the document', () => {
    expect(rebaseOk(doc, { type: 'move', id: 'a', before: { x: start(0, 0), y: start(0, 0) }, after: { x: start(10, 100), y: start(20, 50) } })).toBe(true);
    expect(rebaseOk(doc, { type: 'setZ', id: 'a', before: 'zz', after: 'a0' })).toBe(true);
    expect(rebaseOk(doc, { type: 'setOrder', id: 'a', before: undefined, after: 1 })).toBe(true);
    expect(rebaseOk(doc, { type: 'setHidden', id: 'a', before: true, after: false })).toBe(true);
  });

  it('rejects an op whose `after` has been overwritten', () => {
    expect(rebaseOk(doc, { type: 'move', id: 'a', before: { x: start(0, 0), y: start(0, 0) }, after: { x: start(11, 100), y: start(20, 50) } })).toBe(false);
    expect(rebaseOk(doc, { type: 'setZ', id: 'a', before: 'a0', after: 'a9' })).toBe(false);
  });

  it('rejects any op on a since-deleted item', () => {
    expect(rebaseOk(doc, { type: 'move', id: 'gone', before: { x: start(0, 0), y: start(0, 0) }, after: { x: start(0, 0), y: start(0, 0) } })).toBe(false);
    expect(rebaseOk(doc, { type: 'setData', id: 'gone', before: undefined, after: 1 })).toBe(false);
  });

  it('reads add as "the item is present" and remove as "the item is gone"', () => {
    // `after` for add is the item existing; for remove it is the item's absence.
    expect(rebaseOk(doc, { type: 'add', item: asOpItem(doc.items[0]!) })).toBe(true);
    expect(rebaseOk(doc, { type: 'add', item: asOpItem(item('a', 'a0', { order: 99 })) })).toBe(false);
    expect(rebaseOk(doc, { type: 'add', item: asOpItem(item('ghost', 'a0')) })).toBe(false);
    expect(rebaseOk(doc, { type: 'remove', item: asOpItem(item('ghost', 'a0')) })).toBe(true);
    expect(rebaseOk(doc, { type: 'remove', item: asOpItem(doc.items[0]!) })).toBe(false);
  });

  it('is Len-canonicalization tolerant', () => {
    expect(rebaseOk(doc, { type: 'move', id: 'a', before: { x: start(0, 0), y: start(0, 0) }, after: { x: start({ px: 10 }, { px: 100, pct: 0 }), y: start(20, { px: 50 }) } })).toBe(true);
  });

  it('compares size overrides structurally, including absence', () => {
    const withAt = applyOp(doc, { type: 'placeAt', id: 'a', size: 'md', before: undefined, after: { hidden: true } });
    expect(rebaseOk(withAt, { type: 'placeAt', id: 'a', size: 'md', before: undefined, after: { hidden: true } })).toBe(true);
    expect(rebaseOk(withAt, { type: 'placeAt', id: 'a', size: 'md', before: undefined, after: undefined })).toBe(false);
    expect(rebaseOk(doc, { type: 'placeAt', id: 'a', size: 'md', before: { hidden: true }, after: undefined })).toBe(true);
  });

  it('never throws on malformed input', () => {
    expect(rebaseOk(doc, null as unknown as Op)).toBe(false);
    expect(rebaseOk(doc, { type: 'nope' } as unknown as Op)).toBe(false);
  });

  it('answers redo as rebaseOk(doc, invertOp(op))', () => {
    const op: Op = { type: 'setZ', id: 'a', before: 'a0', after: 'a5' };
    // Before the op is applied the document matches its `before`, i.e. the
    // inverse's `after` — which is exactly the redo precondition.
    expect(rebaseOk(doc, invertOp(op))).toBe(true);
    const applied = applyOp(doc, op);
    expect(rebaseOk(applied, op)).toBe(true);
    expect(rebaseOk(applied, invertOp(op))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* labels                                                              */
/* ------------------------------------------------------------------ */

describe('affectedIds / deriveLabel', () => {
  it('dedupes ids in first-appearance order', () => {
    expect(
      affectedIds([
        { type: 'move', id: 'b', before: { x: start(0, 0), y: start(0, 0) }, after: { x: start(1, 1), y: start(1, 1) } },
        { type: 'setZ', id: 'a', before: 'a0', after: 'a1' },
        { type: 'setZ', id: 'b', before: 'a0', after: 'a1' },
        { type: 'add', item: asOpItem(item('c', 'a0')) },
      ]),
    ).toStrictEqual(['b', 'a', 'c']);
  });

  it('ignores replaceDoc, which affects everything and therefore nothing', () => {
    const doc = docOf(item('a', 'a0'));
    expect(
      affectedIds([{ type: 'replaceDoc', before: doc as unknown as LayoutDoc<never>, after: doc as unknown as LayoutDoc<never> }]),
    ).toStrictEqual([]);
  });

  it('derives the kind from the op majority', () => {
    const move = (id: string): Op => ({ type: 'move', id, before: { x: start(0, 0), y: start(0, 0) }, after: { x: start(1, 1), y: start(1, 1) } });
    expect(deriveLabel([move('a'), move('b'), move('c')])).toStrictEqual({ kind: 'move', ids: ['a', 'b', 'c'] });
    expect(deriveLabel([move('a'), move('b'), { type: 'setZ', id: 'a', before: 'a0', after: 'a1' }]).kind).toBe('move');
    expect(deriveLabel([{ type: 'setZ', id: 'a', before: 'a0', after: 'a1' }]).kind).toBe('reorder');
    expect(deriveLabel([{ type: 'add', item: asOpItem(item('a', 'a0')) }]).kind).toBe('add');
    expect(deriveLabel([{ type: 'remove', item: asOpItem(item('a', 'a0')) }]).kind).toBe('remove');
    expect(deriveLabel([{ type: 'setHidden', id: 'a', before: false, after: true }]).kind).toBe('edit');
    expect(deriveLabel([]).kind).toBe('edit');
  });

  it('breaks a tie by first appearance', () => {
    const resize: Op = { type: 'resize', id: 'a', before: { x: start(0, 0), y: start(0, 0) }, after: { x: start(1, 1), y: start(1, 1) } };
    const move: Op = { type: 'move', id: 'b', before: { x: start(0, 0), y: start(0, 0) }, after: { x: start(1, 1), y: start(1, 1) } };
    expect(deriveLabel([resize, move]).kind).toBe('resize');
    expect(deriveLabel([move, resize]).kind).toBe('move');
  });

  it('carries the responsive size into the label only when there is one', () => {
    const op: Op = { type: 'placeAt', id: 'a', size: 'md', before: undefined, after: { hidden: true } };
    expect(deriveLabel([op], 'md')).toStrictEqual({ kind: 'edit', ids: ['a'], size: 'md' });
    expect('size' in deriveLabel([op])).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Property: apply ∘ invert = identity                                 */
/* ------------------------------------------------------------------ */

/** mulberry32 — seedable, dependency-free, identical across platforms. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

function int(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: Rng, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)]!;
}

const MODES: readonly AxisMode[] = ['start', 'end', 'both', 'center', 'scale'];
const SIZES: readonly string[] = ['lg', 'md', 'sm'];

function randomLen(rng: Rng): Len {
  const roll = rng();
  if (roll < 0.5) return int(rng, -50, 500);
  if (roll < 0.8) return { pct: int(rng, 0, 100) };
  return { pct: int(rng, 0, 100), px: int(rng, -40, 40) };
}

function randomPlacement(rng: Rng): AxisPlacement {
  const mode = pick(rng, MODES);
  if (mode === 'both') return { mode, start: randomLen(rng), end: randomLen(rng) };
  return { mode, offset: randomLen(rng), size: randomLen(rng) };
}

/**
 * A canonical document: items ascending by z, no redundant `false` flags, and
 * `at` maps that are either absent or non-empty — exactly the invariants
 * `normalize()` guarantees and `applyOp` preserves.
 */
function randomDoc(seed: number): Doc {
  const rng = makeRng(seed);
  const count = int(rng, 1, 6);
  const items: Item[] = [];
  for (let i = 0; i < count; i++) {
    const next: Record<string, unknown> = {
      id: `item-${i}`,
      x: randomPlacement(rng),
      y: randomPlacement(rng),
      z: `a${String(i).padStart(2, '0')}`,
    };
    if (rng() < 0.3) next.minW = int(rng, 0, 100);
    if (rng() < 0.3) next.hidden = true;
    if (rng() < 0.2) next.locked = true;
    if (rng() < 0.3) next.order = int(rng, 0, 9);
    if (rng() < 0.3) next.tags = ['widget'];
    if (rng() < 0.4) {
      const at: Record<string, ItemOverride> = {};
      for (const size of SIZES) {
        if (rng() < 0.4) at[size] = rng() < 0.5 ? { x: randomPlacement(rng) } : { hidden: true, order: int(rng, 0, 5) };
      }
      if (Object.keys(at).length > 0) next.at = at;
    }
    if (rng() < 0.5) next.data = { kind: pick(rng, ['chart', 'kpi'] as const), n: int(rng, 0, 99) };
    if (rng() < 0.25) next.$unknown = { futureAnchor: 'diagonal' };
    items.push(next as unknown as Item);
  }
  const doc: Record<string, unknown> = {
    version: 1,
    container: { base: { width: int(rng, 320, 1920), height: 800 }, height: 'fill' },
    items,
  };
  if (rng() < 0.3) doc.$unknown = { futureFlag: true };
  return doc as unknown as Doc;
}

/**
 * Every op type, instantiated against a real item of `doc` so each `before`
 * describes the document exactly as it stands. That is the contract the store
 * records under: ops are built from observed state, never guessed.
 */
function opsFor(doc: Doc, rng: Rng): Op[] {
  const ops: Op[] = [];
  const target = pick(rng, doc.items) as Item;
  const pair = { x: target.x, y: target.y };
  const after = { x: randomPlacement(rng), y: randomPlacement(rng) };

  ops.push({ type: 'move', id: target.id, before: pair, after });
  ops.push({ type: 'resize', id: target.id, before: pair, after });
  ops.push({ type: 'setZ', id: target.id, before: target.z, after: `b${int(rng, 10, 99)}` });
  ops.push({ type: 'add', item: asOpItem(item(`fresh-${int(rng, 0, 999)}`, `a${int(rng, 10, 99)}`)) });
  ops.push({ type: 'remove', item: asOpItem(target) });
  ops.push({ type: 'setOrder', id: target.id, before: target.order, after: rng() < 0.5 ? int(rng, 0, 9) : undefined });
  ops.push({
    type: 'setData',
    id: target.id,
    before: (target as { data?: unknown }).data,
    after: rng() < 0.5 ? { kind: 'table', n: int(rng, 0, 9) } : undefined,
  });

  const size = pick(rng, SIZES);
  ops.push({
    type: 'placeAt',
    id: target.id,
    size,
    before: target.at?.[size],
    after: rng() < 0.5 ? { x: randomPlacement(rng), hidden: true } : undefined,
  });

  // A `false` flag is stored as absence, so toggling one OFF canonicalizes a
  // document that redundantly carried `false`. The generator never produces
  // that shape, so the round trip is exact here — see the dedicated unit test
  // above for the canonicalization rule itself.
  ops.push({ type: 'setHidden', id: target.id, before: target.hidden === true, after: target.hidden !== true });
  ops.push({ type: 'setLocked', id: target.id, before: target.locked === true, after: target.locked !== true });

  ops.push({
    type: 'replaceDoc',
    before: doc as unknown as LayoutDoc<never>,
    after: randomDoc(int(rng, 1, 1e6)) as unknown as LayoutDoc<never>,
  });

  return ops;
}

describe('property: applyOp(applyOp(doc, op), invertOp(op)) === doc', () => {
  it('round-trips every op type over 300 seeded documents', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const doc = randomDoc(seed);
      const original = JSON.parse(JSON.stringify(doc)) as Doc;
      deepFreeze(doc);
      const rng = makeRng(seed * 7919);

      for (const op of opsFor(doc, rng)) {
        const applied = applyOp(doc, op);
        const back = applyOp(applied, invertOp(op));
        expect(back, `seed ${seed}, op ${op.type}`).toStrictEqual(doc);
        // …and the input document was never touched along the way.
        expect(JSON.parse(JSON.stringify(doc))).toStrictEqual(original);
      }
    }
  });

  it('an applied op is rebasable, its inverse is not', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const doc = randomDoc(seed);
      const rng = makeRng(seed * 104729);
      for (const op of opsFor(doc, rng)) {
        if (op.type === 'replaceDoc') continue;
        const applied = applyOp(doc, op);
        if (applied === doc) continue; // a no-op leaves both endpoints true
        expect(rebaseOk(applied, op), `seed ${seed}, op ${op.type}`).toBe(true);
        expect(rebaseOk(doc, invertOp(op)), `seed ${seed}, inverse of ${op.type}`).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* regressions                                                         */
/* ------------------------------------------------------------------ */

describe('opaque `data` is never read as a Len', () => {
  /**
   * `{px: 12}` and `12` are the same LENGTH, but consumer data is not a
   * length — a widget whose data happens to have a `px` key must still be able
   * to change.
   */
  const cases: Array<[unknown, unknown]> = [
    [{ px: 12 }, 12],
    [12, { px: 12 }],
    [{ px: 0 }, {}],
    [{ pct: 5, px: 3 }, { pct: 5 }],
    [{ nested: { px: 4 } }, { nested: 4 }],
  ];

  it('commits a setData between Len-shaped payloads', () => {
    for (const [before, after] of cases) {
      const doc = docOf(item('a', 'a0', { data: before } as Partial<Item>));
      const next = applyOp(doc, { type: 'setData', id: 'a', before, after });
      expect(next).not.toBe(doc);
      expect((next.items[0] as unknown as { data: unknown }).data).toBe(after);
    }
  });

  it('reports the same pair as un-rebasable', () => {
    for (const [before, after] of cases) {
      const doc = docOf(item('a', 'a0', { data: before } as Partial<Item>));
      expect(rebaseOk(doc, { type: 'setData', id: 'a', before, after })).toBe(false);
      expect(rebaseOk(doc, { type: 'setData', id: 'a', before: after, after: before })).toBe(true);
    }
  });

  it('still treats a genuinely equal payload as a no-op', () => {
    const doc = docOf(item('a', 'a0', { data: { px: 12, list: [1, 2] } } as Partial<Item>));
    const same = { px: 12, list: [1, 2] };
    expect(applyOp(doc, { type: 'setData', id: 'a', before: same, after: same })).toBe(doc);
    expect(rebaseOk(doc, { type: 'setData', id: 'a', before: same, after: same })).toBe(true);
  });

  it('keeps Len-awareness for placements, which ARE lengths', () => {
    const doc = docOf(item('a', 'a0', { at: { sm: { x: start({ px: 12 }, 100) } } }));
    // `{px: 12}` and `12` denote the same offset: re-encoding one as the other
    // is a no-op, not an edit.
    const op = {
      type: 'placeAt',
      id: 'a',
      size: 'sm',
      before: { x: start({ px: 12 }, 100) },
      after: { x: start(12, 100) },
    } as Op;
    expect(applyOp(doc, op)).toBe(doc);
    expect(rebaseOk(doc, op)).toBe(true);
  });

  it('does not confuse a Len-shaped `data` with an item field of the same name', () => {
    const doc = docOf(item('a', 'a0', { data: { px: 1 } } as Partial<Item>));
    const other = item('a', 'a0', { data: 1 } as Partial<Item>);
    expect(rebaseOk(doc, { type: 'add', item: asOpItem(other) })).toBe(false);
  });
});
