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
  FlatItemInput,
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
import { degradesOnY, resolveItem } from '../geometry/resolve';
import { isValidKey, keyBetween } from '../order/fractional';
import { defineItem, ensureCanonicalZ } from '../schema/normalize';
import { createZRanker } from '../order/zrank';
import { createHistory } from '../ops/history';
import { affectedIds, applyOp, deriveLabel, invertOp, itemEquals, rebaseOk } from '../ops/ops';
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
 * Do two documents hold structurally identical item lists?
 *
 * Only called for item-level batches, so the container cannot have changed
 * and items align index-by-index; untouched items are the SAME object, so
 * the structural comparison only ever runs over the handful a batch touched.
 */
function netZeroBatch<T>(before: LayoutDoc<T>, next: LayoutDoc<T>): boolean {
  const a = before?.items ?? [];
  const b = next?.items ?? [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (a[i]?.id !== b[i]?.id || !itemEquals(a[i], b[i])) return false;
  }
  return true;
}

/**
 * The store surface plus the internals the React adapter needs.
 *
 * `VizbrixStore` is the frozen public contract (schema/types.ts) and does not
 * grow for adapter plumbing, so the extra accessor is declared here and simply
 * carried on the returned object — a consumer that only knows `VizbrixStore`
 * is unaffected.
 */
export interface VizbrixStoreInternal<TData = undefined> extends VizbrixStore<TData> {
  /**
   * The exact object most recently handed to a `replaceDoc` op, or `undefined`
   * before the first one.
   *
   * The store may install a REPAIRED copy of that document (z canonicalization),
   * so `getDoc() === thatObject` is not a usable "have I already applied this?"
   * test. Controlled React mode needs one: without it, a prop the store had to
   * repair looks like a fresh assertion on every render and is replayed forever.
   */
  getLastReplaceSource(): LayoutDoc<TData> | undefined;
}

/**
 * Read {@link VizbrixStoreInternal.getLastReplaceSource} off any store-shaped
 * object, including a wrapper that only declares the public `VizbrixStore`.
 *
 * The React adapter wraps the store in a spread copy to instrument
 * transactions, which carries the accessor at runtime but narrows the type.
 * This is the supported way to ask the question from there.
 */
export function lastReplaceSourceOf(
  store: VizbrixStore<unknown> | null | undefined,
): LayoutDoc<unknown> | undefined {
  const get = (store as { getLastReplaceSource?: () => LayoutDoc<unknown> | undefined } | null)
    ?.getLastReplaceSource;
  return typeof get === 'function' ? get.call(store) : undefined;
}

/**
 * Dev-mode diagnostic for a call the store deliberately refused. Silent in
 * production builds and in any environment without a `console`.
 */
