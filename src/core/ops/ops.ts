/**
 * The op algebra — the only way a document ever changes.
 *
 * Three properties make this file load-bearing for the rest of the engine:
 *
 * - **Purity + structural sharing.** `applyOp` never mutates its input and
 *   returns a document that shares every untouched item object by reference.
 *   The store's per-item memoization is literally `prev.item === item`, so an
 *   op that copies the whole item list defeats the "0 sibling renders" claim.
 *   A semantic no-op returns the SAME document reference.
 * - **Mechanical inversion.** Every op carries `before`/`after`, so
 *   `invertOp` is a swap and never needs to consult the document. That is what
 *   lets history be recorded once and replayed in either direction.
 * - **Rebase before invert.** `rebaseOk` answers "is the document still in the
 *   state this op produced?" — the precondition for undoing it. When it is
 *   false the op is skipped (default policy) instead of silently clobbering a
 *   newer edit.
 *
 * Absence is the canonical encoding of a default. `placeAt` with
 * `after: undefined` DELETES the size key (and the whole `at` map once empty);
 * `setHidden`/`setLocked` with `after: false` delete the flag; `setOrder`/
 * `setData` with `after: undefined` delete the field. `null` is never written
 * into a document.
 */

import type {
  AxisPlacement,
  ItemOverride,
  LayoutDoc,
  LayoutItem,
  LayoutItemBase,
  Len,
  Op,
  Transaction,
} from '../schema/types';
import { canonLen } from '../geometry/len';

/* ------------------------------------------------------------------ */
/* Equality                                                            */
/* ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A number, or an object whose own keys are a subset of `{pct, px}`. */
function isLenLike(value: unknown): value is Len {
  if (typeof value === 'number') return true;
  if (!isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (key !== 'pct' && key !== 'px') return false;
  }
  return true;
}

function sameLen(a: Len, b: Len): boolean {
  const ca = canonLen(a);
  const cb = canonLen(b);
  if (typeof ca === 'number' || typeof cb === 'number') return ca === cb;
  return (ca.pct ?? 0) === (cb.pct ?? 0) && (ca.px ?? 0) === (cb.px ?? 0);
}

/**
 * Structural equality, `Len`-aware: `{px: 12}` and `12` denote the same
 * length, so an op that re-encodes one as the other is a no-op, not a change.
 *
 * Len-awareness is SCHEMA knowledge and stops at the schema's edge. Consumer
 * `data` is opaque — `{px: 12}` there is just an object, and treating it as
 * interchangeable with the number `12` would swallow a real `setData` as a
 * no-op. So `lenAware` is switched off for everything under a `data` key (and
 * for the `setData`/`rebaseOk` entry points), while placements, overrides and
 * the rest of an item keep it.
 *
 * Unbounded in depth — a consumer's `data` payload legitimately nests as deep
 * as it likes (chart specs routinely exceed a dozen levels), and a false
 * inequality here is NOT harmless at every entry point: the `replaceDoc` arm
 * backs controlled-mode echo detection, where "not equal" replaces the
 * document and clears undo history. Cycles (only reachable through consumer
 * `data`) are detected via the ancestor stacks and compare as NOT equal, and
 * a key whose value is `undefined` counts as absent, matching the JSON
 * round-trip every persisted document goes through.
 */
function deepEqual(
  a: unknown,
  b: unknown,
  lenAware = true,
  stackA: unknown[] = [],
  stackB: unknown[] = [],
): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) {
    // The one legitimate cross-type equality: a bare px number vs `{px: n}`.
    return lenAware && isLenLike(a) && isLenLike(b) && sameLen(a, b);
  }
  if (typeof a !== 'object' || a === null || b === null) return false;

  const arrA = Array.isArray(a);
  if (arrA !== Array.isArray(b)) return false;
  if (!arrA && (!isPlainObject(a) || !isPlainObject(b))) return false;
  if (!arrA && lenAware && isLenLike(a) && isLenLike(b)) return sameLen(a, b);

  // A node revisiting one of its own ancestors is a cycle: report inequality
  // rather than recursing forever. (A DAG that shares subtrees is fine — the
  // stacks only hold the current ancestor chain.)
  if (stackA.includes(a) || stackB.includes(b)) return false;
  stackA.push(a);
  stackB.push(b);
  try {
    if (arrA) {
      const x = a as unknown[];
      const y = b as unknown[];
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) {
        if (!deepEqual(x[i], y[i], lenAware, stackA, stackB)) return false;
      }
      return true;
    }

    const objA: Record<string, unknown> = a as Record<string, unknown>;
    const objB: Record<string, unknown> = b as Record<string, unknown>;
    let countA = 0;
    for (const key of Object.keys(objA)) {
      if (objA[key] === undefined) continue;
      countA++;
      if (objB[key] === undefined) return false;
      // Below a `data` key the payload is the consumer's, not the schema's.
      if (!deepEqual(objA[key], objB[key], lenAware && key !== 'data', stackA, stackB)) {
        return false;
      }
    }
    let countB = 0;
    for (const key of Object.keys(objB)) {
      if (objB[key] !== undefined) countB++;
    }
    return countA === countB;
  } finally {
    stackA.pop();
    stackB.pop();
  }
}

