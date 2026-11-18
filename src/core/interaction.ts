import { frameFor, frameScale, fromPixels, pinIn, resolveVariant, toPixels, type Frame, type Variant } from './geometry';
import type { Messages } from './messages';
import { constrainRect } from './ops';
import { MOVE, snapRect, type Edges, type Guide, type SnapOptions } from './snap';
import type { DashboardStore } from './store';
import { DEFAULTS, type DashboardItem, type Pin, type Rect } from './types';

/**
 * The editing gestures, framework-free. One set of delegated listeners on the
 * canvas drives everything; while a gesture runs it writes styles straight to
 * the dragged elements and commits to the store once, on release. No
 * framework re-render happens per pointer move.
 *
 * DOM contract (what an adapter must render):
 *   canvas                         position: relative
 *     [data-vbx-item="<id>"]       direct children, focusable while editing
 *       [data-vbx-handle="se"]     resize handles (n s e w ne nw se sw)
 *       [data-vbx-nodrag]          regions that must stay clickable
 *     .vbx-guides                  empty layer the controller draws into
 */
export interface InteractionHost {
  /** Element that receives keyboard shortcuts (undo/redo), usually the dashboard root. */
  root: HTMLElement;
  canvas: HTMLElement;
  guides: HTMLElement;
  store: DashboardStore;
  snap(): SnapOptions;
  messages(): Messages;
  announce(text: string): void;
  /** Human name of a brick, for announcements. */
  nameOf(id: string): string;
}

interface Gesture {
  kind: 'move' | 'resize';
  handle: string;
  pointerId: number;
  startClient: { x: number; y: number };
  startCanvas: { x: number; y: number };
  last: { x: number; y: number; bypass: boolean };
  active: boolean;
  primary: string;
  ids: string[];
  variant: Variant;
  frame: Frame;
  start: Map<string, Rect>;
  pins: Map<string, Pin>;
  items: Map<string, DashboardItem<unknown>>;
  targets: Rect[];
  els: Map<string, HTMLElement>;
  result: Record<string, Rect>;
  raf: number;
  scroller: HTMLElement | null;
}

const DRAG_THRESHOLD = 3;

/** Copied bricks. Module-level so a copy in one dashboard can be pasted into another on the page. */
let clipboard: DashboardItem<unknown>[] = [];
const EDGE_SCROLL_ZONE = 48;

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

