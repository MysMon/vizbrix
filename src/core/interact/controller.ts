/**
 * The interaction controller — the framework-agnostic half of editing.
 *
 * `createInteractionController(store)` wires the three sensors (pointer,
 * keyboard, tap-to-place) onto one container element and gives them a single
 * injected runtime: the store, the snap engine, the clock, the container
 * geometry and the announcer. There is no React here and no DOM global read at
 * module scope — the adapter supplies the element, the controller supplies the
 * behaviour, and the two meet through `data-*` attributes and
 * `store.setInteraction()`.
 *
 * ## The one measurement rule
 *
 * `getBoundingClientRect()` is called exactly once per gesture, at its start,
 * inside `measure()`. Everything after that is arithmetic on the frozen
 * `GestureSnapshot`. That is what lets a 200-item dashboard drag at frame rate
 * and what keeps the snap engine's zero-measurement claim true (§9).
 *
 * ## Coordinates
 *
 * `Rect.x` is LOGICAL — the distance from the container's start edge, which is
 * its RIGHT edge under `direction: 'rtl'`. Pointer x deltas are therefore
 * negated before they reach any rect math, and the imperative `translate()`
 * writes are negated back on the way out, since a transform is physical. Under
 * `responsive: 'scale'` pointer deltas are divided by the canvas scale, because
 * the document keeps design-space coordinates while the wrapper is scaled
 * (§1.11).
 *
 * ## Transactions
 *
 * One gesture is one undo entry, whatever its arity: a single item goes through
 * `store.moveItem`/`resizeItem`, and a multi-select drag composes the same ops
 * by hand and applies them in ONE `store.apply()` call. A drop at the origin, a
 * cancelled gesture and a never-legal `forbid` landing all commit nothing, so
 * undo never contains an entry that does nothing (§8).
 */

import type {
  ApplyOptions,
  GestureSnapshot,
  InteractionState,
  ItemOverride,
  ItemStringContext,
  LayoutItem,
  LayoutItemBase,
  Op,
  Rect,
  SnapConfig,
  Transaction,
  TxResult,
  TxSource,
  VizbrixStore,
  VizbrixStrings,
} from '../schema/types';
import { foldItem } from '../geometry/cascade';
import { reencodeRect } from '../geometry/reencode';
import { yExtentOf } from '../geometry/resolve';
import { layoutWidthOf } from '../store/server-view';
import type { GestureSnapEngine } from '../snap/engine';
import { createSnapEngine } from '../snap/engine';
import type { AnnounceKind, InteractRuntime, Modifiers, ResolvedOptions } from './machine';
import { collisionValid, createMachine } from './machine';
import { createPointerSensor } from './pointer';
import { createKeyboardSensor } from './keyboard';
import { createPlaceController } from './place';

/* ------------------------------------------------------------------ */
/* public options                                                      */
/* ------------------------------------------------------------------ */

export interface InteractionOptions {
  snap?: SnapConfig | false;
  /** Touch activation delay in ms; `'off'` drops touch to 3 px activation. */
  longPress?: number | 'off';
  strings?: VizbrixStrings;
  /** Human name for an item, used in announcements. Defaults to the id. */
  getLabel?: (item: LayoutItemBase) => string;
  onAnnounce?: (message: string, tone: 'assertive' | 'polite') => void;
}

export interface InteractionController {
  /** Attach pointer + keyboard listeners to the container; returns a detach. */
  attach(container: HTMLElement): () => void;
  /** WCAG 2.5.7 tap-to-place: arm the placement of `id`. */
  beginPlace(id: string): void;
  /** Land the armed item, top-left at `point` (container coordinates). */
  completePlace(point: { x: number; y: number }): void;
  cancelPlace(): void;
  setOptions(opts: Partial<InteractionOptions>): void;
  destroy(): void;
}

/* ------------------------------------------------------------------ */
/* fallback strings                                                    */
/* ------------------------------------------------------------------ */