/** {@link deepEqual} for opaque consumer payloads: no `Len` interpretation. */
function deepEqualData(a: unknown, b: unknown): boolean {
  return deepEqual(a, b, false);
}

/**
 * Structural item equality, `Len`-aware outside `data`.
 *
 * Module-internal to the engine (not part of the public core surface): the
 * store uses it to detect a multi-op batch that nets out to no change.
 */
export function itemEquals(a: unknown, b: unknown): boolean {
  return deepEqual(a, b);
}

/** Placement equality up to `Len` canonicalization. Modes must match exactly. */
function samePlacement(a: AxisPlacement | undefined, b: AxisPlacement | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.mode !== b.mode) return false;
  if (a.mode === 'both') {
    const other = b as Extract<AxisPlacement, { mode: 'both' }>;
    return sameLen(a.start, other.start) && sameLen(a.end, other.end);
  }
  const other = b as Exclude<AxisPlacement, { mode: 'both' }>;
  return sameLen(a.offset, other.offset) && sameLen(a.size, other.size);
}

/* ------------------------------------------------------------------ */
/* Item list plumbing                                                  */
/* ------------------------------------------------------------------ */

/**
 * Ascending fractional-key order, ties broken by id.
 *
 * Deliberately duplicated (rather than imported from the store) so the op
 * layer stays a leaf: ops must not depend on the module that consumes them.
 */
