/**
 * The interaction state machine and the pure geometry the sensors drive.
 *
 * Spec §10. Two things live here:
 *
 * 1. **The FSM** — `idle → pressed → (dragging | resizing | marquee) → idle`,
 *    plus the two non-pointer phases (`placing`, `kb-grab`). It is a tiny
 *    mutable record with explicit transitions; the sensors in `pointer.ts`,
 *    `keyboard.ts` and `place.ts` are the only things that drive it. Nothing
 *    here touches the DOM, so the FSM and every rect computation below are
 *    testable without a document.
 * 2. **The rect math** — translation, resize-from-a-handle (with the
 *    from-centre and aspect modifiers), collision evaluation and the keyboard
 *    snap-jump scan. All pure functions of numbers.
 *
 * The transient state the adapter renders NEVER comes from here: it flows into
 * `store.setInteraction(InteractionState)`, which is the single channel the
 * overlay and the announcer read per frame (spec §6, §1.25).
 */

import type {
  GestureSnapshot,
  Guide,
  HandleId,
  InteractionState,
  LayoutItemBase,
  Rect,
  SnapConfig,
  SnapEngine,
  TxResult,
  TxSource,
  VizbrixStore,
  VizbrixStrings,
} from '../schema/types';

/* ------------------------------------------------------------------ */
/* constants                                                           */
/* ------------------------------------------------------------------ */

/** Mouse/pen activation distance, screen px (spec §10). */
export const ACTIVATE_PX = 3;
/** Touch long-press slop: moving this far first is a scroll, not a drag. */
export const TOUCH_SLOP_PX = 8;
/** Touch long-press activation delay in ms (spec §1.18). */
export const LONG_PRESS_MS = 450;
/** Keyboard nudge step; Shift multiplies it. */
export const NUDGE_PX = 1;
export const NUDGE_COARSE_PX = 10;
/** Below this, two floats are the same coordinate. */
const EPS = 0.001;

export const ALL_HANDLES: readonly HandleId[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/* ------------------------------------------------------------------ */
/* rect math                                                           */
/* ------------------------------------------------------------------ */

export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** Touching edges do not count as an intersection (a 0-area overlap is not one). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function translated(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
}

export function unionOf(rects: Iterable<Rect>): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let seen = false;
  for (const r of rects) {
    seen = true;
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.w > maxX) maxX = r.x + r.w;
    if (r.y + r.h > maxY) maxY = r.y + r.h;
  }
  if (!seen) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Normalize a two-point drag box into a rect with non-negative extent. */
export function boxBetween(ax: number, ay: number, bx: number, by: number): Rect {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(bx - ax),
    h: Math.abs(by - ay),
  };
}

/** Shift+drag axis lock: the axis with the larger travel wins (spec §9). */
export function axisLock(dx: number, dy: number): { x: number; y: number } {
  return Math.abs(dx) >= Math.abs(dy) ? { x: dx, y: 0 } : { x: 0, y: dy };
}

