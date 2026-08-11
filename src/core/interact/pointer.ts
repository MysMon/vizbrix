/**
 * The pointer sensor — spec §10 and §1.18.
 *
 * One `pointerdown` listener on the container; everything after activation is
 * document-level so the gesture survives the pointer leaving the container, and
 * `setPointerCapture` keeps the stream coming from the same pointer.
 *
 * ## The frame
 *
 * `pointermove` never computes anything: it records the latest position and
 * modifier state and schedules a rAF. One frame = one delta → snap query →
 * collision check → imperative `transform` write per moving item → one
 * `store.setInteraction()`. No item re-renders, no measurement, and the only
 * allocation is the proposed-rect map and the guide copies.
 *
 * ## Touch (§1.18)
 *
 * Touch activates on a 450 ms long press with an 8 px slop, and the moment it
 * activates a document-level `touchmove` listener with `{ passive: false }`
 * starts calling `preventDefault()`. That listener is the mechanism:
 * `setPointerCapture` cannot stop a scroll that has already begun, and mutating
 * `touch-action` mid-gesture is a no-op. `longPress: 'off'` drops touch to the
 * same 3 px activation as the mouse, for apps that gate editing behind a
 * toolbar.
 *
 * ## Forbidden overlaps (§1.12)
 *
 * The ghost tracks the pointer 1:1 for the whole gesture — it is NEVER pinned
 * to the last legal spot, because a ghost that stops following the finger reads
 * as a dropped frame. The last legal rects are tracked alongside and are what
 * the drop commits; a gesture that was never legal commits nothing at all.
 */

import type { LayoutItemBase, Rect } from '../schema/types';
import type { GestureKind, InteractRuntime, Modifiers } from './machine';
import {
  ACTIVATE_PX,
  LONG_PRESS_MS,
  TOUCH_SLOP_PX,
  axisLock,
  boxBetween,
  collisionValid,
  copyGuides,
  logicalHandle,
  resizeRect,
  sameRect,
  satisfiedGuides,
  translated,
  unionOf,
} from './machine';
import { idsIntersecting, moveButtonItemId, resolvePointerTarget } from './hit';

/** The slice of `PointerEvent` this sensor reads. */
interface PointerLike {
  pointerId: number;
  pointerType: string;
  button: number;
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  target: unknown;
  composedPath?: () => unknown[];
  preventDefault?: () => void;
}

interface KeyLike {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  preventDefault?: () => void;
}

export interface PointerHooks {
  /** A press inside the container while placing lands the item (SC 2.5.7). */
  completePlace(point: { x: number; y: number }): void;
  /** Taking the pointer abandons a keyboard grab. */
  cancelGrab(): void;
}

export interface Sensor {
  attach(container: HTMLElement): () => void;
  /** Abort any in-flight gesture, reverting transforms. */
  cancel(): void;
}

const ZERO: Rect = { x: 0, y: 0, w: 0, h: 0 };

/** Capture, so a scroll on any ancestor of the container is seen. */
const SCROLL_OPTS = { capture: true, passive: true } as const;

function modsOf(ev: { shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }): Modifiers {
  return {
    shift: ev.shiftKey === true,
    alt: ev.altKey === true,
    meta: ev.metaKey === true,
    ctrl: ev.ctrlKey === true,
  };
}

function pathOf(ev: PointerLike): unknown[] {
  if (typeof ev.composedPath === 'function') return ev.composedPath();
  return ev.target ? [ev.target] : [];
}

