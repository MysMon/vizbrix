/**
 * The store — canonical document state, derived indexes, and the precise
 * notification fabric the React adapter subscribes to.
 *
 * Two properties carry the product claim and are therefore load-bearing here:
 *
 * - **Subscription precision.** Committing a change to item A must never fire
 *   item B's callback. Every commit reconciles the whole derived state but
 *   notifies only the items whose snapshot actually differs — including under
 *   container resize, where an item anchored in pure pixels keeps its rect and
 *   therefore keeps its snapshot.
 * - **Snapshot memoization.** `getItemView(id)` returns the SAME object until
 *   that item's version bumps. `useSyncExternalStore` compares snapshots by
 *   identity; a fresh object per call is an infinite render loop.
 *
 * Framework-agnostic by contract: no React, and no DOM globals at module scope
 * (the node registry is a plain `Map` — attaching observers and listeners is
 * the adapter's job, which is also what keeps construction StrictMode-safe).
 */

import type {
  ApplyOptions,
  Axis,
  AxisMode,
  AxisPlacement,
  ContainerConfig,
  InteractionState,
  ItemOverride,
  ItemSnapshot,
  LayoutDoc,
  LayoutItem,
  LayoutItemBase,
  Len,
  Op,
  PlacementPair,
  Rect,
  StoreOptions,
  Transaction,
  TxResult,
  Unsubscribe,
  VizbrixStore,
} from '../schema/types';
import { foldItem } from '../geometry/cascade';
import { canonLen } from '../geometry/len';
import { reencodeRect } from '../geometry/reencode';
import { resolveItem } from '../geometry/resolve';
import { keyBetween } from '../order/fractional';
import { ensureCanonicalZ } from '../schema/normalize';
import { createZRanker } from '../order/zrank';
import { createHistory } from '../ops/history';
import { affectedIds, applyOp, deriveLabel, invertOp, rebaseOk } from '../ops/ops';
import {
  activeSizesOf,
  buildServerViews,
  compareByZ,
  isStackedAt,
  layoutWidthOf,
  resolveAllRects,
  resolveConfigOf,
} from './server-view';

type Listener = () => void;

/** Fractional-key length at which the app is signalled to consider rebalancing. */
const KEY_GROWTH_THRESHOLD = 40;

const EMPTY_CONFIG: ContainerConfig = { base: { width: 0 } };
const ZERO_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };
const NO_IDS: readonly string[] = Object.freeze([]);

function isNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function finite(n: unknown): number {
  return isNum(n) ? n : 0;
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameLen(a: Len | undefined, b: Len | undefined): boolean {
  const ca = canonLen(a ?? 0);
  const cb = canonLen(b ?? 0);
  if (typeof ca === 'number' || typeof cb === 'number') return ca === cb;
  return ca.pct === cb.pct && ca.px === cb.px;
}

/** Structural placement equality, up to `Len` canonicalization. */
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

/** Snapshot the set before iterating: a callback may subscribe or unsubscribe. */
function emit(listeners: ReadonlySet<Listener> | undefined): void {
  if (!listeners || listeners.size === 0) return;
  for (const cb of Array.from(listeners)) cb();
}

function empty(skipped: Op[] = []): TxResult {
  return { status: 'empty', skipped };
}

function blocked(skipped: Op[] = []): TxResult {
  return { status: 'blocked', skipped };
}

/** Ops that can change the z-sorted id list, i.e. the order channel. */
function touchesOrder(ops: readonly Op[]): boolean {
  for (const op of ops) {
    if (op.type === 'add' || op.type === 'remove' || op.type === 'setZ' || op.type === 'replaceDoc') {
      return true;
    }
  }
  return false;
}

/** Ops that only edit existing items — a no-op run of these commits nothing. */
function itemLevelOnly(ops: readonly Op[]): boolean {
  for (const op of ops) {
    if (op.type === 'add' || op.type === 'remove' || op.type === 'replaceDoc') return false;
  }
  return true;
}

function placeAtSize(ops: readonly Op[]): string | undefined {
  for (const op of ops) if (op.type === 'placeAt') return op.size;
  return undefined;
}

/**
 * Create a store over a layout document.
 *
 * Construction is side-effect free with respect to globals: nothing is
 * measured, no listener or observer is attached, no timer is started. React
 * StrictMode may therefore create (and discard) a store twice with no
 * consequence — `useState(() => createStore(doc))` is the intended call site.
 *
 * @param doc  a normalized document (see `load()` / `defineLayout()`)
 * @param opts mode (default `'view'`), history depth, conflict policy, actor
 */
export function createStore<TData = undefined>(
  doc: LayoutDoc<TData>,
  opts: StoreOptions = {},
): VizbrixStore<TData> {
  /* ---------------- canonical state ---------------- */

  // Defense against hand-authored documents that skipped normalize(): a
  // non-canonical z key ("b0", "c0", …) would make keyBetween() throw from
  // inside a later reorder gesture. Order-preserving, no-op on clean docs.
  const canonical = ensureCanonicalZ(doc?.items ?? []);
  if (canonical.changed) doc = { ...doc, items: canonical.items as LayoutItem<TData>[] };

  let current: LayoutDoc<TData> = doc;
  let mode: 'view' | 'edit' = opts.mode ?? 'view';
  const onConflict = opts.onConflict ?? 'skip';
  const history = createHistory(opts.historyDepth ?? 100);
  const ranker = createZRanker();
  const serverViews = buildServerViews(doc);

  let width = finite(doc?.container?.base?.width);
  let height: number | undefined = isNum(doc?.container?.base?.height)
    ? doc.container.base.height
    : undefined;

  /* ---------------- derived state ---------------- */

  let byId = new Map<string, LayoutItem<TData>>();
  let orderIds: readonly string[] = NO_IDS;
  let zRanks: ReadonlyMap<string, number> = new Map();
  let activeSizes: readonly string[] = NO_IDS;
  let stacked = false;
  let selection: readonly string[] = NO_IDS;
  let selectionSet: ReadonlySet<string> = new Set();
  const snapshots = new Map<string, ItemSnapshot<TData>>();
  const versions = new Map<string, number>();
  let keyGrowthReported = 0;

  /* ---------------- transient state ---------------- */

  let interaction: InteractionState = { phase: 'idle' };
  const nodes = new Map<string, HTMLElement>();
  let destroyed = false;

  /* ---------------- channels ---------------- */

  const itemListeners = new Map<string, Set<Listener>>();
  const orderListeners = new Set<Listener>();
  const selectionListeners = new Set<Listener>();
  const docListeners = new Set<Listener>();
  const interactionListeners = new Set<Listener>();
  const containerListeners = new Set<Listener>();

  function configOf(): ContainerConfig {
    return current?.container ?? EMPTY_CONFIG;
  }

  /**
   * Recompute every derived index from `current`, keeping the memoized snapshot
   * object of every item whose (item, rect, zIndex, selected) tuple is
   * unchanged. Returns the ids whose snapshot was replaced — exactly the item
   * channels that must fire.
   */
  function reconcile(): { changed: string[]; orderChanged: boolean } {
    const config = configOf();
    const items: readonly LayoutItem<TData>[] = current?.items ?? [];

    const nextById = new Map<string, LayoutItem<TData>>();
    for (const item of items) nextById.set(item.id, item);

    const sorted = items.slice().sort(compareByZ);
    const nextOrder = sorted.map((item) => item.id);
    const orderChanged = !sameStrings(orderIds, nextOrder);

    // Sparse ranks: an unchanged neighborhood keeps its ranks, so inserting
    // between two items re-renders exactly one item.
    zRanks = ranker.update(
      sorted.map((item) => ({ id: item.id, z: typeof item.z === 'string' ? item.z : '' })),
    );

    const nextActive = activeSizesOf(config, width);
    if (!sameStrings(activeSizes, nextActive)) activeSizes = Object.freeze(nextActive);
    stacked = isStackedAt(config, width);

    const rects = resolveAllRects(
      sorted,
      config,
      layoutWidthOf(config, width),
      height,
      activeSizes,
      stacked,
    );

    const changed: string[] = [];
    for (const item of sorted) {
      const id = item.id;
      const rect = rects.get(id) ?? ZERO_RECT;
      const zIndex = zRanks.get(id) ?? 0;
      const selected = selectionSet.has(id);
      const prev = snapshots.get(id);
      if (
        prev &&
        prev.item === item &&
        prev.zIndex === zIndex &&
        prev.selected === selected &&
        sameRect(prev.rect, rect)
      ) {
        continue;
      }
      const version = (versions.get(id) ?? 0) + 1;
      versions.set(id, version);
      snapshots.set(id, { item, rect, zIndex, selected, version });
      changed.push(id);
    }

    for (const id of Array.from(snapshots.keys())) {
      if (nextById.has(id)) continue;
      snapshots.delete(id);
      versions.delete(id);
      changed.push(id);
    }

    byId = nextById;
    if (orderChanged) orderIds = Object.freeze(nextOrder);
    reportKeyGrowth(sorted);
    return { changed, orderChanged };
  }

  function reportKeyGrowth(items: readonly LayoutItemBase[]): void {
    const cb = opts.onKeyGrowth;
    if (!cb) return;
    let max = 0;
    for (const item of items) {
      const len = typeof item.z === 'string' ? item.z.length : 0;
      if (len > max) max = len;
    }
    if (max < KEY_GROWTH_THRESHOLD) {
      keyGrowthReported = 0;
      return;
    }
    if (max === keyGrowthReported) return;
    keyGrowthReported = max;
    cb({ maxLength: max });
  }

  function notify(
    changed: readonly string[],
    flags: { order?: boolean; selection?: boolean; container?: boolean; doc?: boolean },
  ): void {
    for (const id of changed) emit(itemListeners.get(id));
    if (flags.order) emit(orderListeners);
    if (flags.selection) emit(selectionListeners);
    if (flags.container) emit(containerListeners);
    if (flags.doc) emit(docListeners);
  }

  /* ---------------- mutation ---------------- */

  /**
   * Reduce ops over the document, reconcile, notify, and record one history
   * entry. Ops that cannot be applied are reported in `skipped` rather than
   * throwing — a malformed op must never take the dashboard down.
   */
  function apply(ops: Op[], options: ApplyOptions = {}): TxResult {
    if (destroyed) return empty();
    if (!Array.isArray(ops) || ops.length === 0) return empty();

    const applied: Op[] = [];
    const skipped: Op[] = [];
    const before = current;
    let next = current;
    for (const op of ops) {
      try {
        next = applyOp(next, op);
        applied.push(op);
      } catch {
        skipped.push(op);
      }
    }
    if (applied.length === 0) return empty(skipped);

    current = next;
    const { changed, orderChanged } = reconcile();

    // A drag dropped at its origin, a resize to the same size: nothing moved,
    // so nothing is recorded. Undo must never contain a no-op entry.
    if (changed.length === 0 && !orderChanged && itemLevelOnly(applied)) {
      current = before;
      return empty(skipped);
    }

    const tx: Transaction = {
      label: options.label ?? deriveLabel(applied, placeAtSize(applied)),
      ops: applied,
      source: options.source ?? 'api',
    };
    const actor = options.actor ?? opts.actor;
    if (actor !== undefined) tx.actor = actor;

    // A document replacement is the load/import boundary: every recorded
    // inverse describes a document that no longer exists, so history is wiped
    // and the replacement itself is not undoable.
    const replaced = applied.some((op) => op.type === 'replaceDoc');
    if (replaced) history.clear();
    // History is frozen in view mode (§1.16): the doc can still be driven
    // programmatically, but a read-only surface accumulates no undo entries.
    else if (!options.transient && mode === 'edit') history.push(tx);

    notify(changed, { order: orderChanged || touchesOrder(applied), doc: true });
    return { status: 'applied', skipped, tx };
  }

  /**
   * Build the op that commits a placement pair for an item.
   *
   * When a named size is active the commit targets `at[innermost]` rather than
   * the base fields (§1.19) — editing at a breakpoint is editing that
   * breakpoint, Webflow-style — and the size rides along in the undo label.
   */
  function placementOp(
    item: LayoutItem<TData>,
    pair: PlacementPair,
    kind: 'move' | 'resize',
  ): { op: Op; size: string | undefined } {
    const size = activeSizes.length > 0 ? activeSizes[activeSizes.length - 1] : undefined;
    if (size === undefined) {
      return {
        op: { type: kind, id: item.id, before: { x: item.x, y: item.y }, after: pair },
        size: undefined,
      };
    }
    const prev = item.at?.[size];
    const after: ItemOverride = { ...(prev ?? {}), x: pair.x, y: pair.y };
    return { op: { type: 'placeAt', id: item.id, size, before: prev, after }, size };
  }

  function labelFor(kind: 'move' | 'resize', id: string, size: string | undefined) {
    const label: Transaction['label'] = { kind, ids: [id] };
    if (size !== undefined) label.size = size;
    return label;
  }

  /** Reencode a target rect under each axis's CURRENT mode and commit it. */
  function commitRect(
    id: string,
    rect: Rect,
    kind: 'move' | 'resize',
    options?: ApplyOptions,
  ): TxResult {
    if (destroyed) return empty();
    const item = byId.get(id);
    if (!item) return empty();
    if (item.locked === true) return blocked();
    const config = configOf();
    const folded = foldItem(item, activeSizes);
    const pair = reencodeRect(
      rect,
      config,
      layoutWidthOf(config, width),
      height,
      folded.x?.mode ?? 'start',
      folded.y?.mode ?? 'start',
    );
    // Dropped where it was picked up: nothing changed, so nothing is committed
    // and no undo entry is created (§8).
    if (samePlacement(pair.x, folded.x) && samePlacement(pair.y, folded.y)) return empty();
    const { op, size } = placementOp(item, pair, kind);
    return apply([op], { ...options, label: options?.label ?? labelFor(kind, id, size) });
  }

  /** z key strictly above/below every other item's key. */
  function edgeKey(id: string, side: 'front' | 'back'): string | null {
    const others = orderIds.filter((other) => other !== id);
    if (others.length === 0) return null;
    const neighbor = side === 'front' ? others[others.length - 1] : others[0];
    const z = byId.get(neighbor)?.z;
    return typeof z === 'string' ? z : null;
  }

  function reorder(id: string, side: 'front' | 'back'): TxResult {
    if (destroyed) return empty();
    const item = byId.get(id);
    if (!item) return empty();
    const others = orderIds.filter((other) => other !== id);
    if (others.length === 0) return empty();
    const already = side === 'front' ? orderIds[orderIds.length - 1] === id : orderIds[0] === id;
    if (already) return empty();
    const bound = edgeKey(id, side);
    const z = side === 'front' ? keyBetween(bound, null) : keyBetween(null, bound);
    return apply([{ type: 'setZ', id, before: item.z, after: z }], {
      label: { kind: 'reorder', ids: [id] },
    });
  }

  /* ---------------- history ---------------- */

  /**
   * Return a transaction to the undo stack without discarding the redo stack.
   *
   * `history.push` clears redo by design (a NEW edit invalidates the redo
   * branch), but replaying an existing entry is not a new edit — so the redo
   * stack is drained, the entry pushed, and the drained entries restored in
   * their original order.
   */
  function pushUndoPreservingRedo(tx: Transaction): void {
    const pending: Transaction[] = [];
    for (;;) {
      const t = history.popRedo();
      if (!t) break;
      pending.push(t);
    }
    history.push(tx);
    for (let i = pending.length - 1; i >= 0; i--) history.pushRedo(pending[i]);
  }

  function canRebase(docAt: LayoutDoc<TData>, op: Op): boolean {
    try {
      return rebaseOk(docAt, op);
    } catch {
      return false;
    }
  }

  /**
   * Replay a recorded transaction in one direction.
   *
   * Undo inverts the ops in REVERSE order and requires the current state to
   * still equal each op's `after`. Redo replays them forward and requires the
   * current state to equal each op's `before` — which is exactly
   * `rebaseOk(doc, invertOp(op))`, since inversion swaps the two.
   */
  function replay(tx: Transaction, direction: 'undo' | 'redo'): TxResult {
    const undoing = direction === 'undo';
    const ops = undoing ? tx.ops.slice().reverse() : tx.ops;
    const skipped: Op[] = [];
    const done: Op[] = [];
    let next = current;

    for (const op of ops) {
      const ok = canRebase(next, undoing ? op : invertOp(op));
      if (!ok && onConflict !== 'force') {
        if (onConflict === 'abort') {
          return { status: 'blocked', skipped: tx.ops.slice(), tx };
        }
        skipped.push(op);
        continue;
      }
      try {
        next = applyOp(next, undoing ? invertOp(op) : op);
        done.push(op);
      } catch {
        skipped.push(op);
      }
    }

    if (done.length === 0) return { status: 'empty', skipped, tx };

    current = next;

    // Undo puts the user back where the change happened.
    const present = new Set((current.items ?? []).map((item) => item.id));
    const restore = affectedIds(tx.ops).filter((id: string) => present.has(id));
    const selectionChanged = !sameStrings(selection, restore);
    if (selectionChanged) {
      selection = Object.freeze(restore);
      selectionSet = new Set(restore);
    }

    const { changed, orderChanged } = reconcile();
    notify(changed, {
      order: orderChanged || touchesOrder(tx.ops),
      selection: selectionChanged,
      doc: true,
    });
    return { status: 'applied', skipped, tx };
  }

  function undo(): TxResult {
    if (destroyed) return empty();
    if (mode !== 'edit') return blocked();
    const tx = history.popUndo();
    if (!tx) return empty();
    const result = replay(tx, 'undo');
    if (result.status === 'applied') history.pushRedo(tx);
    else if (result.status === 'blocked') pushUndoPreservingRedo(tx);
    return result;
  }

  function redo(): TxResult {
    if (destroyed) return empty();
    if (mode !== 'edit') return blocked();
    const tx = history.popRedo();
    if (!tx) return empty();
    const result = replay(tx, 'redo');
    if (result.status === 'applied') pushUndoPreservingRedo(tx);
    else if (result.status === 'blocked') history.pushRedo(tx);
    return result;
  }

  /* ---------------- subscriptions ---------------- */

  function subscribeTo(set: Set<Listener>, cb: Listener): Unsubscribe {
    if (destroyed || typeof cb !== 'function') return () => {};
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  /* ---------------- construction ---------------- */

  reconcile();

  const store: VizbrixStore<TData> = {
    getDoc: () => current,
    getItem: (id) => byId.get(id),
    getItemView: (id) => snapshots.get(id),
    getServerItemView: (id) => serverViews.get(id),
    getOrder: () => orderIds,

    getContainerWidth: () => width,
    getContainerHeight: () => height,

    /**
     * Feed a measured container size in. Recomputes active sizes, stacking and
     * every rect, then bumps ONLY the items whose rect actually changed: an
     * item anchored in pure pixels does not re-render when the container
     * resizes.
     */
    setContainerSize(nextWidth, nextHeight) {
      if (destroyed) return;
      const w = finite(nextWidth);
      const h = isNum(nextHeight) ? nextHeight : undefined;
      if (w === width && h === height) return;
      width = w;
      height = h;
      const { changed, orderChanged } = reconcile();
      notify(changed, { container: true, order: orderChanged });
    },

    getActiveSizes: () => activeSizes,
    isStacked: () => stacked,

    getSelection: () => selection,
    setSelection(ids) {
      if (destroyed) return;
      const next: string[] = [];
      const seen = new Set<string>();
      for (const id of ids ?? []) {
        if (seen.has(id) || !byId.has(id)) continue;
        seen.add(id);
        next.push(id);
      }
      if (sameStrings(selection, next)) return;
      selection = Object.freeze(next);
      selectionSet = seen;
      const { changed } = reconcile();
      notify(changed, { selection: true });
    },

    getInteraction: () => interaction,
    setInteraction(state) {
      if (destroyed || state === interaction) return;
      interaction = state;
      emit(interactionListeners);
    },
    registerNode(id, el) {
      if (el) nodes.set(id, el);
      else nodes.delete(id);
    },
    getNode: (id) => nodes.get(id) ?? null,

    subscribeItem(id, cb) {
      if (destroyed || typeof cb !== 'function') return () => {};
      let set = itemListeners.get(id);
      if (!set) {
        set = new Set();
        itemListeners.set(id, set);
      }
      set.add(cb);
      return () => {
        const s = itemListeners.get(id);
        if (!s) return;
        s.delete(cb);
        if (s.size === 0) itemListeners.delete(id);
      };
    },
    subscribeOrder: (cb) => subscribeTo(orderListeners, cb),
    subscribeSelection: (cb) => subscribeTo(selectionListeners, cb),
    subscribeDoc: (cb) => subscribeTo(docListeners, cb),
    subscribeInteraction: (cb) => subscribeTo(interactionListeners, cb),
    subscribeContainer: (cb) => subscribeTo(containerListeners, cb),

    apply,
    moveItem: (id, rect, options) => commitRect(id, rect, 'move', options),
    resizeItem: (id, rect, options) => commitRect(id, rect, 'resize', options),

    addItem(item, options) {
      if (destroyed) return empty();
      let next: LayoutItem<TData> = item;
      if (typeof next?.z !== 'string' || next.z.length === 0) {
        const topId = orderIds[orderIds.length - 1];
        const topZ = topId ? (byId.get(topId)?.z ?? null) : null;
        next = { ...item, z: keyBetween(topZ, null) } as LayoutItem<TData>;
      }
      return apply([{ type: 'add', item: next as unknown as LayoutItem<never> }], {
        ...options,
        label: options?.label ?? { kind: 'add', ids: [next.id] },
      });
    },

    removeItem(id, options) {
      if (destroyed) return empty();
      const item = byId.get(id);
      if (!item) return empty();
      return apply([{ type: 'remove', item: item as unknown as LayoutItem<never> }], {
        ...options,
        label: options?.label ?? { kind: 'remove', ids: [id] },
      });
    },

    bringToFront: (id) => reorder(id, 'front'),
    sendToBack: (id) => reorder(id, 'back'),

    /**
     * Change one axis's anchor mode without moving the item: resolve at the
     * current extent, then re-encode the very same rect under the new mode.
     */
    setAnchor(id: string, axis: Axis, anchorMode: AxisMode): TxResult {
      if (destroyed) return empty();
      const item = byId.get(id);
      if (!item) return empty();
      if (item.locked === true) return blocked();
      const config = configOf();
      const extent = layoutWidthOf(config, width);
      // Deliberately NOT the snapshot rect: under tier-3 that rect describes
      // the flex column, and re-encoding it would relocate the item.
      const rect = resolveItem(item, resolveConfigOf(config), extent, height);
      const folded = foldItem(item, activeSizes);
      const xMode: AxisMode = axis === 'x' ? anchorMode : (folded.x?.mode ?? 'start');
      const yMode: AxisMode = axis === 'y' ? anchorMode : (folded.y?.mode ?? 'start');
      const pair = reencodeRect(rect, config, extent, height, xMode, yMode);
      if (samePlacement(pair.x, folded.x) && samePlacement(pair.y, folded.y)) return empty();
      const { op, size } = placementOp(item, pair, 'move');
      return apply([op], { label: labelFor('move', id, size) });
    },

    undo,
    redo,
    canUndo: () => mode === 'edit' && history.canUndo(),
    canRedo: () => mode === 'edit' && history.canRedo(),
    peekUndo: () => history.peekUndo(),
    peekRedo: () => history.peekRedo(),

    getMode: () => mode,
    setMode(next) {
      if (destroyed || next === mode) return;
      mode = next;
      emit(docListeners);
    },

    destroy() {
      destroyed = true;
      itemListeners.clear();
      orderListeners.clear();
      selectionListeners.clear();
      docListeners.clear();
      interactionListeners.clear();
      containerListeners.clear();
      nodes.clear();
    },
  };

  return store;
}