export function attachInteractions(host: InteractionHost): () => void {
  const { canvas, guides, store, root } = host;
  let gesture: Gesture | null = null;
  let suppressFocusSelect = false;

  const itemElement = (id: string): HTMLElement | null => {
    for (const child of canvas.children) {
      if (child instanceof HTMLElement && child.dataset.vbxItem === id) return child;
    }
    return null;
  };

  const scaleOf = (g: Gesture, id: string): number => (g.pins.get(id) === 'scale' ? frameScale(g.frame) : 1);

  // ---------------------------------------------------------------- pointer

  const onPointerDown = (event: PointerEvent): void => {
    const state = store.getState();
    if (!state.editing || event.button !== 0 || gesture) return;
    const target = event.target as Element;
    const itemEl = target.closest<HTMLElement>('[data-vbx-item]');
    if (!itemEl || itemEl.parentElement !== canvas) {
      if (target === canvas || target === guides) startMarquee(event);
      return;
    }
    const id = itemEl.dataset.vbxItem!;
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const selected = state.selection.includes(id);

    if (target.closest('[data-vbx-nodrag]')) {
      if (!selected) store.select([id]);
      return;
    }

    // We manage focus ourselves so the press never starts a text selection.
    event.preventDefault();
    suppressFocusSelect = true;
    itemEl.focus({ preventScroll: true });
    suppressFocusSelect = false;

    if (additive) {
      store.select(selected ? state.selection.filter((s) => s !== id) : [...state.selection, id]);
      return;
    }
    if (!selected) store.select([id]);

    const item = state.doc.items.find((i) => i.id === id);
    if (!item || item.locked) return;
    const handle = target.closest<HTMLElement>('[data-vbx-handle]')?.dataset.vbxHandle ?? '';
    const box = canvas.getBoundingClientRect();
    gesture = {
      kind: handle ? 'resize' : 'move',
      handle,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startCanvas: { x: event.clientX - box.left, y: event.clientY - box.top },
      last: { x: event.clientX, y: event.clientY, bypass: false },
      active: false,
      primary: id,
      ids: [],
      variant: resolveVariant(state.doc, state.variant),
      frame: { d: 1, gap: 0, padding: 0, container: 1 },
      start: new Map(),
      pins: new Map(),
      items: new Map(),
      targets: [],
      els: new Map(),
      result: {},
      raf: 0,
      scroller: null,
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onGestureKey, true);
    window.addEventListener('blur', cancel);
  };

  // --------------------------------------------------------------- marquee

  /** Drag on empty canvas to select every brick the rectangle touches. */
  const startMarquee = (down: PointerEvent): void => {
    const base = down.shiftKey || down.metaKey || down.ctrlKey ? [...store.getState().selection] : [];
    const start = { x: down.clientX, y: down.clientY };
    let box: HTMLDivElement | null = null;

    const onMove = (event: PointerEvent): void => {
      if (!box) {
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD) return;
        box = document.createElement('div');
        box.className = 'vbx-marquee';
        guides.appendChild(box);
        canvas.setAttribute('data-vbx-gesture', 'select');
      }
      const origin = canvas.getBoundingClientRect();
      const x0 = Math.min(start.x, event.clientX);
      const y0 = Math.min(start.y, event.clientY);
      const x1 = Math.max(start.x, event.clientX);
      const y1 = Math.max(start.y, event.clientY);
      box.style.left = `${x0 - origin.left}px`;
      box.style.top = `${y0 - origin.top}px`;
      box.style.width = `${x1 - x0}px`;
      box.style.height = `${y1 - y0}px`;
      const hit: string[] = [];
      for (const child of canvas.children) {
        if (!(child instanceof HTMLElement) || !child.dataset.vbxItem) continue;
        const r = child.getBoundingClientRect();
        if (r.left < x1 && r.right > x0 && r.top < y1 && r.bottom > y0) hit.push(child.dataset.vbxItem);
      }
      store.select([...base, ...hit]);
    };
    const finish = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (box) {
        box.remove();
        canvas.removeAttribute('data-vbx-gesture');
        const count = store.getState().selection.length;
        if (count) host.announce(host.messages().selected(count));
      } else if (!base.length) {
        store.select([]);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const activate = (g: Gesture): void => {
    const state = store.getState();
    const doc = state.doc;
    const variant = resolveVariant(doc, state.variant);
    g.variant = variant;
    g.frame = frameFor(doc, variant, canvas.getBoundingClientRect().width);
    const moving = g.kind === 'move' ? state.selection : [g.primary];
    const movingSet = new Set(moving);
    for (const item of doc.items) {
      const rect = variant.rects.get(item.id);
      if (!rect) continue;
      const pin = pinIn(variant, item);
      if (movingSet.has(item.id) && !item.locked) {
        const el = itemElement(item.id);
        if (!el) continue;
        g.ids.push(item.id);
        g.start.set(item.id, rect);
        g.pins.set(item.id, pin);
        g.items.set(item.id, item);
        g.els.set(item.id, el);
        el.setAttribute('data-vbx-dragging', '');
      }
    }
    const primaryPin = g.pins.get(g.primary) ?? 'scale';
    for (const item of doc.items) {
      if (g.start.has(item.id)) continue;
      const rect = variant.rects.get(item.id);
      if (!rect) continue;
      const pin = pinIn(variant, item);
      // Siblings are expressed in the dragged brick's coordinate frame so
      // snapping compares like with like even across different pins.
      g.targets.push(pin === primaryPin ? rect : fromPixels(toPixels(rect, pin, g.frame), primaryPin, g.frame));
    }
    g.scroller = scrollParent(canvas);
    g.active = true;
    canvas.setAttribute('data-vbx-gesture', g.kind);
    try {
      canvas.setPointerCapture(g.pointerId);
    } catch {
      // Pointer may already be gone (synthetic events, tests).
    }
    schedule();
  };

  const onPointerMove = (event: PointerEvent): void => {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    g.last = { x: event.clientX, y: event.clientY, bypass: event.metaKey || event.ctrlKey };
    if (!g.active) {
      const dist = Math.hypot(event.clientX - g.startClient.x, event.clientY - g.startClient.y);
      if (dist < DRAG_THRESHOLD) return;
      activate(g);
      if (!g.start.has(g.primary)) cancel();
      return;
    }
    event.preventDefault();
    schedule();
  };

  const schedule = (): void => {
    if (gesture && !gesture.raf) gesture.raf = requestAnimationFrame(tick);
  };

  const edgeScroll = (g: Gesture): void => {
    const y = g.last.y;
    const top = g.scroller ? g.scroller.getBoundingClientRect().top : 0;
    const bottom = g.scroller ? g.scroller.getBoundingClientRect().bottom : window.innerHeight;
    let speed = 0;
    if (y < top + EDGE_SCROLL_ZONE) speed = -Math.ceil((top + EDGE_SCROLL_ZONE - y) / 4);
    else if (y > bottom - EDGE_SCROLL_ZONE) speed = Math.ceil((y - (bottom - EDGE_SCROLL_ZONE)) / 4);
    if (!speed) return;
    speed = Math.max(-24, Math.min(24, speed));
    if (g.scroller) g.scroller.scrollTop += speed;
    else window.scrollBy(0, speed);
  };

  const tick = (): void => {
    const g = gesture;
    if (!g || !g.active) return;
    g.raf = 0;
    edgeScroll(g);

    const box = canvas.getBoundingClientRect();
    const dxPx = g.last.x - box.left - g.startCanvas.x;
    const dyPx = g.last.y - box.top - g.startCanvas.y;
    const scale = scaleOf(g, g.primary);
    const s0 = g.start.get(g.primary)!;
    const item = g.items.get(g.primary)!;
    const pin = g.pins.get(g.primary)!;
    const options = host.snap();
    const snapBase = {
      targets: g.targets,
      width: g.variant.width,
      options,
      toleranceX: options.threshold / scale,
      toleranceY: options.threshold,
    };
    let guideList: Guide[] = [];

    if (g.kind === 'move') {
      let rect: Rect = { x: s0.x + dxPx / scale, y: s0.y + dyPx, w: s0.w, h: s0.h };
      if (!g.last.bypass) {
        const snapped = snapRect({ ...snapBase, rect, edges: MOVE, move: true });
        rect = snapped.rect;
        guideList = snapped.guides;
      }
      rect = constrainRect(rect, item, g.variant.width);
      const movePx = (rect.x - s0.x) * scale;
      const moveY = rect.y - s0.y;
      for (const id of g.ids) {
        const start = g.start.get(id)!;
        g.result[id] = constrainRect(
          { x: start.x + movePx / scaleOf(g, id), y: start.y + moveY, w: start.w, h: start.h },
          g.items.get(id)!,
          g.variant.width,
        );
        g.els.get(id)!.style.transform = `translate(${movePx}px, ${moveY}px)`;
      }
    } else {
      const h = g.handle;
      const edges: Edges = { left: h.includes('w'), right: h.includes('e'), top: h.includes('n'), bottom: h.includes('s') };
      const dx = dxPx / scale;
      let rect = { ...s0 };
      if (edges.right) rect.w = s0.w + dx;
      if (edges.left) {
        rect.x = s0.x + dx;
        rect.w = s0.w - dx;
      }
      if (edges.bottom) rect.h = s0.h + dyPx;
      if (edges.top) {
        rect.y = s0.y + dyPx;
        rect.h = s0.h - dyPx;
      }
      if (!g.last.bypass) {
        const snapped = snapRect({ ...snapBase, rect, edges, move: false });
        rect = snapped.rect;
        guideList = snapped.guides;
      }
      rect = clampResize(rect, s0, edges, item, g.variant.width);
      g.result[g.primary] = rect;
      const px = toPixels(rect, pin, g.frame);
      const style = g.els.get(g.primary)!.style;
      style.left = `${px.x}px`;
      style.top = `${px.y}px`;
      style.width = `${px.w}px`;
      style.height = `${px.h}px`;
    }

    let bottom = g.variant.height;
    for (const id of g.ids) bottom = Math.max(bottom, g.result[id]!.y + g.result[id]!.h);
    canvas.style.minHeight = `${bottom + 2 * g.frame.padding - g.frame.gap}px`;
    drawGuides(g, guideList, pin);
    // Keep ticking while the pointer rests in an edge-scroll zone.
    const scrollEdgeBottom = g.scroller ? g.scroller.getBoundingClientRect().bottom : window.innerHeight;
    const scrollEdgeTop = g.scroller ? g.scroller.getBoundingClientRect().top : 0;
    if (g.last.y < scrollEdgeTop + EDGE_SCROLL_ZONE || g.last.y > scrollEdgeBottom - EDGE_SCROLL_ZONE) schedule();
  };

  const drawGuides = (g: Gesture, list: Guide[], pin: Pin): void => {
    const { gap, padding } = g.frame;
    const edgePx = (pos: number): number => toPixels({ x: pos, y: 0, w: 0, h: 0 }, pin, g.frame).x - gap / 2;
    const yPx = (pos: number): number => padding - gap / 2 + pos;
    while (guides.children.length > list.length) guides.lastElementChild!.remove();
    list.forEach((guide, i) => {
      let el = guides.children[i] as HTMLElement | undefined;
      if (!el) {
        el = document.createElement('div');
        el.className = 'vbx-guide';
        guides.appendChild(el);
      }
      el.dataset.axis = guide.axis;
      if (guide.axis === 'x') {
        el.style.left = `${edgePx(guide.pos)}px`;
        el.style.top = `${yPx(guide.from)}px`;
        el.style.height = `${guide.to - guide.from}px`;
        el.style.width = '';
      } else {
        el.style.top = `${yPx(guide.pos)}px`;
        el.style.left = `${edgePx(guide.from)}px`;
        el.style.width = `${edgePx(guide.to) - edgePx(guide.from)}px`;
        el.style.height = '';
      }
    });
  };

  const teardown = (): void => {
    const g = gesture;
    if (!g) return;
    gesture = null;
    if (g.raf) cancelAnimationFrame(g.raf);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('keydown', onGestureKey, true);
    window.removeEventListener('blur', cancel);
    for (const el of g.els.values()) {
      el.removeAttribute('data-vbx-dragging');
      el.style.transform = '';
      el.style.left = '';
      el.style.top = '';
      el.style.width = '';
      el.style.height = '';
    }
    guides.replaceChildren();
    canvas.style.minHeight = '';
    canvas.removeAttribute('data-vbx-gesture');
    try {
      canvas.releasePointerCapture(g.pointerId);
    } catch {
      // not captured
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    if (!g.active) {
      // A plain click on one brick of a multi-selection narrows to it.
      if (store.getState().selection.length > 1) store.select([g.primary]);
      teardown();
      return;
    }
    g.last = { x: event.clientX, y: event.clientY, bypass: event.metaKey || event.ctrlKey };
    if (g.raf) cancelAnimationFrame(g.raf);
    g.raf = 0;
    tick();
    const result = g.result;
    const kind = g.kind;
    const primary = g.primary;
    // Commit before clearing the inline preview: the framework flushes the
    // new stylesheet synchronously, so there is no frame at the old position.
    store.setRects(result, kind);
    teardown();
    announceRect(primary, kind);
  };

  const cancel = (): void => {
    const wasActive = gesture?.active;
    teardown();
    if (wasActive) host.announce(host.messages().cancelled);
  };

  const onPointerCancel = (event: PointerEvent): void => {
    if (gesture && event.pointerId === gesture.pointerId) cancel();
  };

  const onGestureKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  };

  // --------------------------------------------------------------- keyboard

  const announceRect = (id: string, kind: 'move' | 'resize'): void => {
    const state = store.getState();
    const rect = resolveVariant(state.doc, state.variant).rects.get(id);
    if (!rect) return;
    const m = host.messages();
    host.announce(kind === 'move' ? m.moved(host.nameOf(id), rect.x, rect.y) : m.resized(host.nameOf(id), rect.w, rect.h));
  };

  const onFocusIn = (event: FocusEvent): void => {
    if (suppressFocusSelect || !store.getState().editing) return;
    const el = event.target;
    if (!(el instanceof HTMLElement) || el.parentElement !== canvas || !el.dataset.vbxItem) return;
    if (!store.getState().selection.includes(el.dataset.vbxItem)) store.select([el.dataset.vbxItem]);
  };

  const step = (value: number, dir: number, size: number): number =>
    dir > 0 ? Math.floor(value / size + 1e-9) * size + size : Math.ceil(value / size - 1e-9) * size - size;

  const onCanvasKey = (event: KeyboardEvent): void => {
    const state = store.getState();
    if (!state.editing || gesture?.active) return;
    const el = event.target;
    if (!(el instanceof HTMLElement) || el.parentElement !== canvas || !el.dataset.vbxItem) return;
    const id = el.dataset.vbxItem;
    const mod = event.metaKey || event.ctrlKey;
    const m = host.messages();

    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const arrow = arrows[event.key];
    if (arrow && !mod) {
      event.preventDefault();
      const variant = resolveVariant(state.doc, state.variant);
      const size = event.altKey ? 1 : host.snap().grid || 8;
      const [dx, dy] = arrow;
      const updates: Record<string, Rect> = {};
      const resize = event.shiftKey;
      const ids = resize ? [id] : state.selection.includes(id) ? state.selection : [id];
      for (const target of ids) {
        const item = state.doc.items.find((i) => i.id === target);
        const rect = variant.rects.get(target);
        if (!item || !rect || item.locked) continue;
        if (resize) {
          updates[target] = {
            ...rect,
            w: dx ? step(rect.x + rect.w, dx, size) - rect.x : rect.w,
            h: dy ? step(rect.y + rect.h, dy, size) - rect.y : rect.h,
          };
        } else {
          updates[target] = {
            ...rect,
            x: dx ? step(rect.x, dx, size) : rect.x,
            y: dy ? step(rect.y, dy, size) : rect.y,
          };
        }
      }
      const kind = resize ? 'resize' : 'move';
      store.setRects(updates, kind, `kbd:${kind}:${ids.join(',')}`);
      announceRect(id, kind);
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      const ids = state.selection.includes(id) ? state.selection : [id];
      const before = state.doc.items.length;
      // Move focus to a neighbour first so keyboard users are not dropped at the top of the page.
      const next = (el.nextElementSibling ?? el.previousElementSibling) as HTMLElement | null;
      store.remove(ids);
      const removed = before - store.getState().doc.items.length;
      if (removed) {
        host.announce(m.removed(removed));
        if (next?.dataset.vbxItem) next.focus();
      }
    } else if (mod && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      const created = store.duplicate(state.selection.includes(id) ? state.selection : [id]);
      if (created.length) {
        host.announce(m.duplicated(created.length));
        requestAnimationFrame(() => itemElement(created[created.length - 1]!)?.focus());
      }
    } else if (event.key === 'Escape') {
      store.select([]);
    } else if (event.key === ']') {
      store.reorder(id, 'front');
    } else if (event.key === '[') {
      store.reorder(id, 'back');
    }
  };

  const onRootKey = (event: KeyboardEvent): void => {
    if (!store.getState().editing || isTextInput(event.target)) return;
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const m = host.messages();
    const inCanvas = event.target instanceof Node && canvas.contains(event.target);
    if (key === 'c' && inCanvas) {
      // Leave the browser's own copy alone when the user has text selected.
      if (window.getSelection()?.toString()) return;
      const state = store.getState();
      const picked = state.doc.items.filter((item) => state.selection.includes(item.id));
      if (picked.length) clipboard = picked;
      return;
    }
    if (key === 'v' && inCanvas) {
      if (!clipboard.length) return;
      event.preventDefault();
      const ids = store.paste(clipboard);
      if (ids.length) {
        host.announce(m.pasted(ids.length));
        requestAnimationFrame(() => itemElement(ids[ids.length - 1]!)?.focus());
      }
      return;
    }
    if (key === 'a' && inCanvas) {
      event.preventDefault();
      store.select(store.getState().doc.items.map((item) => item.id));
      host.announce(m.selected(store.getState().selection.length));
      return;
    }
    if (key === 'z' && !event.shiftKey) {
      if (!store.getState().canUndo) return;
      event.preventDefault();
      store.undo();
      host.announce(m.undone);
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      if (!store.getState().canRedo) return;
      event.preventDefault();
      store.redo();
      host.announce(m.redone);
    }
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('focusin', onFocusIn);
  canvas.addEventListener('keydown', onCanvasKey);
  root.addEventListener('keydown', onRootKey);

  return () => {
    teardown();
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('focusin', onFocusIn);
    canvas.removeEventListener('keydown', onCanvasKey);
    root.removeEventListener('keydown', onRootKey);
  };
}

/** Keep a resized rect inside the canvas and above its minimum size, holding the opposite edge still. */
export function clampResize(
  rect: Rect,
  start: Rect,
  edges: Edges,
  item: { minW?: number; minH?: number },
  width: number,
): Rect {
  const minW = Math.min(item.minW ?? DEFAULTS.minW, width);
  const minH = item.minH ?? DEFAULTS.minH;
  let { x, y, w, h } = rect;
  if (edges.left) {
    const right = start.x + start.w;
    x = Math.round(Math.max(0, Math.min(x, right - minW)));
    w = right - x;
  } else if (edges.right) {
    w = Math.round(Math.max(minW, Math.min(w, width - x)));
  }
  if (edges.top) {
    const bottom = start.y + start.h;
    y = Math.round(Math.max(0, Math.min(y, bottom - minH)));
    h = bottom - y;
  } else if (edges.bottom) {
    h = Math.round(Math.max(minH, h));
  }
  return { x, y, w, h };
}