export function createPointerSensor<TData>(
  rt: InteractRuntime<TData>,
  hooks: PointerHooks,
): Sensor {
  const machine = rt.machine;

  let container: HTMLElement | null = null;
  let docBound = false;
  let touchGuardBound = false;
  let clientX = 0;
  let clientY = 0;
  let mods: Modifiers = { shift: false, alt: false, meta: false, ctrl: false };
  let rafHandle = 0;
  let rafPending = false;
  let longPressHandle = 0;
  /** All items, indexed once per gesture — the collision check runs per frame. */
  let items = new Map<string, LayoutItemBase>();
  let anyForbid = false;

  /* ---------------- scheduling ---------------- */

  function schedule(): void {
    if (rafPending) return;
    rafPending = true;
    rafHandle = rt.raf(() => {
      rafPending = false;
      frame();
    });
  }

  function unschedule(): void {
    if (!rafPending) return;
    rafPending = false;
    rt.cancelRaf(rafHandle);
  }

  /* ---------------- document listeners ---------------- */

  function bindDocument(): void {
    const doc = rt.ownerDocument();
    if (!doc || docBound) return;
    docBound = true;
    doc.addEventListener('pointermove', onPointerMove as EventListener);
    doc.addEventListener('pointerup', onPointerUp as EventListener);
    doc.addEventListener('pointercancel', onPointerCancel as EventListener);
    doc.addEventListener('keydown', onGestureKey as EventListener);
    doc.addEventListener('keyup', onGestureKey as EventListener);
    doc.addEventListener('contextmenu', onContextMenu as EventListener);
    doc.addEventListener('scroll', onScroll as EventListener, SCROLL_OPTS);
  }

  function unbindDocument(): void {
    const doc = rt.ownerDocument();
    if (!doc || !docBound) return;
    docBound = false;
    doc.removeEventListener('pointermove', onPointerMove as EventListener);
    doc.removeEventListener('pointerup', onPointerUp as EventListener);
    doc.removeEventListener('pointercancel', onPointerCancel as EventListener);
    doc.removeEventListener('keydown', onGestureKey as EventListener);
    doc.removeEventListener('keyup', onGestureKey as EventListener);
    doc.removeEventListener('contextmenu', onContextMenu as EventListener);
    doc.removeEventListener('scroll', onScroll as EventListener, SCROLL_OPTS);
  }

  /**
   * The marquee is the only frame path that converts an ABSOLUTE client point,
   * so it is the only one the container box moving out from under the gesture
   * can corrupt: drag and resize work off client DELTAS and are scroll
   * invariant. Re-measuring here (and only here) keeps the "one measurement per
   * gesture" rule true for the paths it exists to protect.
   */
  function onScroll(): void {
    const session = machine.session();
    if (!session || session.kind !== 'marquee') return;
    rt.measure();
    schedule();
  }

  /**
   * Stop the page scrolling for the duration of a touch gesture.
   * `{ passive: false }` is the whole point — a passive listener may not
   * `preventDefault()`, and `touch-action` can no longer help once the scroll
   * has started.
   */
  function bindTouchGuard(): void {
    const doc = rt.ownerDocument();
    if (!doc || touchGuardBound) return;
    touchGuardBound = true;
    doc.addEventListener('touchmove', preventTouch as EventListener, { passive: false });
  }

  function unbindTouchGuard(): void {
    const doc = rt.ownerDocument();
    if (!doc || !touchGuardBound) return;
    touchGuardBound = false;
    doc.removeEventListener('touchmove', preventTouch as EventListener);
  }

  function preventTouch(ev: Event): void {
    if (machine.session() === null) return;
    if (ev.cancelable !== false) ev.preventDefault();
  }

  function onContextMenu(ev: Event): void {
    // Spec §1.10: a right-click in the middle of a drag must not open a menu
    // that eats the pointerup and strands the gesture.
    if (machine.session() === null) return;
    ev.preventDefault();
  }

  /* ---------------- press ---------------- */

  function onPointerDown(evt: Event): void {
    const ev = evt as unknown as PointerLike;
    if (!rt.isEdit()) return;
    const el = rt.container();
    if (!el) return;
    if (typeof ev.button === 'number' && ev.button !== 0) return;

    // Taking the pointer abandons a keyboard grab — including on the press that
    // lands a tap-to-place, which would otherwise leave the grab's stale ghost
    // alive to overwrite the landing on its own drop.
    if (machine.grab() !== null) hooks.cancelGrab();

    if (machine.placing() !== null) {
      // A press that starts on the ARMED item's own move button is the
      // button's toggle, not a landing. This native listener fires before the
      // adapter's delegated click handler, so completing here would place the
      // item at the button's own coordinates and turn the documented
      // "tap the move button again cancels" into a teleport. The session is
      // left untouched — and the event unconsumed — for the button's click
      // handler to disarm. Another item's move button is still "anywhere in
      // the dashboard" and lands the item like any other press.
      if (moveButtonItemId(pathOf(ev), el) === machine.placing()) return;
      rt.measure();
      hooks.completePlace(rt.toLocal(ev.clientX, ev.clientY));
      ev.preventDefault?.();
      return;
    }
    if (machine.busy()) return;

    const target = resolvePointerTarget(pathOf(ev), el);
    if (target.kind === 'outside') return;

    let kind: GestureKind = 'marquee';
    let selectOnly = false;
    if (target.kind === 'handle' || target.kind === 'item') {
      const item = target.id === null ? undefined : rt.store.getItem(target.id);
      if (!item) return;
      kind = target.kind === 'handle' ? 'resize' : 'drag';
      // A locked item still takes selection — it just cannot move (§2). A drag
      // handle scopes where a drag may start; pressing elsewhere selects only.
      selectOnly =
        item.locked === true ||
        (target.kind === 'item' && target.hasDragHandle && !target.viaDragHandle);
      if (target.kind === 'handle' && selectOnly) return;
    }

    rt.measure();
    const local = rt.toLocal(ev.clientX, ev.clientY);
    clientX = ev.clientX;
    clientY = ev.clientY;
    mods = modsOf(ev);

    machine.press({
      pointerId: typeof ev.pointerId === 'number' ? ev.pointerId : 0,
      pointerType: typeof ev.pointerType === 'string' ? ev.pointerType : 'mouse',
      kind,
      id: target.id,
      handle: target.handle,
      clientX: ev.clientX,
      clientY: ev.clientY,
      localX: local.x,
      localY: local.y,
      shiftKey: mods.shift,
      selectOnly,
    });

    bindDocument();
    capture(el, ev.pointerId);

    if (!selectOnly && isLongPress(ev.pointerType)) {
      const delay = rt.options().longPress;
      longPressHandle = rt.setTimer(activate, typeof delay === 'number' ? delay : LONG_PRESS_MS);
    }
  }

  function isLongPress(pointerType: string): boolean {
    return pointerType === 'touch' && rt.options().longPress !== 'off';
  }

  function capture(el: HTMLElement, pointerId: number): void {
    try {
      el.setPointerCapture?.(pointerId);
    } catch {
      /* jsdom, or a pointer that already ended — capture is an optimisation */
    }
  }

  function release(): void {
    const press = machine.pressed();
    if (!press || !container) return;
    try {
      if (container.hasPointerCapture?.(press.pointerId)) {
        container.releasePointerCapture?.(press.pointerId);
      }
    } catch {
      /* ignore */
    }
  }

  /* ---------------- activation ---------------- */

  function maybeActivate(): void {
    const press = machine.pressed();
    if (!press || press.selectOnly) return;
    const dx = clientX - press.clientX;
    const dy = clientY - press.clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (isLongPress(press.pointerType)) {
      // Before the long press fires, movement means the user is scrolling.
      if (dist > TOUCH_SLOP_PX) abandon();
      return;
    }
    if (dist >= ACTIVATE_PX) activate();
  }

  /** The long press lost to a scroll: give the gesture up entirely. */
  function abandon(): void {
    finish();
  }

  function activate(): void {
    const press = machine.pressed();
    if (!press || machine.session() !== null) return;
    rt.clearTimer(longPressHandle);
    longPressHandle = 0;

    let ids: string[] = [];
    if (press.kind === 'drag' && press.id !== null) {
      const selection = rt.store.getSelection();
      const inSelection = selection.includes(press.id);
      // Same criterion the snapshot uses: an item with no snapshot rect has no
      // start rect either, and dragging it would commit a rect made up here.
      ids = (inSelection ? selection.slice() : [press.id]).filter((id) => {
        const view = rt.store.getItemView(id);
        return view !== undefined && view.item.locked !== true && view.item.hidden !== true;
      });
      if (ids.length === 0) return;
      if (!inSelection) rt.store.setSelection(ids);
    } else if (press.kind === 'resize' && press.id !== null) {
      ids = [press.id];
    }

    const snapshot = rt.snapshot(ids);
    const startRects = new Map<string, Rect>();
    for (const id of ids) {
      const rect = snapshot.rects.get(id);
      if (rect) startRects.set(id, rect);
    }
    if (press.kind !== 'marquee' && startRects.size === 0) return;
    // `ids` and `startRects` stay in lockstep — a marquee moves nothing, so both
    // are empty there.
    ids = [...startRects.keys()];

    indexItems(ids);
    if (press.kind !== 'marquee') rt.engine().begin(snapshot);

    machine.begin({
      kind: press.kind,
      ids,
      handle: press.handle,
      snapshot,
      startRects,
      union: unionOf(startRects.values()) ?? ZERO,
      current: new Map(startRects),
      lastValid: null,
      valid: true,
      marquee: null,
      pending: [],
    });

    if (press.pointerType === 'touch') bindTouchGuard();
    frame();
  }

  /**
   * Index the document once per gesture. `forbid` is rare, so the per-frame
   * collision pass is skipped entirely when no item in play declares it.
   */
  function indexItems(movingIds: readonly string[]): void {
    items = new Map<string, LayoutItemBase>();
    anyForbid = false;
    for (const item of rt.store.getDoc()?.items ?? []) {
      items.set(item.id, item);
      if (item.collision === 'forbid') anyForbid = true;
    }
    if (movingIds.length === 0) anyForbid = false;
  }

  /* ---------------- per-frame ---------------- */

  function frame(): void {
    const session = machine.session();
    const press = machine.pressed();
    if (!session || !press) return;
    if (session.kind === 'marquee') return frameMarquee();
    if (session.kind === 'resize') return frameResize();
    return frameDrag();
  }

  function pointerDelta(): { x: number; y: number } {
    const press = machine.pressed()!;
    return rt.toLocalDelta(clientX - press.clientX, clientY - press.clientY);
  }

  function frameDrag(): void {
    const session = machine.session()!;
    const raw = pointerDelta();
    let dx = raw.x;
    let dy = raw.y;
    if (mods.shift) {
      const locked = axisLock(dx, dy);
      dx = locked.x;
      dy = locked.y;
    }

    // The union of the selection is what snaps: a multi-drag keeps its internal
    // geometry and lands as one shape (§10).
    const snap = rt.engine().query(translated(session.union, dx, dy), 'move', null, rt.bypass(mods));
    dx += snap.dx;
    dy += snap.dy;

    const rects = new Map<string, Rect>();
    for (const id of session.ids) {
      const start = session.startRects.get(id);
      if (start) rects.set(id, translated(start, dx, dy));
    }

    const valid = anyForbid ? collisionValid(rects, items, session.snapshot.rects) : true;
    session.current = rects;
    session.valid = valid;
    if (valid) session.lastValid = rects;

    for (const id of session.ids) {
      const start = session.startRects.get(id);
      const next = rects.get(id);
      if (start && next) rt.writeTransform(id, start, next, false);
    }

    rt.setInteraction({
      phase: 'dragging',
      ids: session.ids,
      rects,
      guides: copyGuides(snap.guides),
      valid,
      lastValidRects: session.lastValid,
    });
  }

  function frameResize(): void {
    const session = machine.session()!;
    const id = session.ids[0];
    const handle = session.handle;
    if (id === undefined || handle === null) return;
    const start = session.startRects.get(id);
    if (!start) return;
    // The rect math and the engine's handle mask are both LOGICAL; the compass
    // id the adapter rendered is physical (§1.26).
    const edge = logicalHandle(handle, rt.isRtl());

    const item = rt.store.getItem(id);
    const limits = {
      fromCenter: mods.alt,
      aspect: mods.shift,
      minW: item?.minW,
      minH: item?.minH,
      maxW: item?.maxW,
      maxH: item?.maxH,
    };

    const raw = pointerDelta();
    let rect = resizeRect(start, edge, raw.x, raw.y, limits);
    // The engine corrects the edge(s) the handle drives, which is exactly what
    // the pointer delta drives — so the correction folds back into the delta and
    // the rect is recomputed once, keeping min/max and aspect authoritative.
    // Under fromCenter the driven edge still moves 1:1 but the SIZE changes at
    // twice that rate; the factor is what keeps size-match corrections foldable.
    const snap = rt.engine().query(rect, 'resize', edge, rt.bypass(mods), limits.fromCenter ? 2 : 1);
    if (snap.dx !== 0 || snap.dy !== 0) {
      rect = resizeRect(start, edge, raw.x + snap.dx, raw.y + snap.dy, limits);
    }

    const rects = new Map<string, Rect>([[id, rect]]);
    const valid = anyForbid ? collisionValid(rects, items, session.snapshot.rects) : true;
    session.current = rects;
    session.valid = valid;
    if (valid) session.lastValid = rects;

    rt.writeTransform(id, start, rect, true);
    rt.setInteraction({
      phase: 'resizing',
      id,
      handle,
      rect,
      // The recompute can settle off the queried position (an aspect
      // re-derivation, a min/max clamp), so only the lines the final rect
      // actually sits on are drawn.
      guides: satisfiedGuides(snap.guides, rect, edge),
      valid,
      lastValidRect: session.lastValid?.get(id) ?? null,
    });
  }

  function frameMarquee(): void {
    const session = machine.session()!;
    const press = machine.pressed()!;
    const point = rt.toLocal(clientX, clientY);
    const box = boxBetween(press.localX, press.localY, point.x, point.y);
    const pending = idsIntersecting(session.snapshot.rects, rt.store.getOrder(), box);
    session.marquee = box;
    session.pending = pending;
    rt.setInteraction({ phase: 'marquee', rect: box, pending });
  }

  /* ---------------- movement / release ---------------- */

  function onPointerMove(evt: Event): void {
    const ev = evt as unknown as PointerLike;
    const press = machine.pressed();
    if (!press) return;
    if (typeof ev.pointerId === 'number' && ev.pointerId !== press.pointerId) return;
    clientX = ev.clientX;
    clientY = ev.clientY;
    mods = modsOf(ev);
    if (machine.session() === null) {
      maybeActivate();
      return;
    }
    schedule();
  }

  function onPointerUp(evt: Event): void {
    const ev = evt as unknown as PointerLike;
    const press = machine.pressed();
    if (!press) return;
    if (typeof ev.pointerId === 'number' && ev.pointerId !== press.pointerId) return;
    if (typeof ev.clientX === 'number') {
      clientX = ev.clientX;
      clientY = ev.clientY;
    }
    mods = modsOf(ev);
    const session = machine.session();
    if (!session) {
      click(ev);
      finish();
      return;
    }
    // The last rAF may never have run: every move since it was scheduled is
    // still unprocessed, so the frame is recomputed at the RELEASE position
    // before it is committed. Without this the item lands where the last frame
    // that happened to run put it, short of where the user let go.
    unschedule();
    frame();
    commit();
    finish();
  }

  function onPointerCancel(evt: Event): void {
    const ev = evt as unknown as PointerLike;
    const press = machine.pressed();
    if (!press) return;
    // Document-level and fired per pointer: a palm or a second finger being
    // cancelled by the browser (palm rejection, a scroll or system gesture
    // taking the touch) must not abort the tracked gesture.
    if (typeof ev.pointerId === 'number' && ev.pointerId !== press.pointerId) return;
    revert();
    finish();
  }

  function onGestureKey(evt: Event): void {
    const ev = evt as unknown as KeyLike;
    if (!machine.pressed()) return;
    if (ev.key === 'Escape') {
      ev.preventDefault?.();
      revert();
      finish();
      return;
    }
    // Modifiers are live: pressing Cmd mid-drag must drop the snap on the next
    // frame even if the pointer is standing still.
    mods = modsOf(ev);
    if (machine.session() !== null) schedule();
  }

  /* ---------------- selection / commit / teardown ---------------- */

  function click(ev: PointerLike): void {
    const press = machine.pressed();
    if (!press) return;
    const store = rt.store;
    const shift = ev.shiftKey === true;
    if (press.id === null) {
      if (!shift) store.setSelection([]);
      return;
    }
    const selection = store.getSelection();
    if (!shift) {
      store.setSelection([press.id]);
      return;
    }
    store.setSelection(
      selection.includes(press.id)
        ? selection.filter((id) => id !== press.id)
        : [...selection, press.id],
    );
  }

  function commit(): void {
    const session = machine.session();
    if (!session) return;

    if (session.kind === 'marquee') {
      const next = mods.shift
        ? [...rt.store.getSelection(), ...session.pending.filter((id) => !rt.store.getSelection().includes(id))]
        : session.pending;
      rt.store.setSelection(next);
      return;
    }

    for (const id of session.ids) rt.clearTransform(id);

    // §1.12: a forbidden landing resolves to the last legal rects; a gesture
    // that was never legal records nothing at all.
    const rects = session.valid ? session.current : session.lastValid;
    if (!rects || rects.size === 0) return;

    let moved = false;
    for (const [id, rect] of rects) {
      const start = session.startRects.get(id);
      if (!start || !sameRect(start, rect)) moved = true;
    }
    if (!moved) return;

    rt.commitRects(rects, session.kind === 'resize' ? 'resize' : 'move', 'pointer');
  }

  /** Escape / pointercancel: put every moving node back where it started. */
  function revert(): void {
    const session = machine.session();
    if (!session) return;
    for (const id of session.ids) rt.clearTransform(id);
  }

  function finish(): void {
    unschedule();
    rt.clearTimer(longPressHandle);
    longPressHandle = 0;
    release();
    unbindTouchGuard();
    unbindDocument();
    if (machine.session() !== null) rt.engine().end();
    machine.reset();
    items = new Map();
    anyForbid = false;
    rt.idle();
  }

  return {
    attach(el) {
      container = el;
      el.addEventListener('pointerdown', onPointerDown as EventListener);
      return () => {
        el.removeEventListener('pointerdown', onPointerDown as EventListener);
        if (machine.busy()) {
          revert();
          finish();
        }
        if (container === el) container = null;
      };
    },
    cancel() {
      if (!machine.busy()) return;
      revert();
      finish();
    },
  };
}