function labelOf(tx: Transaction): string {
  const kind = tx.label.kind;
  const ids = tx.label.ids;
  const what = ids.length === 1 ? ids[0] : `${ids.length} items`;
  const size = tx.label.size ? ` (${tx.label.size})` : '';
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} ${what}${size}`;
}

/**
 * Minimal English strings so the controller stands alone.
 *
 * The shipped default is `vizbrix/locales/en`, which the React adapter injects
 * via `strings`; this fallback exists so `src/core/interact` carries no
 * dependency on the locale module and a bare `createInteractionController(store)`
 * still announces something sensible.
 */
export const fallbackStrings: VizbrixStrings = {
  itemRole: () => 'layout item',
  instructions: () =>
    'Press Enter or Space to grab the item, arrow keys to move it, Enter to drop, Escape to cancel.',
  grabbed: (c) => `${c.label} grabbed. ${c.x}, ${c.y}. Item ${c.position} of ${c.count}.`,
  moved: (c) => `${c.label}, moved to ${c.x}, ${c.y}.`,
  dropped: (c) => `${c.label} dropped at ${c.x}, ${c.y}.`,
  canceled: (c) => `${c.label} move canceled. Back at ${c.x}, ${c.y}.`,
  resized: (c) => `${c.label}, resized to ${c.w} by ${c.h}.`,
  removed: (c) => `${c.label} removed.`,
  placingStarted: (c) => `Placing ${c.label}. Choose a position in the dashboard.`,
  placed: (c) => `${c.label} placed at ${c.x}, ${c.y}.`,
  reordered: (c) => `${c.label} moved to ${c.direction}. Item ${c.position} of ${c.count}.`,
  undoLabel: labelOf,
  redoLabel: labelOf,
  moveButtonLabel: (c) => `Move ${c.label}`,
};

const ASSERTIVE: ReadonlySet<AnnounceKind> = new Set<AnnounceKind>([
  'grabbed',
  'dropped',
  'canceled',
  'removed',
  'placingStarted',
  'placed',
]);

const IDLE: InteractionState = Object.freeze({ phase: 'idle' as const });
const ZERO_RECT: Rect = Object.freeze({ x: 0, y: 0, w: 0, h: 0 });

/** Cmd on Apple platforms, Ctrl everywhere else (spec §1.10). */
function platformBypassKey(): 'meta' | 'ctrl' {
  const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator;
  const probe = `${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`;
  return /Mac|iPhone|iPad|iPod/i.test(probe) ? 'meta' : 'ctrl';
}

function resolveOptions(raw: InteractionOptions): ResolvedOptions {
  const snap = raw.snap;
  const configured = snap ? snap.bypassKey : undefined;
  return {
    snap,
    longPress: raw.longPress ?? 450,
    strings: raw.strings ?? fallbackStrings,
    getLabel: raw.getLabel ?? ((item: LayoutItemBase) => item.id),
    onAnnounce: raw.onAnnounce,
    bypassKey: configured ?? platformBypassKey(),
  };
}

/* ------------------------------------------------------------------ */
/* controller                                                          */
/* ------------------------------------------------------------------ */

export function createInteractionController<TData = undefined>(
  store: VizbrixStore<TData>,
  opts: InteractionOptions = {},
): InteractionController {
  let raw: InteractionOptions = { ...opts };
  let options = resolveOptions(raw);
  const machine = createMachine();

  let container: HTMLElement | null = null;
  let engine: GestureSnapEngine | null = null;
  /** A snap change landed mid-gesture; the engine is rebuilt once it ends. */
  let engineStale = false;
  let box: Rect = ZERO_RECT;
  let scale = 1;

  /* ---------------- geometry ---------------- */

  function config() {
    return store.getDoc()?.container ?? { base: { width: 0 } };
  }

  function isRtl(): boolean {
    return config().direction === 'rtl';
  }

  function layoutWidth(): number {
    return layoutWidthOf(config(), store.getContainerWidth());
  }

  function layoutHeight(): number | undefined {
    const h = yExtentOf(config(), store.getContainerHeight());
    return h > 0 ? h : undefined;
  }

  function measure(): void {
    if (!container || typeof container.getBoundingClientRect !== 'function') {
      box = ZERO_RECT;
      scale = 1;
      return;
    }
    const rect = container.getBoundingClientRect();
    box = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
    const cfg = config();
    const design = cfg.base?.width ?? 0;
    // Only `responsive:'scale'` has a canvas scale; in reflow mode the measured
    // width IS the layout width, so forcing 1 avoids a sub-pixel drift factor.
    const next = cfg.responsive === 'scale' && design > 0 ? rect.width / design : 1;
    scale = Number.isFinite(next) && next > 0 ? next : 1;
  }

  function toLocal(clientX: number, clientY: number): { x: number; y: number } {
    const x = isRtl() ? box.x + box.w - clientX : clientX - box.x;
    return { x: x / scale, y: (clientY - box.y) / scale };
  }

  function toLocalDelta(dx: number, dy: number): { x: number; y: number } {
    return { x: (isRtl() ? -dx : dx) / scale, y: dy / scale };
  }

  function snapshot(movingIds: readonly string[]): GestureSnapshot {
    const rects = new Map<string, Rect>();
    for (const id of store.getOrder()) {
      const view = store.getItemView(id);
      if (!view || view.item.hidden === true) continue;
      rects.set(id, view.rect);
    }
    return {
      container: box,
      scale,
      rects,
      movingIds: new Set(movingIds),
      width: layoutWidth(),
      height: yExtentOf(config(), store.getContainerHeight()),
    };
  }

  /* ---------------- transient writes ---------------- */

  function writeTransform(id: string, start: Rect, next: Rect, resize: boolean): void {
    const node = store.getNode(id);
    if (!node) return;
    // A transform is PHYSICAL; logical x runs the other way under RTL.
    const dx = (next.x - start.x) * (isRtl() ? -1 : 1);
    const dy = next.y - start.y;
    node.style.transform = `translate(${dx}px, ${dy}px)`;
    if (resize) {
      node.style.width = `${next.w}px`;
      node.style.height = `${next.h}px`;
    }
  }

  function clearTransform(id: string): void {
    const node = store.getNode(id);
    if (!node) return;
    node.style.transform = '';
    node.style.width = '';
    node.style.height = '';
  }

  /* ---------------- commit ---------------- */

  /**
   * The op that commits one rect, mirroring the store's own targeting: when a
   * named size is active the edit lands in `at[innermost]` rather than the base
   * fields (§1.19). Multi-item gestures need the ops in hand to apply them as
   * one transaction, which is why this is duplicated here rather than looping
   * over `store.moveItem`.
   */
  function placementOp(item: LayoutItem<TData>, rect: Rect, kind: 'move' | 'resize'): Op {
    const cfg = config();
    const activeSizes = store.getActiveSizes();
    const folded = foldItem(item, activeSizes);
    const pair = reencodeRect(
      rect,
      cfg,
      layoutWidthOf(cfg, store.getContainerWidth()),
      store.getContainerHeight(),
      folded.x?.mode ?? 'start',
      folded.y?.mode ?? 'start',
    );
    const size = activeSizes.length > 0 ? activeSizes[activeSizes.length - 1] : undefined;
    if (size === undefined) {
      return { type: kind, id: item.id, before: { x: item.x, y: item.y }, after: pair };
    }
    const before = item.at?.[size];
    const after: ItemOverride = { ...(before ?? {}), x: pair.x, y: pair.y };
    return { type: 'placeAt', id: item.id, size, before, after };
  }

  /**
   * §1.12 at the ONE chokepoint every sensor commits through.
   *
   * The pointer sensor validates per frame so the ghost can show the refusal
   * live, but the keyboard nudge, the grab drop and tap-to-place all land a rect
   * straight from arithmetic — and neither `commitRects` nor the store used to
   * look at `collision`, so `forbid` was a mouse-only guarantee. Checking here
   * makes it a document guarantee and leaves `resolve()` collision-free.
   *
   * Nothing is paid when no item declares `forbid`, which is the common case.
   */
  function forbidden(proposed: ReadonlyMap<string, Rect>): boolean {
    const items = new Map<string, LayoutItemBase>();
    let anyForbid = false;
    for (const item of store.getDoc()?.items ?? []) {
      items.set(item.id, item);
      if (item.collision === 'forbid') anyForbid = true;
    }
    if (!anyForbid) return false;

    const staticRects = new Map<string, Rect>();
    for (const id of store.getOrder()) {
      if (proposed.has(id)) continue;
      const view = store.getItemView(id);
      if (view && view.item.hidden !== true) staticRects.set(id, view.rect);
    }
    return !collisionValid(proposed, items, staticRects);
  }

  function commitRects(
    rects: ReadonlyMap<string, Rect>,
    kind: 'move' | 'resize',
    source: TxSource,
  ): TxResult {
    const entries: Array<[LayoutItem<TData>, Rect]> = [];
    for (const [id, rect] of rects) {
      const item = store.getItem(id);
      if (!item || item.locked === true) continue;
      entries.push([item, rect]);
    }
    if (entries.length === 0) return { status: 'empty', skipped: [] };

    const proposed = new Map<string, Rect>();
    for (const [item, rect] of entries) proposed.set(item.id, rect);
    if (forbidden(proposed)) return { status: 'blocked', skipped: [] };

    const applyOpts: ApplyOptions = { source };
    if (entries.length === 1) {
      const [item, rect] = entries[0]!;
      return kind === 'resize'
        ? store.resizeItem(item.id, rect, applyOpts)
        : store.moveItem(item.id, rect, applyOpts);
    }

    // Multi-select: ONE transaction with n ops, so undo takes the whole gesture
    // back in a single step (§8).
    const ops = entries.map(([item, rect]) => placementOp(item, rect, kind));
    const ids = entries.map(([item]) => item.id);
    const activeSizes = store.getActiveSizes();
    const label: Transaction['label'] = { kind, ids };
    if (activeSizes.length > 0) label.size = activeSizes[activeSizes.length - 1];
    return store.apply(ops, { ...applyOpts, label });
  }

  /* ---------------- announcements ---------------- */

  function announce(
    kind: AnnounceKind,
    id: string,
    rect?: Rect,
    direction?: 'front' | 'back',
    tone?: 'assertive' | 'polite',
  ): void {
    const onAnnounce = options.onAnnounce;
    if (!onAnnounce) return;
    const item = store.getItem(id);
    if (!item) return;
    const view = store.getItemView(id);
    const r = rect ?? view?.rect ?? ZERO_RECT;
    const order = store.getOrder();
    const ctx: ItemStringContext = {
      label: options.getLabel(item),
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.w),
      h: Math.round(r.h),
      position: order.indexOf(id) + 1,
      count: order.length,
    };
    const s = options.strings;
    const message =
      kind === 'reordered'
        ? s.reordered({ ...ctx, direction: direction ?? 'front' })
        : s[kind](ctx);
    onAnnounce(message, tone ?? (ASSERTIVE.has(kind) ? 'assertive' : 'polite'));
  }

  /* ---------------- clock ---------------- */

  function view(): (Window & typeof globalThis) | null {
    const g = globalThis as { requestAnimationFrame?: unknown };
    if (typeof g.requestAnimationFrame === 'function') {
      return globalThis as Window & typeof globalThis;
    }
    return (container?.ownerDocument?.defaultView as (Window & typeof globalThis) | null) ?? null;
  }

  /* ---------------- runtime ---------------- */

  const runtime: InteractRuntime<TData> = {
    store,
    machine,
    options: () => options,
    container: () => container,
    ownerDocument: () => container?.ownerDocument ?? null,
    isEdit: () => store.getMode() === 'edit',
    engine() {
      // A deferred snap change is applied here, at the first call with no live
      // session — the next gesture's start — so the session that was in flight
      // when it landed kept its candidate arrays to the end.
      if (engineStale && machine.session() === null) {
        engineStale = false;
        engine = null;
      }
      if (!engine) engine = createSnapEngine(options.snap);
      return engine;
    },
    measure,
    toLocal,
    toLocalDelta,
    snapshot,
    layoutWidth,
    layoutHeight,
    isRtl,
    bypass(mods: Modifiers) {
      const key = options.bypassKey;
      return key === 'none' ? false : mods[key] === true;
    },
    setInteraction: (state) => store.setInteraction(state),
    idle: () => store.setInteraction(IDLE),
    writeTransform,
    clearTransform,
    commitRects,
    announce,
    raf(cb) {
      const v = view();
      if (v?.requestAnimationFrame) return v.requestAnimationFrame(() => cb());
      cb();
      return 0;
    },
    cancelRaf(handle) {
      if (handle === 0) return;
      view()?.cancelAnimationFrame?.(handle);
    },
    setTimer(cb, ms) {
      const v = view();
      if (v?.setTimeout) return v.setTimeout(cb, ms) as unknown as number;
      return 0;
    },
    clearTimer(handle) {
      if (handle === 0) return;
      view()?.clearTimeout?.(handle);
    },
  };

  /* ---------------- sensors ---------------- */

  const place = createPlaceController(runtime);
  const keyboard = createKeyboardSensor(runtime, {
    cancelPlace: (silent) => place.cancel(silent),
  });
  const pointer = createPointerSensor(runtime, {
    completePlace: (point) => place.complete(point),
    cancelGrab: () => keyboard.cancelGrab(),
  });

  const detachers = new Set<() => void>();

  return {
    attach(el) {
      container = el;
      const detachPointer = pointer.attach(el);
      const detachKeyboard = keyboard.attach(el);
      const detach = () => {
        if (!detachers.delete(detach)) return;
        detachPointer();
        detachKeyboard();
        // The sensors that could end a placement are gone: leaving it armed
        // strands the transient channel on `placing` and would let a later
        // re-attach land the item on the first press it sees.
        place.cancel();
        if (container === el) container = null;
      };
      detachers.add(detach);
      return detach;
    },
    beginPlace: (id) => place.begin(id),
    completePlace: (point) => place.complete(point),
    cancelPlace: () => place.cancel(),
    setOptions(next) {
      raw = { ...raw, ...next };
      options = resolveOptions(raw);
      // A snap config change takes effect on the NEXT gesture: swapping the
      // engine mid-drag would drop the candidate arrays it collected, so a
      // change landing while a gesture is in flight is deferred — `engine()`
      // rebuilds once the gesture is over — rather than dropped.
      if (Object.prototype.hasOwnProperty.call(next, 'snap')) {
        if (machine.busy()) {
          engineStale = true;
        } else {
          engineStale = false;
          engine = null;
        }
      }
    },
    destroy() {
      pointer.cancel();
      keyboard.cancelGrab();
      place.cancel();
      for (const detach of Array.from(detachers)) detach();
      detachers.clear();
      engine?.end();
      engine = null;
      engineStale = false;
      container = null;
    },
  };
}
