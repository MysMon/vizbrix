/**
 * The keyboard sensor — spec §10 (keyboard sensor) and §11 (announcements).
 *
 * Everything a pointer can do has a keyboard equivalent here (SC 2.1.1):
 *
 * | keys                   | effect                                            |
 * |------------------------|---------------------------------------------------|
 * | Arrow / Shift+Arrow    | nudge 1 px / 10 px                                 |
 * | Cmd or Ctrl + Arrow    | jump to the next snap candidate that way           |
 * | Enter / Space          | grab ↔ drop                                        |
 * | R                      | resize grab ↔ commit (arrows size the ghost)       |
 * | Escape                 | cancel a grab, reverting to where it was picked up  |
 * | Delete / Backspace     | remove                                             |
 * | Cmd/Ctrl + ] / [       | bring to front / send to back                      |
 * | Cmd/Ctrl + Z / ⇧Z      | undo / redo                                        |
 *
 * A grab session comes in two kinds sharing one machinery: Enter/Space arms a
 * MOVE grab whose arrows translate the ghost, R arms a RESIZE grab whose arrows
 * size it — Right/Down grow, Left/Up shrink, driven at the logical end corner
 * so the start edges stay anchored. That is the keyboard mirror of the
 * pointer's 8 handles (SC 2.1.1: every pointer operation has a keyboard path).
 * Either kind: Escape reverts, focus loss cancels, and the drop is ONE
 * transaction through the same `commitRects` chokepoint, so a `forbid` landing
 * is refused and the session stays live. Cmd/Ctrl+R is left alone — that
 * shortcut belongs to the browser.
 *
 * While tap-to-place is armed the container owns three of them: Escape cancels
 * the placement from anywhere inside it, and Enter/Space (R) hands the item
 * over to a keyboard move (resize) grab — the two sessions are never armed at
 * once.
 *
 * ## Whose keys are these?
 *
 * The listener is on the CONTAINER, so every keystroke typed into a widget
 * passes through it. Anything that handles its own keys — form controls,
 * `contenteditable`, links, buttons — keeps them (`isEditableTarget`), unless it
 * opts back in with `data-vzb-keys`. The exception is a live grab, which owns
 * the keyboard until it ends wherever focus drifted to.
 *
 * ## Why nudges commit immediately
 *
 * A nudge could batch into a grab-like session that commits after an idle
 * timeout — fewer undo entries, but a timer decides where the transaction
 * boundary is, which makes undo depend on how fast the user types and leaves a
 * transaction open across blur, unmount and programmatic edits. So: **each
 * arrow press is one commit and therefore one undo step.** It is the simpler
 * contract and the honest one. Users who want a single undo entry for a long
 * move have Enter — a grab session moves a ghost and commits ONE transaction on
 * drop (which is also the only way to move without touching the document at
 * all, and so the only way Escape can truly revert).
 *
 * ## Announcements
 *
 * Transitions (grab, drop, cancel, remove) are assertive; position status
 * (moved, reordered) is polite — spec §11's two live regions.
 */

import type { Rect } from '../schema/types';
import type { GrabState, InteractRuntime } from './machine';
import { NUDGE_COARSE_PX, NUDGE_PX, resizeRect, snapJumpDelta, translated } from './machine';
import { itemIdFromPath } from './hit';

interface KeyLike {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  target: unknown;
  composedPath?: () => unknown[];
  preventDefault?: () => void;
}

interface FocusLike {
  relatedTarget: unknown;
}

export interface KeyboardSensor {
  attach(container: HTMLElement): () => void;
  /** Abort a grab without committing (used when a pointer takes over). */
  cancelGrab(): void;
}

export interface KeyboardHooks {
  /**
   * Disarm tap-to-place. `silent` suppresses the cancellation announcement for
   * a hand-over to the keyboard grab, which announces "grabbed" itself.
   */
  cancelPlace(silent?: boolean): void;
}

/**
 * Elements that own their own keystrokes. The sensor listens on the CONTAINER,
 * so without this every character typed into a widget's `<input>` would also be
 * a layout command — Backspace deleting the item being the worst of them.
 */
const EDITABLE_TAGS: ReadonlySet<string> = new Set([
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'OPTION',
  'BUTTON',
  'A',
]);

/**
 * Does the event come from something inside the item that handles its own keys?
 *
 * The walk stops at the item root (`data-vzb-item`) — the item div itself is a
 * `role="button"` and must keep its shortcuts — and at the container. Content
 * that genuinely wants the layout shortcuts (a custom control, a canvas) opts
 * back in with `data-vzb-keys`.
 *
 * Structurally typed against the composed path so the sensor stays testable
 * with hand-built events and works across shadow boundaries.
 */
