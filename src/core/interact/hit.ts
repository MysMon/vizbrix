/**
 * Hit testing and DOM target resolution.
 *
 * Two deliberately separate jobs:
 *
 * - **Geometric hit testing** (`hitTest`, `itemsIntersecting`) runs against the
 *   store's resolved rects, never `document.elementFromPoint`. Element
 *   hit-testing forces layout, is defeated by overlays and pointer-events, and
 *   would put a measurement on the per-frame path — the marquee and the
 *   keyboard sensor need "which items are under this box" answered from numbers
 *   we already have.
 * - **Event target resolution** (`resolvePointerTarget`) walks
 *   `event.composedPath()` — not `event.target` — so a pointerdown inside a
 *   consumer's shadow root still resolves to the item that contains it. The walk
 *   stops at the container, and the data attributes it reads are the contract
 *   the React adapter renders against:
 *
 *   | attribute              | meaning                                        |
 *   |------------------------|------------------------------------------------|
 *   | `data-vzb="<id>"`      | container root; the background starts a marquee |
 *   | `data-vzb-item="<id>"` | item root, raw (unescaped) item id              |
 *   | `data-vzb-handle="se"` | resize handle, rendered only while selected     |
 *   | `data-vzb-drag-handle` | scopes pointer drags to a sub-element           |
 *   | `data-vzb-move`        | tap-to-place affordance rendered inside the item |
 */

import type { HandleId, Rect, VizbrixStore } from '../schema/types';
import { ALL_HANDLES, rectContains, rectsIntersect } from './machine';

/* ------------------------------------------------------------------ */
/* geometric hit testing                                               */
/* ------------------------------------------------------------------ */

function visibleRect<TData>(store: VizbrixStore<TData>, id: string): Rect | null {
  const view = store.getItemView(id);
  if (!view) return null;
  if (view.item.hidden === true) return null;
  return view.rect;
}

/**
 * Every item whose rect contains the point, topmost first.
 *
 * `store.getOrder()` is z-ascending, so the reverse of it is paint order from
 * the top down.
 */
export function hitTestAll<TData>(
  store: VizbrixStore<TData>,
  x: number,
  y: number,
): string[] {
  const order = store.getOrder();
  const out: string[] = [];
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!;
    const rect = visibleRect(store, id);
    if (rect && rectContains(rect, x, y)) out.push(id);
  }
  return out;
}

/** The topmost item at a container-logical point, or null for the background. */
export function hitTest<TData>(store: VizbrixStore<TData>, x: number, y: number): string | null {
  const order = store.getOrder();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!;
    const rect = visibleRect(store, id);
    if (rect && rectContains(rect, x, y)) return id;
  }
  return null;
}

/**
 * Items intersecting a box, in z-ascending order — the marquee's selection set.
 * Intersection (not containment) is the rule: brushing an item selects it.
 */
export function itemsIntersecting<TData>(store: VizbrixStore<TData>, box: Rect): string[] {
  const out: string[] = [];
  for (const id of store.getOrder()) {
    const rect = visibleRect(store, id);
    if (rect && rectsIntersect(rect, box)) out.push(id);
  }
  return out;
}

/** Same, but against rects frozen in a gesture snapshot (zero re-resolution). */
export function idsIntersecting(
  rects: ReadonlyMap<string, Rect>,
  order: readonly string[],
  box: Rect,
): string[] {
  const out: string[] = [];
  for (const id of order) {
    const rect = rects.get(id);
    if (rect && rectsIntersect(rect, box)) out.push(id);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* DOM target resolution                                               */
/* ------------------------------------------------------------------ */

export type TargetKind = 'handle' | 'item' | 'background' | 'outside';

export interface PointerTarget {
  kind: TargetKind;
  /** Raw item id from `data-vzb-item`, or null for background/outside. */
  id: string | null;
  handle: HandleId | null;
  /** The item declares a drag handle somewhere in its subtree. */
  hasDragHandle: boolean;
  /** The event passed through that drag handle. */
  viaDragHandle: boolean;
  element: ElementLike | null;
}

/**
 * The slice of `Element` this module needs. Structural typing keeps the sensor
 * testable against hand-built event objects and avoids assuming a global
 * `Element` constructor exists.
 */
export interface ElementLike {
  getAttribute(name: string): string | null;
  querySelector?(selectors: string): unknown;
}

function asElement(node: unknown): ElementLike | null {
  if (!node || typeof node !== 'object') return null;
  const el = node as ElementLike;
  return typeof el.getAttribute === 'function' ? el : null;
}

function isHandleId(value: string | null): value is HandleId {
  return value !== null && (ALL_HANDLES as readonly string[]).includes(value);
}

const NO_TARGET: PointerTarget = {
  kind: 'outside',
  id: null,
  handle: null,
  hasDragHandle: false,
  viaDragHandle: false,
  element: null,
};

/**
 * Resolve a composed event path into the thing the gesture is about.
 *
 * Precedence is handle > drag-handle/item > container background, and the walk
 * stops at `container`: an event that never passes through the container is
 * `outside` and is ignored, which is what keeps a portalled dropdown from
 * starting a drag.
 */
export function resolvePointerTarget(
  path: readonly unknown[],
  container: unknown,
): PointerTarget {
  let handle: HandleId | null = null;
  let viaDragHandle = false;
  let id: string | null = null;
  let element: ElementLike | null = null;

  for (const node of path) {
    if (node === container) {
      if (id !== null) break;
      return {
        kind: 'background',
        id: null,
        handle: null,
        hasDragHandle: false,
        viaDragHandle: false,
        element: asElement(node),
      };
    }
    if (id !== null) continue;
    const el = asElement(node);
    if (!el) continue;
    if (handle === null) {
      const h = el.getAttribute('data-vzb-handle');
      if (isHandleId(h)) handle = h;
    }
    if (!viaDragHandle && el.getAttribute('data-vzb-drag-handle') !== null) viaDragHandle = true;
    const item = el.getAttribute('data-vzb-item');
    if (item !== null) {
      id = item;
      element = el;
    }
  }

  if (id === null) return NO_TARGET;

  const hasDragHandle =
    typeof element?.querySelector === 'function'
      ? element.querySelector('[data-vzb-drag-handle]') != null
      : false;

  return {
    kind: handle !== null ? 'handle' : 'item',
    id,
    handle,
    hasDragHandle,
    viaDragHandle,
    element,
  };
}

/**
 * The item id whose tap-to-place move button (`data-vzb-move`) the event
 * ORIGINATED on, or null when it did not pass through one before its item
 * root. An item merely containing a move button elsewhere does not count —
 * only a press that started on the button itself is the button's own toggle.
 */
export function moveButtonItemId(path: readonly unknown[], container: unknown): string | null {
  let viaMoveButton = false;
  for (const node of path) {
    if (node === container) return null;
    const el = asElement(node);
    if (!el) continue;
    if (!viaMoveButton && el.getAttribute('data-vzb-move') !== null) viaMoveButton = true;
    const id = el.getAttribute('data-vzb-item');
    if (id !== null) return viaMoveButton ? id : null;
  }
  return null;
}

/** The item id owning an event, for the keyboard sensor. */
export function itemIdFromPath(path: readonly unknown[], container: unknown): string | null {
  for (const node of path) {
    if (node === container) return null;
    const el = asElement(node);
    if (!el) continue;
    const id = el.getAttribute('data-vzb-item');
    if (id !== null) return id;
  }
  return null;
}