function devWarn(message: string): void {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (proc?.env?.NODE_ENV === 'production') return;
  if (typeof console === 'undefined' || typeof console.warn !== 'function') return;
  console.warn(`vizbrix: ${message}`);
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
): VizbrixStoreInternal<TData> {
  /* ---------------- canonical state ---------------- */

  /**
   * Defense against documents that skipped normalize(): a non-canonical z key
   * ("b0", "c0", …) would make keyBetween() throw from inside a later reorder
   * gesture. Order-preserving, no-op (same reference) on clean docs.
   *
   * Applied at BOTH doors a document enters through — construction and
   * `replaceDoc` — because the controlled React path replays the raw prop
   * through `replaceDoc` on mount, which would otherwise undo the repair.
   */
  function adoptDoc(input: LayoutDoc<TData>): LayoutDoc<TData> {
    const canonical = ensureCanonicalZ((input?.items ?? []) as ReadonlyArray<{ id: string; z: string }>);
    if (!canonical.changed) return input;
    return { ...input, items: canonical.items as unknown as LayoutItem<TData>[] };
  }

  doc = adoptDoc(doc);

  let current: LayoutDoc<TData> = doc;
  let lastReplaceSource: LayoutDoc<TData> | undefined;
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
  /**
   * Per-item fingerprint of the FOLDED `hidden`/`order` pair.
   *
   * Neither is visible in the snapshot's (item, rect, zIndex, selected) tuple —
   * folding happens below it — so a breakpoint crossing whose override changes
   * only visibility or stack order would otherwise reuse the snapshot object,
   * fire no listener, and leave the rendered tree disagreeing with the emitted
   * `display:none`.
   */
  const foldedFlags = new Map<string, string>();
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
      const flags = foldedFlagsOf(item);
      const prev = snapshots.get(id);
      if (
        prev &&
        prev.item === item &&
        prev.zIndex === zIndex &&
        prev.selected === selected &&
        sameRect(prev.rect, rect) &&
        foldedFlags.get(id) === flags
      ) {
        continue;
      }
      const version = (versions.get(id) ?? 0) + 1;
      versions.set(id, version);
      snapshots.set(id, { item, rect, zIndex, selected, version });
      foldedFlags.set(id, flags);
      changed.push(id);
    }

    for (const id of Array.from(snapshots.keys())) {
      if (nextById.has(id)) continue;
      snapshots.delete(id);
      versions.delete(id);
      foldedFlags.delete(id);
      changed.push(id);
    }

    byId = nextById;
    if (orderChanged) orderIds = Object.freeze(nextOrder);
    reportKeyGrowth(sorted);
    return { changed, orderChanged };
  }

  /** Fingerprint of the folded visibility/stack-order pair at the active sizes. */
  function foldedFlagsOf(item: LayoutItem<TData>): string {
    const folded = foldItem(item, activeSizes);
    const order = typeof folded.order === 'number' ? folded.order : '';
    return `${folded.hidden === true ? '1' : '0'}|${order}`;
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
      } catch (error) {
        // The result only says WHICH ops were skipped; the reason would
        // otherwise vanish, leaving "my apply() did nothing" undebuggable.
        devWarn(
          `apply: ${String((op as { type?: unknown })?.type ?? 'op')} skipped — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        skipped.push(op);
      }
    }
    if (applied.length === 0) return empty(skipped);

    // A multi-op batch can net out to no change while rebuilding every touched
    // item object (a hide/show pair, an api-driven do-undo sequence). Caught
    // structurally BEFORE anything is installed: no snapshot churn, no
    // listener fire, and — the invariant that matters — no do-nothing undo
    // entry (§8). Single-op no-ops never get here (`applyOp` returns the same
    // document reference, so the post-reconcile guard below catches them).
    if (applied.length > 1 && next !== before && itemLevelOnly(applied) && netZeroBatch(before, next)) {
      return empty(skipped);
    }

    // A document replacement is the load/import boundary — the incoming
    // document has not been through createStore, so it gets the same z-key
    // repair here. The SOURCE object is remembered as handed in, because the
    // installed document may be a repaired copy of it.
    const replaced = applied.some((op) => op.type === 'replaceDoc');
    if (replaced) {
      for (let i = applied.length - 1; i >= 0; i--) {
        const op = applied[i]!;
        if (op.type === 'replaceDoc') {
          lastReplaceSource = op.after as unknown as LayoutDoc<TData>;
          break;
        }
      }
      next = adoptDoc(next);
    }

    current = next;
    const { changed, orderChanged } = reconcile();

    // A drag dropped at its origin, a resize to the same size: nothing moved,
    // so nothing is recorded. Undo must never contain a no-op entry.
    if (changed.length === 0 && !orderChanged && itemLevelOnly(applied)) {
      current = before;
      return empty(skipped);
    }

    // Removed items must not stay selected: a dead id leaking out of
    // getSelection() breaks every consumer that maps it back to an item, and a
    // recycled id would be born selected. Pruned after the rollback guard so a
    // restored document can never be left with a pruned selection.
    const selectionChanged = pruneSelection(applied, changed);

    const tx: Transaction = {
      label: options.label ?? deriveLabel(applied, placeAtSize(applied)),
      ops: applied,
      source: options.source ?? 'api',
    };
    const actor = options.actor ?? opts.actor;
    if (actor !== undefined) tx.actor = actor;

    // A document replacement is the load/import boundary: every recorded
    // inverse describes a document that no longer exists, so history is wiped
    // and the replacement itself is not undoable. Controlled-mode
    // reconciliation opts out with `preserveHistory` — a parent adopting or
    // transforming a commit is a continuation of the same session, and
    // entries that no longer rebase skip per `onConflict` at replay time.
    if (replaced) {
      if (!options.preserveHistory) history.clear();
    }
    // History is frozen in view mode (§1.16): the doc can still be driven
    // programmatically, but a read-only surface accumulates no undo entries.
    else if (!options.transient && mode === 'edit') history.push(tx);

    notify(changed, {
      order: orderChanged || touchesOrder(applied),
      selection: selectionChanged,
      doc: true,
    });
    return { status: 'applied', skipped, tx };
  }

  /**
   * Drop selected ids that the just-applied ops removed, and report whether the
   * selection channel must fire.
   *
   * An id that a single batch removed and re-added is dropped too: it is a
   * DIFFERENT item that happens to reuse the name, and inheriting the old
   * item's selection is never what the caller meant. That case is also the only
   * one where the freshly built snapshots can disagree with the pruned
   * selection, so it re-reconciles and merges the extra changed ids.
   */
  function pruneSelection(applied: readonly Op[], changed: string[]): boolean {
    if (selection.length === 0) return false;
    const removed = new Set<string>();
    for (const op of applied) {
      if (op.type === 'remove' && typeof op.item?.id === 'string') removed.add(op.item.id);
    }
    const kept = selection.filter((id) => byId.has(id) && !removed.has(id));
    if (kept.length === selection.length) return false;

    const recycled = selection.some((id) => removed.has(id) && byId.has(id));
    selection = Object.freeze(kept);
    selectionSet = new Set(kept);
    if (recycled) {
      // The snapshot built moments ago still carries `selected: true` for the
      // re-added item; rebuild it so the store and its views agree.
      const again = reconcile();
      for (const id of again.changed) if (!changed.includes(id)) changed.push(id);
    }
    return true;
  }

  /**
   * Build the op that commits a placement pair for an item.
   *
   * When a named size is active the commit targets `at[innermost]` rather than
   * the base fields (§1.19) — editing at a breakpoint is editing that
   * breakpoint — and the size rides along in the undo label.
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
    const extent = layoutWidthOf(config, width);
    const xMode: AxisMode = folded.x?.mode ?? 'start';
    const yMode: AxisMode = folded.y?.mode ?? 'start';
    const pair = reencodeRect(rect, config, extent, height, xMode, yMode);
    // Dropped where it was picked up: nothing changed, so nothing is committed
    // and no undo entry is created (§8).
    //
    // The stored placement is not enough to decide that. Re-encoding is LOSSY
    // by design — under `height:'auto'` every y mode but `start` degrades
    // (§1.6), and `scale` becomes percentages — so the re-encoded pair for an
    // unmoved item routinely differs from what the document holds while
    // describing the very same rect. Comparing against the re-encoded form of
    // the item's CURRENT placement asks the only question that matters: did the
    // geometry move? A drop at the origin therefore records nothing and leaves
    // the authored anchor mode and units intact.
    if (samePlacement(pair.x, folded.x) && samePlacement(pair.y, folded.y)) return empty();
    // Deliberately resolved, not the snapshot rect: under tier-3 the snapshot
    // describes the flex column, and re-encoding that would relocate the item.
    const currentRect = resolveItem(item, resolveConfigOf(config), extent, height);
    const currentPair = reencodeRect(currentRect, config, extent, height, xMode, yMode);
    if (samePlacement(pair.x, currentPair.x) && samePlacement(pair.y, currentPair.y)) {
      return empty();
    }
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

  /** True when a neighbour key can be handed to the generator as a bound. */
  function usableBound(z: string | null): boolean {
    return z === null || isValidKey(z);
  }

  /**
   * Re-key every item whose `z` the generator would reject, as a store-originated
   * transaction.
   *
   * `setZ`/`add` let a caller write any string, so an invalid key can still
   * reach the document after construction. Repairing it here — from a
   * CANONICALIZED document, rather than fabricating one key on the spot — keeps
   * the resulting order the one the document expressed; fabricating a bound
   * would silently send `sendToBack` to the wrong end ('Zz' > '1' in ASCII).
   * The repair is `transient`, so it never lands in the user's undo stack.
   */
  function repairKeys(): void {
    const items = current?.items ?? [];
    const canonical = ensureCanonicalZ(items as ReadonlyArray<{ id: string; z: string }>);
    if (!canonical.changed) return;
    const ops: Op[] = [];
    const ids: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const before = items[i]!;
      const after = canonical.items[i]!;
      if (before.z !== after.z) {
        ops.push({ type: 'setZ', id: before.id, before: before.z, after: after.z });
        ids.push(before.id);
      }
    }
    if (ops.length === 0) return;
    apply(ops, { transient: true, label: { kind: 'reorder', ids } });
  }

  function reorder(id: string, side: 'front' | 'back'): TxResult {
    if (destroyed) return empty();
    if (!byId.has(id)) return empty();
    const atEdge = (): boolean =>
      side === 'front' ? orderIds[orderIds.length - 1] === id : orderIds[0] === id;
    if (orderIds.length < 2) return empty();
    if (atEdge()) return empty();

    let bound = edgeKey(id, side);
    if (!usableBound(bound)) {
      repairKeys();
      if (!byId.has(id) || orderIds.length < 2 || atEdge()) return empty();
      bound = edgeKey(id, side);
      // Still unusable: refuse rather than throw out of an onClick, and refuse
      // rather than guess — a fabricated bound would move the item to the
      // wrong end.
      if (!usableBound(bound)) return empty();
    }
    const item = byId.get(id)!;
    let z: string;
    try {
      z = side === 'front' ? keyBetween(bound, null) : keyBetween(null, bound);
    } catch {
      // A valid document can hold the absolute-minimum key, below which no
      // key exists. Same policy as an unusable bound: refuse, don't throw
      // out of a UI gesture.
      return empty();
    }
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
    // A fully-conflicted entry ('empty': every op skipped) is consumed without
    // touching the document — but the STACKS changed, and canUndo/labels are
    // read through the doc channel. Silence here would leave an enabled Undo
    // button pointing at an entry that no longer exists.
    else notify([], { doc: true });
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
    else notify([], { doc: true });
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

  const store: VizbrixStoreInternal<TData> = {
    getDoc: () => current,
    getLastReplaceSource: () => lastReplaceSource,
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
      let next: LayoutItem<TData> = item as LayoutItem<TData>;
      // Flat authoring sugar ({ id, x:number, y, w, h, anchor? }) — the same
      // shape defineLayout accepts — converted against the live container so
      // callers never hand-build an AxisPlacement pair.
      if (typeof (next as { x?: unknown })?.x === 'number') {
        next = defineItem(next as unknown as FlatItemInput<TData>, configOf());
      }
      if (typeof next?.z !== 'string' || next.z.length === 0) {
        const topOf = (): string | null => {
          const topId = orderIds[orderIds.length - 1];
          return topId ? (byId.get(topId)?.z ?? null) : null;
        };
        let topZ = topOf();
        if (!usableBound(topZ)) {
          // Same defense as `reorder`: repair the document's keys first rather
          // than feeding an unusable bound to the generator.
          repairKeys();
          topZ = topOf();
          if (!usableBound(topZ)) topZ = null;
        }
        next = { ...next, z: keyBetween(topZ, null) } as LayoutItem<TData>;
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
     *
     * A vertical anchor other than `start` is refused under `height:'auto'`
     * (§1.6): the container has no definite height, so the mode cannot be
     * honored, and re-encoding would degrade it straight back to `start` —
     * storing a lie. The call reports `empty` (nothing changed) and says why in
     * development, instead of failing silently.
     */
    setAnchor(id: string, axis: Axis, anchorMode: AxisMode): TxResult {
      if (destroyed) return empty();
      const item = byId.get(id);
      if (!item) return empty();
      if (item.locked === true) return blocked();
      const config = configOf();
      if (axis === 'y' && degradesOnY(config, anchorMode)) {
        devWarn(
          `setAnchor(${JSON.stringify(id)}, 'y', ${JSON.stringify(anchorMode)}) was ignored: a ` +
            `vertical anchor other than 'start' needs container.height:'fill' with a base ` +
            `height (spec §1.6). The document is unchanged.`,
        );
        return empty();
      }
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

    // Field setters. Each captures the live value as the op's `before`, so
    // the recorded transaction inverts correctly; a hand-built op with a
    // stale `before` would fail rebase on undo and skip.
    setHidden(id, hidden, options) {
      if (destroyed) return empty();
      const item = byId.get(id);
      if (!item) return empty();
      return apply([{ type: 'setHidden', id, before: item.hidden === true, after: hidden === true }], {
        ...options,
        label: options?.label ?? { kind: 'edit', ids: [id] },
      });
    },

    setLocked(id, locked, options) {
      if (destroyed) return empty();
      const item = byId.get(id);
      if (!item) return empty();
      return apply([{ type: 'setLocked', id, before: item.locked === true, after: locked === true }], {
        ...options,
        label: options?.label ?? { kind: 'edit', ids: [id] },
      });
    },

    setOrder(id, order, options) {
      if (destroyed) return empty();
      const item = byId.get(id);
      if (!item) return empty();
      return apply([{ type: 'setOrder', id, before: item.order, after: order }], {
        ...options,
        label: options?.label ?? { kind: 'edit', ids: [id] },
      });
    },

    setData(id, data, options) {
      if (destroyed) return empty();
      const item = byId.get(id);
      if (!item) return empty();
      return apply(
        [{ type: 'setData', id, before: (item as { data?: unknown }).data, after: data }],
        { ...options, label: options?.label ?? { kind: 'edit', ids: [id] } },
      );
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