export interface ResizeModifiers {
  /** Alt: the opposite edge moves too, keeping the centre fixed. */
  fromCenter?: boolean;
  /** Shift: keep the starting aspect ratio. */
  aspect?: boolean;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

function movesStart(handle: HandleId, ax: 'x' | 'y'): boolean {
  return ax === 'x'
    ? handle === 'w' || handle === 'nw' || handle === 'sw'
    : handle === 'n' || handle === 'ne' || handle === 'nw';
}

function movesEnd(handle: HandleId, ax: 'x' | 'y'): boolean {
  return ax === 'x'
    ? handle === 'e' || handle === 'ne' || handle === 'se'
    : handle === 's' || handle === 'se' || handle === 'sw';
}

function clamp(n: number, min: number | undefined, max: number | undefined): number {
  let v = n;
  if (typeof max === 'number' && Number.isFinite(max)) v = Math.min(v, max);
  if (typeof min === 'number' && Number.isFinite(min)) v = Math.max(v, min);
  return v < 0 ? 0 : v;
}

/**
 * Resize `start` by dragging `handle` through `(dx, dy)` — the pointer delta in
 * container-logical px.
 *
 * The edges the handle owns follow the pointer and the opposite edges stay put,
 * which is what makes a resize feel anchored. Under `fromCenter` (Alt) the
 * centre is what stays put and both edges move, so the moving edge still tracks
 * the pointer 1:1 while the rect grows twice as fast. Under `aspect` (Shift) the
 * starting ratio is preserved: a corner is driven by whichever axis travelled
 * further, an edge handle drives the perpendicular axis, and the perpendicular
 * axis grows from its anchored side (its centre under `fromCenter`).
 *
 * Min/max clamping happens last and re-derives the position from the anchor, so
 * hitting `minW` while dragging the west handle pins the east edge rather than
 * dragging the whole item along.
 */
export function resizeRect(
  start: Rect,
  handle: HandleId,
  dx: number,
  dy: number,
  mod: ResizeModifiers = {},
): Rect {
  const wStart = movesStart(handle, 'x');
  const wEnd = movesEnd(handle, 'x');
  const hStart = movesStart(handle, 'y');
  const hEnd = movesEnd(handle, 'y');
  const factor = mod.fromCenter === true ? 2 : 1;

  let w = start.w;
  let h = start.h;
  if (wEnd) w = start.w + factor * dx;
  else if (wStart) w = start.w - factor * dx;
  if (hEnd) h = start.h + factor * dy;
  else if (hStart) h = start.h - factor * dy;

  if (mod.aspect === true && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    const drivesX = wStart || wEnd;
    const drivesY = hStart || hEnd;
    // A corner follows the axis that moved further; an edge handle drives the
    // axis it owns and derives the other.
    const driveX = drivesX && (!drivesY || Math.abs(w - start.w) >= Math.abs(h - start.h));
    if (driveX) h = w / ratio;
    else w = h * ratio;
  }

  w = clamp(w, mod.minW, mod.maxW);
  h = clamp(h, mod.minH, mod.maxH);

  const right = start.x + start.w;
  const bottom = start.y + start.h;
  const cx = start.x + start.w / 2;
  const cy = start.y + start.h / 2;

  const x = mod.fromCenter === true && (wStart || wEnd) ? cx - w / 2 : wStart ? right - w : start.x;
  const y = mod.fromCenter === true && (hStart || hEnd) ? cy - h / 2 : hStart ? bottom - h : start.y;

  return { x, y, w, h };
}

/* ------------------------------------------------------------------ */
/* collision                                                           */
/* ------------------------------------------------------------------ */

function scopedForbid(self: LayoutItemBase, other: LayoutItemBase): boolean {
  if (self.collision !== 'forbid') return false;
  const scope = self.collisionWith;
  if (!scope || scope.length === 0) return true;
  const tags = other.tags;
  if (!tags || tags.length === 0) return false;
  for (const tag of tags) if (scope.includes(tag)) return true;
  return false;
}

/** A pair overlaps illegally when EITHER side forbids it (spec §1.12). */
export function pairForbidden(a: LayoutItemBase, b: LayoutItemBase): boolean {
  return scopedForbid(a, b) || scopedForbid(b, a);
}

/**
 * True when every proposed rect is collision-legal against the items that are
 * not moving. `allow` and `guide` never block a drop; only `forbid` does, and
 * only against the items its `collisionWith` tags scope it to.
 */
export function collisionValid(
  proposed: ReadonlyMap<string, Rect>,
  items: ReadonlyMap<string, LayoutItemBase>,
  staticRects: ReadonlyMap<string, Rect>,
): boolean {
  for (const [id, rect] of proposed) {
    const item = items.get(id);
    if (!item) continue;
    for (const [otherId, otherRect] of staticRects) {
      if (proposed.has(otherId)) continue;
      const other = items.get(otherId);
      if (!other || other.hidden === true) continue;
      if (!pairForbidden(item, other)) continue;
      if (rectsIntersect(rect, otherRect)) return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* keyboard snap jump                                                  */
/* ------------------------------------------------------------------ */

/**
 * Distance to the next snap candidate beyond `rect`'s edges along `axis`, in
 * the direction `dir` (+1 = toward the end edge).
 *
 * The candidate set is the same one the snap engine collects — every sibling's
 * start/centre/end plus the container's start/centre/end — read out of the very
 * same `GestureSnapshot`. It is scanned directionally here because
 * `SnapEngine.query()` is symmetric ("nearest within the threshold, either
 * side") and so cannot express "the next one that way".
 *
 * Returns `null` when nothing lies ahead; the caller then falls back to a plain
 * nudge so the key always does something.
 */
export function snapJumpDelta(
  snapshot: GestureSnapshot,
  rect: Rect,
  axis: 'x' | 'y',
  dir: 1 | -1,
): number | null {
  const pos = axis === 'x' ? rect.x : rect.y;
  const size = axis === 'x' ? rect.w : rect.h;
  const extent = axis === 'x' ? snapshot.width : snapshot.height;

  const lines: number[] = [0, extent / 2, extent];
  for (const [id, other] of snapshot.rects) {
    if (snapshot.movingIds.has(id)) continue;
    const p = axis === 'x' ? other.x : other.y;
    const s = axis === 'x' ? other.w : other.h;
    lines.push(p, p + s / 2, p + s);
  }

  const refs = [pos, pos + size / 2, pos + size];
  let best: number | null = null;
  for (const line of lines) {
    for (const ref of refs) {
      const delta = line - ref;
      if (dir > 0 ? delta <= EPS : delta >= -EPS) continue;
      if (best === null || Math.abs(delta) < Math.abs(best)) best = delta;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* guides                                                              */
/* ------------------------------------------------------------------ */

/**
 * Copy the engine's pooled guides.
 *
 * `SnapEngine.query()` reuses its result buffer AND the `Guide` objects inside
 * it across frames, so anything handed to `setInteraction` — which a React
 * overlay may read a tick later — has to be a copy.
 */
export function copyGuides(guides: readonly Guide[]): Guide[] {
  const out: Guide[] = [];
  for (const g of guides) out.push({ axis: g.axis, at: g.at, from: g.from, to: g.to, kind: g.kind });
  return out;
}

/* ------------------------------------------------------------------ */
/* the machine                                                         */
/* ------------------------------------------------------------------ */

export type GestureKind = 'drag' | 'resize' | 'marquee';

export type MachinePhase =
  | 'idle'
  | 'pressed'
  | 'dragging'
  | 'resizing'
  | 'marquee'
  | 'placing'
  | 'kb-grab';

export interface Modifiers {
  shift: boolean;
  alt: boolean;
  meta: boolean;
  ctrl: boolean;
}

export const NO_MODIFIERS: Modifiers = Object.freeze({
  shift: false,
  alt: false,
  meta: false,
  ctrl: false,
});

/** A pointer is down but the gesture has not been activated yet. */
export interface PressState {
  pointerId: number;
  pointerType: string;
  kind: GestureKind;
  /** Item under the pointer (null for a background press). */
  id: string | null;
  handle: HandleId | null;
  /** Press position in client px — activation distance is a SCREEN distance. */
  clientX: number;
  clientY: number;
  /** Press position in container-logical px. */
  localX: number;
  localY: number;
  shiftKey: boolean;
  /**
   * The press can only ever select: a locked item, or an item that declares a
   * drag handle that this press did not go through.
   */
  selectOnly: boolean;
}

export interface GestureSession {
  kind: GestureKind;
  ids: readonly string[];
  handle: HandleId | null;
  snapshot: GestureSnapshot;
  /** Rects at gesture start, per moving id. */
  startRects: Map<string, Rect>;
  /** Bounding box of `startRects` — the rect that gets snapped for a multi-drag. */
  union: Rect;
  /** Latest proposed rects (what a drop commits when `valid`). */
  current: Map<string, Rect>;
  /** Latest collision-legal rects, or null if the gesture was never legal. */
  lastValid: Map<string, Rect> | null;
  valid: boolean;
  /** Marquee box in container-logical px. */
  marquee: Rect | null;
  pending: readonly string[];
}

export interface GrabState {
  id: string;
  /** Rect at grab time — what Escape reverts to. */
  startRect: Rect;
  /** Ghost rect the arrows move; committed on drop. */
  rect: Rect;
  snapshot: GestureSnapshot;
}

export interface Machine {
  phase(): MachinePhase;
  /** True while a pointer gesture is pending or active. */
  busy(): boolean;
  press(state: PressState): void;
  pressed(): PressState | null;
  begin(session: GestureSession): void;
  session(): GestureSession | null;
  /** Clears the pointer phases only; `placing` and `kb-grab` are untouched. */
  reset(): void;
  grab(): GrabState | null;
  setGrab(state: GrabState | null): void;
  placing(): string | null;
  setPlacing(id: string | null): void;
}

/* ------------------------------------------------------------------ */
/* the runtime the sensors share                                       */
/* ------------------------------------------------------------------ */

/** Options after defaults are folded in; see `InteractionOptions`. */
export interface ResolvedOptions {
  snap: SnapConfig | false | undefined;
  longPress: number | 'off';
  strings: VizbrixStrings;
  getLabel: (item: LayoutItemBase) => string;
  onAnnounce: ((message: string, tone: 'assertive' | 'polite') => void) | undefined;
  /** Held to bypass snapping; resolved from `snap.bypassKey` or the platform. */
  bypassKey: 'meta' | 'ctrl' | 'alt' | 'shift' | 'none';
}

export type AnnounceKind =
  | 'grabbed'
  | 'moved'
  | 'dropped'
  | 'canceled'
  | 'resized'
  | 'removed'
  | 'placingStarted'
  | 'placed'
  | 'reordered';

/**
 * Everything the sensors need from the world, in one injected object.
 *
 * `pointer.ts`, `keyboard.ts` and `place.ts` reach the store, the snap engine,
 * the clock, the container and the announcer exclusively through this — which
 * is why none of them touch a DOM global, and why they can be exercised against
 * a hand-built runtime in tests. `controller.ts` is the only implementor.
 */
export interface InteractRuntime<TData = undefined> {
  readonly store: VizbrixStore<TData>;
  readonly machine: Machine;
  options(): ResolvedOptions;
  container(): HTMLElement | null;
  ownerDocument(): Document | null;
  isEdit(): boolean;
  /** Snap engine for the current options; rebuilt when `snap` changes. */
  engine(): SnapEngine;

  /**
   * Re-measure the container box. THE one allowed `getBoundingClientRect`, and
   * only at gesture start (pointerdown, keyboard grab, place) — never per frame.
   */
  measure(): void;
  /** Client point → container-logical point (RTL-mirrored, scale-divided). */
  toLocal(clientX: number, clientY: number): { x: number; y: number };
  /** Client delta → container-logical delta (RTL-negated, scale-divided). */
  toLocalDelta(dx: number, dy: number): { x: number; y: number };
  snapshot(movingIds: readonly string[]): GestureSnapshot;
  layoutWidth(): number;
  /** Definite container height, or undefined under `height:'auto'` with no base. */
  layoutHeight(): number | undefined;
  isRtl(): boolean;
  /** Is the configured bypass modifier held this frame? */
  bypass(mods: Modifiers): boolean;

  setInteraction(state: InteractionState): void;
  /** Reset the transient channel to `{ phase: 'idle' }` (identity-stable). */
  idle(): void;

  /** Imperative per-frame write: transform, plus width/height while resizing. */
  writeTransform(id: string, start: Rect, next: Rect, resize: boolean): void;
  clearTransform(id: string): void;

  /**
   * Reencode rects under each item's current axis modes and commit them as ONE
   * transaction (spec §8): one undo entry per gesture, whatever the arity.
   */
  commitRects(
    rects: ReadonlyMap<string, Rect>,
    kind: 'move' | 'resize',
    source: TxSource,
  ): TxResult;

  announce(kind: AnnounceKind, id: string, rect?: Rect, direction?: 'front' | 'back'): void;

  /* clock — injected so nothing here reads a DOM global */
  raf(cb: () => void): number;
  cancelRaf(handle: number): void;
  setTimer(cb: () => void, ms: number): number;
  clearTimer(handle: number): void;
}

export function createMachine(): Machine {
  let pressState: PressState | null = null;
  let sessionState: GestureSession | null = null;
  let grabState: GrabState | null = null;
  let placingId: string | null = null;

  return {
    phase() {
      if (sessionState) {
        return sessionState.kind === 'drag'
          ? 'dragging'
          : sessionState.kind === 'resize'
            ? 'resizing'
            : 'marquee';
      }
      if (pressState) return 'pressed';
      if (grabState) return 'kb-grab';
      if (placingId !== null) return 'placing';
      return 'idle';
    },
    busy: () => pressState !== null || sessionState !== null,
    press(state) {
      pressState = state;
      sessionState = null;
    },
    pressed: () => pressState,
    begin(session) {
      sessionState = session;
    },
    session: () => sessionState,
    reset() {
      pressState = null;
      sessionState = null;
    },
    grab: () => grabState,
    setGrab(state) {
      grabState = state;
    },
    placing: () => placingId,
    setPlacing(id) {
      placingId = id;
    },
  };
}