function isEditableTarget(path: readonly unknown[], container: unknown): boolean {
  for (const node of path) {
    if (node === container) return false;
    if (!node || typeof node !== 'object') continue;
    const el = node as {
      tagName?: string;
      isContentEditable?: boolean;
      getAttribute?: (name: string) => string | null;
    };
    if (typeof el.getAttribute === 'function' && el.getAttribute('data-vzb-keys') !== null) {
      return false;
    }
    if (el.isContentEditable === true) return true;
    if (typeof el.tagName === 'string' && EDITABLE_TAGS.has(el.tagName)) return true;
    if (typeof el.getAttribute === 'function') {
      const ce = el.getAttribute('contenteditable');
      if (ce !== null && ce !== 'false') return true;
      if (el.getAttribute('data-vzb-item') !== null) return false;
    }
  }
  return false;
}

function isCommitKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar';
}

/** R arms (and commits) a resize grab; Shift+R counts, Cmd/Ctrl+R never does. */
function isResizeKey(key: string): boolean {
  return key === 'r' || key === 'R';
}

const ARROWS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

function pathOf(ev: KeyLike): unknown[] {
  if (typeof ev.composedPath === 'function') return ev.composedPath();
  return ev.target ? [ev.target] : [];
}

function contains(container: HTMLElement, node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const el = node as { nodeType?: number };
  if (typeof el.nodeType !== 'number') return false;
  return container.contains?.(node as Node) === true;
}