function compareItems(a: LayoutItemBase, b: LayoutItemBase): number {
  const za = typeof a.z === 'string' ? a.z : '';
  const zb = typeof b.z === 'string' ? b.z : '';
  if (za !== zb) return za < zb ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

function itemsOf<T>(doc: LayoutDoc<T>): readonly LayoutItem<T>[] {
  const items = (doc as { items?: unknown } | undefined)?.items;
  return Array.isArray(items) ? (items as LayoutItem<T>[]) : [];
}

function indexOfId<T>(items: readonly LayoutItem<T>[], id: string): number {
  for (let i = 0; i < items.length; i++) if (items[i]!.id === id) return i;
  return -1;
}

function opError(message: string): Error {
  return new Error(`vizbrix: ${message}`);
}

/** New document with a new item list; container and `$unknown` keep identity. */
function withItems<T>(doc: LayoutDoc<T>, items: LayoutItem<T>[]): LayoutDoc<T> {
  return { ...doc, items };
}

/**
 * Copy one item, apply a field-level patch, and splice it back — leaving every
 * OTHER item object referentially identical.
 *
 * The draft is a plain record so a patch can `delete` a key: absence is how a
 * default is stored, and `undefined` must never survive into JSON.
 */
function patchItem<T>(
  item: LayoutItem<T>,
  patch: (draft: Record<string, unknown>) => void,
): LayoutItem<T> {
  const draft: Record<string, unknown> = { ...(item as unknown as Record<string, unknown>) };
  patch(draft);
  return draft as unknown as LayoutItem<T>;
}

function replaceAt<T>(
  items: readonly LayoutItem<T>[],
  index: number,
  next: LayoutItem<T>,
): LayoutItem<T>[] {
  const out = items.slice();
  out[index] = next;
  return out;
}

/** Insert into an ascending-by-z list at the position that keeps it sorted. */
function insertSorted<T>(items: readonly LayoutItem<T>[], item: LayoutItem<T>): LayoutItem<T>[] {
  const out = items.slice();
  let at = out.length;
  for (let i = 0; i < out.length; i++) {
    if (compareItems(item, out[i]!) < 0) {
      at = i;
      break;
    }
  }
  out.splice(at, 0, item);
  return out;
}

/** Normalized flag read: absent and `false` are the same state. */
function flagOf(item: LayoutItemBase, key: 'hidden' | 'locked'): boolean {
  return item[key] === true;
}

function orderOf(item: LayoutItemBase): number | undefined {
  return typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : undefined;
}

function dataOf<T>(item: LayoutItem<T>): unknown {
  return (item as unknown as { data?: unknown }).data;
}

function overrideOf<T>(item: LayoutItem<T>, size: string): ItemOverride | undefined {
  const at = item.at;
  if (!isPlainObject(at)) return undefined;
  return at[size];
}

/* ------------------------------------------------------------------ */
/* apply                                                               */
/* ------------------------------------------------------------------ */

/**
 * Apply one op to a document, purely.
 *
 * @returns a NEW document sharing every untouched item by reference, or the
 * INPUT document itself when the op changes nothing (dropping an item where it
 * was picked up, re-setting a flag to its current value). Callers rely on that
 * reference to detect "nothing happened" without a deep comparison.
 *
 * @throws {Error} when the op cannot be applied at all — its target item does
 * not exist, or `add` would duplicate an id. Callers report these through
 * `TxResult.skipped`; the document is never left half-changed, because nothing
 * has been mutated when the throw happens.
 */
export function applyOp<T>(doc: LayoutDoc<T>, op: Op): LayoutDoc<T> {
  if (!op || typeof op !== 'object' || typeof op.type !== 'string') {
    throw opError('applyOp received a non-op');
  }

  // The load/import boundary: wholesale replacement, no structural sharing to
  // preserve because nothing of the old document survives.
  if (op.type === 'replaceDoc') {
    const next = op.after as unknown as LayoutDoc<T>;
    if (!next || typeof next !== 'object') throw opError('replaceDoc carries no document');
    return next === doc ? doc : next;
  }

  const items = itemsOf(doc);

  if (op.type === 'add') {
    const item = op.item as unknown as LayoutItem<T>;
    if (!item || typeof item.id !== 'string' || item.id === '') {
      throw opError('add carries an item without an id');
    }
    if (indexOfId(items, item.id) >= 0) {
      throw opError(`add: an item with id ${JSON.stringify(item.id)} already exists`);
    }
    return withItems(doc, insertSorted(items, item));
  }

  if (op.type === 'remove') {
    const id = op.item?.id;
    const index = typeof id === 'string' ? indexOfId(items, id) : -1;
    if (index < 0) throw opError(`remove: no item with id ${JSON.stringify(id)}`);
    const next = items.slice();
    next.splice(index, 1);
    return withItems(doc, next);
  }

  const index = indexOfId(items, op.id);
  if (index < 0) throw opError(`${op.type}: no item with id ${JSON.stringify(op.id)}`);
  const item = items[index]!;

  switch (op.type) {
    case 'move':
    case 'resize': {
      const after = op.after;
      if (!after || !after.x || !after.y) throw opError(`${op.type}: incomplete placement pair`);
      if (samePlacement(item.x, after.x) && samePlacement(item.y, after.y)) return doc;
      const next = patchItem(item, (draft) => {
        draft.x = after.x;
        draft.y = after.y;
      });
      return withItems(doc, replaceAt(items, index, next));
    }

    case 'setZ': {
      const z = op.after;
      if (typeof z !== 'string' || z === '') throw opError('setZ: invalid key');
      if (item.z === z) return doc;
      const next = patchItem(item, (draft) => {
        draft.z = z;
      });
      // The list is kept z-sorted, so a key change is a remove + re-insert.
      const rest = items.slice();
      rest.splice(index, 1);
      return withItems(doc, insertSorted(rest, next));
    }

    case 'placeAt': {
      if (typeof op.size !== 'string' || op.size === '') throw opError('placeAt: invalid size name');
      const current = overrideOf(item, op.size);
      if (current === undefined && op.after === undefined) return doc;
      if (current !== undefined && op.after !== undefined && deepEqual(current, op.after)) return doc;

      const at: Record<string, ItemOverride> = { ...(isPlainObject(item.at) ? item.at : {}) };
      // `undefined` DELETES the key. Writing `null` or `undefined` into the map
      // would round-trip through JSON as a corrupt override (spec §1.14).
      if (op.after === undefined) delete at[op.size];
      else at[op.size] = op.after;

      const next = patchItem(item, (draft) => {
        if (Object.keys(at).length === 0) delete draft.at;
        else draft.at = at;
      });
      return withItems(doc, replaceAt(items, index, next));
    }

    case 'setHidden':
    case 'setLocked': {
      const key = op.type === 'setHidden' ? 'hidden' : 'locked';
      const after = op.after === true;
      if (flagOf(item, key) === after) return doc;
      const next = patchItem(item, (draft) => {
        // Absence is the canonical `false`: a document never carries a
        // redundant `hidden: false`.
        if (after) draft[key] = true;
        else delete draft[key];
      });
      return withItems(doc, replaceAt(items, index, next));
    }

    case 'setOrder': {
      const after = typeof op.after === 'number' && Number.isFinite(op.after) ? op.after : undefined;
      if (orderOf(item) === after && (after !== undefined || item.order === undefined)) return doc;
      const next = patchItem(item, (draft) => {
        if (after === undefined) delete draft.order;
        else draft.order = after;
      });
      return withItems(doc, replaceAt(items, index, next));
    }

    case 'setData': {
      const after: unknown = op.after;
      const has = Object.prototype.hasOwnProperty.call(item, 'data');
      if (after === undefined) {
        if (!has) return doc;
      } else if (has && deepEqualData(dataOf(item), after)) {
        return doc;
      }
      const next = patchItem(item, (draft) => {
        if (after === undefined) delete draft.data;
        else draft.data = after;
      });
      return withItems(doc, replaceAt(items, index, next));
    }

    default: {
      const exhaustive: never = op;
      throw opError(`unknown op ${JSON.stringify((exhaustive as { type?: unknown }).type)}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* invert                                                              */
/* ------------------------------------------------------------------ */

/**
 * The inverse of an op — a pure before/after swap, computed without looking at
 * any document.
 *
 * `add` and `remove` are each other's inverse; every other op swaps its two
 * endpoints. `placeAt` inverts to `after: undefined` when the override did not
 * exist beforehand, which DELETES it on undo rather than restoring an empty
 * object (spec §1.14).
 */
export function invertOp(op: Op): Op {
  switch (op.type) {
    case 'add':
      return { type: 'remove', item: op.item };
    case 'remove':
      return { type: 'add', item: op.item };
    case 'move':
      return { type: 'move', id: op.id, before: op.after, after: op.before };
    case 'resize':
      return { type: 'resize', id: op.id, before: op.after, after: op.before };
    case 'setZ':
      return { type: 'setZ', id: op.id, before: op.after, after: op.before };
    case 'placeAt':
      return { type: 'placeAt', id: op.id, size: op.size, before: op.after, after: op.before };
    case 'setHidden':
      return { type: 'setHidden', id: op.id, before: op.after, after: op.before };
    case 'setLocked':
      return { type: 'setLocked', id: op.id, before: op.after, after: op.before };
    case 'setOrder':
      return { type: 'setOrder', id: op.id, before: op.after, after: op.before };
    case 'setData':
      return { type: 'setData', id: op.id, before: op.after, after: op.before };
    case 'replaceDoc':
      return { type: 'replaceDoc', before: op.after, after: op.before };
    default: {
      const exhaustive: never = op;
      throw opError(`cannot invert unknown op ${JSON.stringify((exhaustive as { type?: unknown }).type)}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* rebase                                                              */
/* ------------------------------------------------------------------ */

/**
 * Is the document still in the state this op produced?
 *
 * This is the precondition for undoing an op: the recorded `after` must still
 * be what the document says, otherwise a newer edit (or a collaborator) has
 * moved on and inverting would clobber it. Redo asks the same question about
 * the inverse — `rebaseOk(doc, invertOp(op))` — because inversion swaps the
 * endpoints.
 *
 * State-vs-op reading per op type:
 * - `add`: the item EXISTS and is structurally identical (that is the state
 *   `add` produced).
 * - `remove`: the item is ABSENT.
 * - everything else: the target exists and the field equals `after`.
 *
 * Never throws: a malformed op is simply not rebasable.
 */
export function rebaseOk<T>(doc: LayoutDoc<T>, op: Op): boolean {
  if (!op || typeof op !== 'object' || typeof op.type !== 'string') return false;
  if (op.type === 'replaceDoc') {
    return Object.is(doc, op.after) || deepEqual(doc, op.after);
  }

  const items = itemsOf(doc);

  if (op.type === 'add') {
    const id = op.item?.id;
    if (typeof id !== 'string') return false;
    const index = indexOfId(items, id);
    return index >= 0 && deepEqual(items[index], op.item);
  }
  if (op.type === 'remove') {
    const id = op.item?.id;
    return typeof id === 'string' && indexOfId(items, id) < 0;
  }

  const index = typeof op.id === 'string' ? indexOfId(items, op.id) : -1;
  if (index < 0) return false;
  const item = items[index]!;

  switch (op.type) {
    case 'move':
    case 'resize':
      return (
        !!op.after && samePlacement(item.x, op.after.x) && samePlacement(item.y, op.after.y)
      );
    case 'setZ':
      return item.z === op.after;
    case 'placeAt': {
      const current = overrideOf(item, op.size);
      if (current === undefined || op.after === undefined) {
        return current === undefined && op.after === undefined;
      }
      return deepEqual(current, op.after);
    }
    case 'setHidden':
      return flagOf(item, 'hidden') === (op.after === true);
    case 'setLocked':
      return flagOf(item, 'locked') === (op.after === true);
    case 'setOrder': {
      const after = typeof op.after === 'number' && Number.isFinite(op.after) ? op.after : undefined;
      return orderOf(item) === after;
    }
    case 'setData': {
      const has = Object.prototype.hasOwnProperty.call(item, 'data');
      if (op.after === undefined) return !has || dataOf(item) === undefined;
      return has && deepEqualData(dataOf(item), op.after);
    }
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ */
/* labels                                                             */
/* ------------------------------------------------------------------ */

type LabelKind = Transaction['label']['kind'];

/** Which undo label an op contributes to. */
const OP_KIND: Record<Op['type'], LabelKind> = {
  add: 'add',
  remove: 'remove',
  move: 'move',
  resize: 'resize',
  setZ: 'reorder',
  placeAt: 'edit',
  setHidden: 'edit',
  setLocked: 'edit',
  setOrder: 'edit',
  setData: 'edit',
  replaceDoc: 'edit',
};

/**
 * The ids an op touches, in first-appearance order and deduplicated.
 *
 * Used for two things: the undo label, and restoring selection to where an
 * undo actually happened. `replaceDoc` contributes nothing — it affects the
 * whole document, and selecting every item after it would be noise.
 */
export function affectedIds(ops: readonly Op[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const list: readonly Op[] = Array.isArray(ops) ? ops : [];
  for (const op of list) {
    if (!op || typeof op !== 'object') continue;
    let id: unknown;
    if (op.type === 'add' || op.type === 'remove') id = op.item?.id;
    else if (op.type === 'replaceDoc') continue;
    else id = op.id;
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Derive a transaction label from its ops.
 *
 * The kind is decided by majority — a multi-select drag is a "move" even
 * though it is n ops, and a resize that also nudges z is still a "resize".
 * Ties go to whichever kind appeared first, so the label is deterministic.
 *
 * @param size the active named size a responsive commit targeted; when set it
 * rides along so the label can read "move Revenue chart (md)" (spec §1.19).
 */
export function deriveLabel(ops: readonly Op[], size?: string): Transaction['label'] {
  const list: readonly Op[] = Array.isArray(ops) ? ops : [];
  const counts = new Map<LabelKind, number>();
  const firstSeen = new Map<LabelKind, number>();

  for (let i = 0; i < list.length; i++) {
    const op = list[i];
    if (!op || typeof op !== 'object') continue;
    const kind = OP_KIND[op.type];
    if (kind === undefined) continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    if (!firstSeen.has(kind)) firstSeen.set(kind, i);
  }

  let kind: LabelKind = 'edit';
  let best = 0;
  for (const [candidate, count] of counts) {
    if (count > best || (count === best && (firstSeen.get(candidate) ?? 0) < (firstSeen.get(kind) ?? Infinity))) {
      kind = candidate;
      best = count;
    }
  }

  const label: Transaction['label'] = { kind, ids: affectedIds(list) };
  if (typeof size === 'string' && size !== '') label.size = size;
  return label;
}
