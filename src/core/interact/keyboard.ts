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
 * | Escape                 | cancel a grab, reverting to where it was picked up  |
 * | Delete / Backspace     | remove                                             |
 * | Cmd/Ctrl + ] / [       | bring to front / send to back                      |
 * | Cmd/Ctrl + Z / ⇧Z      | undo / redo                                        |
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
import type { InteractRuntime } from './machine';
import { NUDGE_COARSE_PX, NUDGE_PX, snapJumpDelta, translated } from './machine';
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

export function createKeyboardSensor<TData>(rt: InteractRuntime<TData>): KeyboardSensor {
  const machine = rt.machine;

  function onKeyDown(evt: Event): void {
    const ev = evt as unknown as KeyLike;
    if (!rt.isEdit()) return;
    const container = rt.container();
    if (!container) return;

    const mod = ev.metaKey === true || ev.ctrlKey === true;
    if (mod && (ev.key === 'z' || ev.key === 'Z')) {
      ev.preventDefault?.();
      if (ev.shiftKey === true) rt.store.redo();
      else rt.store.undo();
      return;
    }

    // A grab owns the keyboard until it ends, wherever focus drifted to.
    const grab = machine.grab();
    const id = grab?.id ?? itemIdFromPath(pathOf(ev), container);
    if (id === null || id === undefined) return;
    if (rt.store.getItem(id) === undefined) return;

    const arrow = ARROWS[ev.key];
    if (arrow) {
      ev.preventDefault?.();
      nudge(id, arrow, ev);
      return;
    }

    switch (ev.key) {
      case 'Enter':
      case ' ':
      case 'Spacebar':
        ev.preventDefault?.();
        if (grab) drop();
        else beginGrab(id);
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
    if (result.status === 'applied') rt.announce('moved', id);
  }

  /* ---------------- grab session ---------------- */

  function beginGrab(id: string): void {
    if (machine.busy()) return;
    const item = rt.store.getItem(id);
    const rect = rt.store.getItemView(id)?.rect;
    if (!item || !rect || item.locked === true) return;
    machine.setGrab({
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
    machine.setGrab(null);
    rt.idle();
    // One grab session = ONE transaction, however many arrow presses it took.
    rt.commitRects(new Map<string, Rect>([[grab.id, grab.rect]]), 'move', 'keyboard');
    rt.announce('dropped', grab.id);
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
    if (!grab) return;
    const container = rt.container();
    if (!container) return;
    const next = (evt as unknown as FocusLike).relatedTarget;
    // Focus left the dashboard entirely: a ghost nobody can see or move is
    // worse than a cancel.
    if (next !== null && next !== undefined && contains(container, next)) return;
    cancelGrab();
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