export function createKeyboardSensor<TData>(
  rt: InteractRuntime<TData>,
  hooks: KeyboardHooks,
): KeyboardSensor {
  const machine = rt.machine;

  function onKeyDown(evt: Event): void {
    const ev = evt as unknown as KeyLike;
    if (!rt.isEdit()) return;
    const container = rt.container();
    if (!container) return;

    const path = pathOf(ev);
    const placing = machine.placing();

    // Tap-to-place is modal: while it is armed Escape ends it from ANYWHERE in
    // the container — including the move button that armed it and a focused
    // field — because there is otherwise no way back out of a state where the
    // next press anywhere teleports the item.
    if (placing !== null && ev.key === 'Escape') {
      ev.preventDefault?.();
      hooks.cancelPlace();
      return;
    }

    // A live pointer gesture owns the document. Its session and snapshot are
    // frozen at pointerdown, and a press focuses the item, so keystrokes land
    // here mid-drag: undo would rewrite the rects the session started from,
    // a nudge would commit a spurious mid-gesture transaction the drop then
    // overwrites, and Delete would remove the item the session still holds.
    // Every shortcut waits until the pointer lets go; Escape is untouched by
    // this return and cancels the gesture via the pointer sensor's
    // document-level listener.
    if (machine.busy()) return;

    // A grab owns the keyboard until it ends, wherever focus drifted to;
    // everything else yields to content that handles its own keys.
    const grab = machine.grab();
    if (grab === null && isEditableTarget(path, container)) return;

    const mod = ev.metaKey === true || ev.ctrlKey === true;
    if (mod && (ev.key === 'z' || ev.key === 'Z')) {
      ev.preventDefault?.();
      if (ev.shiftKey === true) rt.store.redo();
      else rt.store.undo();
      return;
    }

    // Enter/Space (R) on the armed item hands tap-to-place over to a keyboard
    // move (resize) grab — the keyboard's own way of choosing a location or
    // size. The two phases can never be armed at once (§10): the grab is what
    // moves the item from here on.
    const resizeKey = isResizeKey(ev.key) && !mod;
    if (placing !== null && grab === null && (isCommitKey(ev.key) || resizeKey)) {
      ev.preventDefault?.();
      beginGrab(placing, resizeKey ? 'resize' : 'move');
      return;
    }

    const id = grab?.id ?? itemIdFromPath(path, container);
    if (id === null || id === undefined) return;
    if (rt.store.getItem(id) === undefined) return;

    const arrow = ARROWS[ev.key];
    if (arrow) {
      ev.preventDefault?.();
      if (grab !== null && grab.kind === 'resize') resizeBy(grab, arrow, ev);
      else nudge(id, arrow, ev);
      return;
    }

    if (resizeKey) {
      // R during a MOVE grab is ignored: its arrows already mean "move", and
      // silently flipping them to "resize" mid-session would repurpose every
      // key the user is holding. R with no session live arms a resize grab;
      // during a resize grab it commits, same as Enter.
      if (grab !== null && grab.kind === 'move') return;
      ev.preventDefault?.();
      if (grab) drop();
      else beginGrab(id, 'resize');
      return;
    }

    switch (ev.key) {
      case 'Enter':
      case ' ':
      case 'Spacebar':
        ev.preventDefault?.();
        if (grab) drop();
        else beginGrab(id, 'move');
        return;
      case 'Escape':
        if (!grab) return;
        ev.preventDefault?.();
        cancelGrab();
        return;
      case 'Delete':
      case 'Backspace':
        ev.preventDefault?.();
        remove(id);
        return;
      case ']':
        if (!mod) return;
        ev.preventDefault?.();
        reorder(id, 'front');
        return;
      case '[':
        if (!mod) return;
        ev.preventDefault?.();
        reorder(id, 'back');
        return;
      default:
        return;
    }
  }

  /* ---------------- movement ---------------- */

  function nudge(id: string, arrow: { x: number; y: number }, ev: KeyLike): void {
    const grab = machine.grab();
    const item = rt.store.getItem(id);
    if (!item || item.locked === true) return;
    const rect = grab ? grab.rect : rt.store.getItemView(id)?.rect;
    if (!rect) return;

    // Arrow keys are SCREEN directions; `Rect.x` is logical, so under RTL the
    // left arrow increases x (spec §1.26).
    const sign = rt.isRtl() ? -1 : 1;
    let dx = arrow.x * sign;
    let dy = arrow.y;

    if (ev.metaKey === true || ev.ctrlKey === true) {
      const snapshot = grab ? grab.snapshot : rt.snapshot([id]);
      const axis = arrow.x !== 0 ? 'x' : 'y';
      const dir: 1 | -1 = (axis === 'x' ? dx : dy) > 0 ? 1 : -1;
      const jump = snapJumpDelta(snapshot, rect, axis, dir);
      // Nothing ahead: fall back to a plain nudge so the key is never dead.
      const step = jump ?? dir * NUDGE_PX;
      dx = axis === 'x' ? step : 0;
      dy = axis === 'y' ? step : 0;
    } else {
      const step = ev.shiftKey === true ? NUDGE_COARSE_PX : NUDGE_PX;
      dx *= step;
      dy *= step;
    }

    const next = translated(rect, dx, dy);
    if (grab) {
      grab.rect = next;
      rt.setInteraction({ phase: 'kb-grab', id, rect: next });
      rt.announce('moved', id, next);
      return;
    }
    // Immediate commit: one arrow press, one transaction, one undo step.
    const result = rt.commitRects(new Map<string, Rect>([[id, next]]), 'move', 'keyboard');
    if (result.status === 'applied') {
      rt.announce('moved', id);
      return;
    }
    // §1.12: a `forbid` landing is refused, so the key IS dead here (the comment
    // above about the snap jump never being dead holds only for `allow`). Say so
    // politely — arrow keys repeat, and an assertive interrupt per press would
    // make the dashboard unusable with a screen reader.
    if (result.status === 'blocked') rt.announce('canceled', id, rect, undefined, 'polite');
  }

  /* ---------------- grab session ---------------- */

  function beginGrab(id: string, kind: 'move' | 'resize'): void {
    if (machine.busy()) return;
    const item = rt.store.getItem(id);
    const rect = rt.store.getItemView(id)?.rect;
    if (!item || !rect || item.locked === true) return;
    // Arming a grab disarms tap-to-place: two live sessions on one item let the
    // grab's stale ghost overwrite the landing on drop. Silent — `grabbed` is
    // the announcement that describes the state the user is now in.
    if (machine.placing() !== null) hooks.cancelPlace(true);
    machine.setGrab({
      kind,
      id,
      startRect: rect,
      rect,
      snapshot: rt.snapshot([id]),
    });
    rt.setInteraction({ phase: 'kb-grab', id, rect });
    rt.announce('grabbed', id, rect);
  }

  function drop(): void {
    const grab = machine.grab();
    if (!grab) return;
    // One grab session = ONE transaction, however many arrow presses it took.
    // Committed BEFORE the grab is torn down: a `forbid` landing is refused
    // (§1.12) and the item then stays grabbed, so the user can keep moving it
    // instead of being dropped into a state the document rejected. A ghost
    // still at its start rect commits nothing (the store's same-placement
    // check), so a no-op session leaves no undo entry.
    const result = rt.commitRects(
      new Map<string, Rect>([[grab.id, grab.rect]]),
      grab.kind,
      'keyboard',
    );
    if (result.status === 'blocked') {
      rt.announce('canceled', grab.id, grab.rect);
      return;
    }
    machine.setGrab(null);
    rt.idle();
    // Ending the session is a transition (§11), hence assertive for both
    // kinds; `resized` doubles as the resize grab's drop announcement so no
    // new string is required of custom locales.
    if (grab.kind === 'resize') rt.announce('resized', grab.id, grab.rect, undefined, 'assertive');
    else rt.announce('dropped', grab.id);
  }

  /**
   * Arrow steps while a RESIZE grab is live: the arrows size the ghost.
   *
   * Left/Right stay SCREEN directions (the same nudge convention as `nudge`):
   * the width is driven at the item's logical END edge, which sits on the
   * physical LEFT under RTL, so there screen-left grows and screen-right
   * shrinks — the on-screen moving edge always follows the arrow. The rect
   * math is the pointer's own `resizeRect`, driven at the logical end corner:
   * the start edges anchor, min/max clamp live, and a 1 px floor keeps a
   * shrink from collapsing the rect to nothing.
   */
  function resizeBy(grab: GrabState, arrow: { x: number; y: number }, ev: KeyLike): void {
    const item = rt.store.getItem(grab.id);
    if (!item || item.locked === true) return;
    const sign = rt.isRtl() ? -1 : 1;
    const step = ev.shiftKey === true ? NUDGE_COARSE_PX : NUDGE_PX;
    const next = resizeRect(grab.rect, 'se', arrow.x * sign * step, arrow.y * step, {
      minW: Math.max(1, item.minW ?? 1),
      minH: Math.max(1, item.minH ?? 1),
      maxW: item.maxW,
      maxH: item.maxH,
    });
    grab.rect = next;
    rt.setInteraction({ phase: 'kb-grab', id: grab.id, rect: next });
    // Size status, not a transition: polite, like `moved` during a move grab.
    rt.announce('resized', grab.id, next);
  }

  function cancelGrab(): void {
    const grab = machine.grab();
    if (!grab) return;
    machine.setGrab(null);
    rt.idle();
    // Nothing was ever committed, so cancelling is simply forgetting the ghost.
    rt.announce('canceled', grab.id, grab.startRect);
  }

  /* ---------------- structural ---------------- */

  function remove(id: string): void {
    const item = rt.store.getItem(id);
    if (!item || item.locked === true) return;
    if (machine.grab()?.id === id) {
      machine.setGrab(null);
      rt.idle();
    }
    // Removing the armed item disarms its placement, so the transient channel
    // does not keep reporting `placing` for an id that no longer exists.
    // Silent — `removed` is the announcement that describes what happened.
    if (machine.placing() === id) hooks.cancelPlace(true);
    // Announced before the commit: afterwards the item has no z position to
    // report, and "3 of 7" is the position it was removed FROM.
    rt.announce('removed', id);
    rt.store.removeItem(id, { source: 'keyboard' });
  }

  function reorder(id: string, side: 'front' | 'back'): void {
    const result = side === 'front' ? rt.store.bringToFront(id) : rt.store.sendToBack(id);
    if (result.status !== 'applied') return;
    rt.announce('reordered', id, undefined, side);
  }

  /* ---------------- focus ---------------- */

  function onFocusOut(evt: Event): void {
    const grab = machine.grab();
    const placing = machine.placing();
    if (!grab && placing === null) return;
    const container = rt.container();
    if (!container) return;
    const next = (evt as unknown as FocusLike).relatedTarget;
    // Focus left the dashboard entirely: a ghost nobody can see or move is
    // worse than a cancel. The same goes for an armed placement — its Escape
    // lives on the container's keydown listener, so once focus is outside
    // there is no way back out, and the next press inside the container would
    // teleport the item.
    if (next !== null && next !== undefined && contains(container, next)) return;
    cancelGrab();
    if (placing !== null) hooks.cancelPlace();
  }

  return {
    attach(container) {
      container.addEventListener('keydown', onKeyDown as EventListener);
      container.addEventListener('focusout', onFocusOut as EventListener);
      return () => {
        container.removeEventListener('keydown', onKeyDown as EventListener);
        container.removeEventListener('focusout', onFocusOut as EventListener);
        cancelGrab();
      };
    },
    cancelGrab,
  };
}
