// @vitest-environment jsdom
/**
 * Pointer sensor, hit testing and tap-to-place.
 *
 * jsdom has no pointer capture and no layout, so the harness below supplies
 * both: a minimal capture polyfill, a stubbed container box (the ONE
 * measurement the controller makes), a synchronous `requestAnimationFrame` so
 * every frame is deterministic, and PointerEvent-shaped plain `Event`s.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AxisPlacement,
  LayoutDoc,
  LayoutItem,
  LayoutItemBase,
  Rect,
  VizbrixStore,
} from '../schema/types';
import { createStore } from '../store/store';
import { createInteractionController } from './controller';
import type { InteractionController, InteractionOptions } from './controller';
import { hitTest, hitTestAll, itemsIntersecting, resolvePointerTarget } from './hit';
import { resizeRect } from './machine';

/* ------------------------------------------------------------------ */
/* environment                                                         */
/* ------------------------------------------------------------------ */

const captures = new Map<Element, number>();

function installEnvironment(): void {
  captures.clear();
  Element.prototype.setPointerCapture = function setPointerCapture(id: number) {
    captures.set(this, id);
  };
  Element.prototype.hasPointerCapture = function hasPointerCapture(id: number) {
    return captures.get(this) === id;
  };
  Element.prototype.releasePointerCapture = function releasePointerCapture(id: number) {
    if (captures.get(this) === id) captures.delete(this);
  };
  // Deterministic frames: the controller's rAF resolves through globalThis.
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;
}

interface PointerInit {
  clientX?: number;
  clientY?: number;
  pointerId?: number;
  pointerType?: string;
  button?: number;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

function pointerEvent(type: string, init: PointerInit = {}): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true, composed: true });
  return Object.assign(ev, {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    clientX: 0,
    clientY: 0,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    isPrimary: true,
    ...init,
  });
}

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

const at = (offset: number, size: number): AxisPlacement => ({ mode: 'start', offset, size });

function item(
  id: string,
  z: string,
  rect: Rect,
  extra: Partial<LayoutItemBase> = {},
): LayoutItem {
  return { id, z, x: at(rect.x, rect.w), y: at(rect.y, rect.h), ...extra };
}

function makeDoc(items: LayoutItem[], direction: 'ltr' | 'rtl' = 'ltr'): LayoutDoc {
  return {
    version: 1,
    container: { base: { width: 1000, height: 600 }, height: 'fill', direction },
    items,
  };
}

const A = { x: 100, y: 100, w: 200, h: 150 };
const B = { x: 500, y: 100, w: 200, h: 150 };

function twoItems(direction: 'ltr' | 'rtl' = 'ltr'): LayoutDoc {
  return makeDoc([item('a', 'a0', A), item('b', 'b0', B)], direction);
}

interface Harness {
  store: VizbrixStore;
  container: HTMLElement;
  nodes: Map<string, HTMLElement>;
  handles: Map<string, HTMLElement>;
  controller: InteractionController;
  announcements: Array<{ message: string; tone: string }>;
  detach: () => void;
}

function setup(doc: LayoutDoc, opts: InteractionOptions = {}): Harness {
  const store = createStore(doc, { mode: 'edit' });
  store.setContainerSize(1000, 600);

  const container = document.createElement('div');
  container.setAttribute('data-vzb', 'test');
  container.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(container);

  const nodes = new Map<string, HTMLElement>();
  const handles = new Map<string, HTMLElement>();
  for (const id of store.getOrder()) {
    const el = document.createElement('div');
    el.setAttribute('data-vzb-item', id);
    const handle = document.createElement('span');
    handle.setAttribute('data-vzb-handle', 'se');
    el.appendChild(handle);
    container.appendChild(el);
    store.registerNode(id, el);
    nodes.set(id, el);
    handles.set(id, handle);
  }

  const announcements: Array<{ message: string; tone: string }> = [];
  const controller = createInteractionController(store, {
    snap: false,
    onAnnounce: (message, tone) => announcements.push({ message, tone }),
    ...opts,
  });
  const detach = controller.attach(container);
  return { store, container, nodes, handles, controller, announcements, detach };
}

function down(target: EventTarget, x: number, y: number, init: PointerInit = {}): void {
  target.dispatchEvent(pointerEvent('pointerdown', { clientX: x, clientY: y, ...init }));
}

function move(x: number, y: number, init: PointerInit = {}): void {
  document.dispatchEvent(pointerEvent('pointermove', { clientX: x, clientY: y, ...init }));
}

function up(x: number, y: number, init: PointerInit = {}): void {
  document.dispatchEvent(pointerEvent('pointerup', { clientX: x, clientY: y, ...init }));
}

function rectOf(h: Harness, id: string): Rect {
  return h.store.getItemView(id)!.rect;
}

beforeEach(() => {
  installEnvironment();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* drag                                                                */
/* ------------------------------------------------------------------ */

describe('pointer drag', () => {
  it('press → move → release commits one transaction and moves only the dragged item', () => {
    const h = setup(twoItems());
    const a = h.nodes.get('a')!;

    down(a, 150, 150);
    move(190, 180);

    expect(h.store.getInteraction().phase).toBe('dragging');
    expect(a.style.transform).toBe('translate(40px, 30px)');
    // The whole product claim: a sibling is never written to during a drag.
    expect(h.nodes.get('b')!.style.transform).toBe('');

    up(190, 180);

    expect(a.style.transform).toBe('');
    expect(rectOf(h, 'a')).toEqual({ x: 140, y: 130, w: 200, h: 150 });
    expect(rectOf(h, 'b')).toEqual(B);
    expect(h.store.getInteraction().phase).toBe('idle');

    h.store.undo();
    expect(rectOf(h, 'a')).toEqual(A);
    expect(h.store.canUndo()).toBe(false);
  });

  it('does not activate below the 3px threshold — the press is a click', () => {
    const h = setup(twoItems());
    const a = h.nodes.get('a')!;

    down(a, 150, 150);
    move(151, 151);
    expect(h.store.getInteraction().phase).toBe('idle');
    expect(a.style.transform).toBe('');

    up(151, 151);
    expect(rectOf(h, 'a')).toEqual(A);
    expect(h.store.canUndo()).toBe(false);
    expect(h.store.getSelection()).toEqual(['a']);
  });

  it('activates at exactly 3px', () => {
    const h = setup(twoItems());
    down(h.nodes.get('a')!, 150, 150);
    move(153, 150);
    expect(h.store.getInteraction().phase).toBe('dragging');
    up(153, 150);
    expect(rectOf(h, 'a').x).toBe(103);
  });

  it('Escape reverts the transform and commits nothing', () => {
    const h = setup(twoItems());
    const a = h.nodes.get('a')!;

    down(a, 150, 150);
    move(250, 150);
    expect(a.style.transform).toBe('translate(100px, 0px)');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(a.style.transform).toBe('');
    expect(rectOf(h, 'a')).toEqual(A);
    expect(h.store.canUndo()).toBe(false);
    expect(h.store.getInteraction().phase).toBe('idle');

    // The gesture is over: further movement does nothing.
    move(400, 150);
    expect(a.style.transform).toBe('');
  });

  it('pointercancel reverts', () => {
    const h = setup(twoItems());
    const a = h.nodes.get('a')!;
    down(a, 150, 150);
    move(250, 150);
    document.dispatchEvent(pointerEvent('pointercancel', { clientX: 250, clientY: 150 }));
    expect(a.style.transform).toBe('');
    expect(rectOf(h, 'a')).toEqual(A);
  });

  it('a drop at the origin records nothing', () => {
    const h = setup(twoItems());
    down(h.nodes.get('a')!, 150, 150);
    move(190, 150);
    move(150, 150);
    up(150, 150);
    expect(h.store.canUndo()).toBe(false);
    expect(rectOf(h, 'a')).toEqual(A);
  });

  it('Shift locks the drag to the axis with the larger travel', () => {
    const h = setup(twoItems());
    down(h.nodes.get('a')!, 150, 150);
    move(200, 170, { shiftKey: true });
    up(200, 170, { shiftKey: true });
    expect(rectOf(h, 'a')).toEqual({ x: 150, y: 100, w: 200, h: 150 });
  });

  it('a multi-select drag is ONE undo step', () => {
    const h = setup(twoItems());
    h.store.setSelection(['a', 'b']);

    down(h.nodes.get('a')!, 150, 150);
    move(190, 150);

    expect(h.nodes.get('a')!.style.transform).toBe('translate(40px, 0px)');
    expect(h.nodes.get('b')!.style.transform).toBe('translate(40px, 0px)');

    up(190, 150);
    expect(rectOf(h, 'a').x).toBe(140);
    expect(rectOf(h, 'b').x).toBe(540);

    h.store.undo();
    expect(rectOf(h, 'a').x).toBe(100);
    expect(rectOf(h, 'b').x).toBe(500);
    expect(h.store.canUndo()).toBe(false);
  });

  it('dragging an unselected item replaces the selection', () => {
    const h = setup(twoItems());
    h.store.setSelection(['b']);
    down(h.nodes.get('a')!, 150, 150);
    move(190, 150);
    expect(h.store.getSelection()).toEqual(['a']);
    up(190, 150);
    expect(rectOf(h, 'b')).toEqual(B);
  });

  it('a locked item selects but never moves', () => {
    const h = setup(makeDoc([item('a', 'a0', A, { locked: true })]));
    down(h.nodes.get('a')!, 150, 150);
    move(250, 200);
    expect(h.store.getInteraction().phase).toBe('idle');
    up(250, 200);
    expect(rectOf(h, 'a')).toEqual(A);
    expect(h.store.getSelection()).toEqual(['a']);
  });

  it('ignores non-primary buttons and view mode', () => {
    const h = setup(twoItems());
    down(h.nodes.get('a')!, 150, 150, { button: 2 });
    move(250, 150);
    expect(h.store.getInteraction().phase).toBe('idle');

    h.store.setMode('view');
    down(h.nodes.get('a')!, 150, 150);
    move(250, 150);
    expect(h.store.getInteraction().phase).toBe('idle');
    expect(rectOf(h, 'a')).toEqual(A);
  });
});

/* ------------------------------------------------------------------ */
/* drag handle scoping                                                 */
/* ------------------------------------------------------------------ */

describe('drag handle scoping', () => {
  function withDragHandle(): { h: Harness; grip: HTMLElement } {
    const h = setup(makeDoc([item('a', 'a0', A)]));
    const grip = document.createElement('span');
    grip.setAttribute('data-vzb-drag-handle', '');
    h.nodes.get('a')!.appendChild(grip);
    return { h, grip };
  }

  it('a press outside the declared drag handle only selects', () => {
    const { h } = withDragHandle();
    down(h.nodes.get('a')!, 150, 150);
    move(250, 150);
    expect(h.store.getInteraction().phase).toBe('idle');
    up(250, 150);
    expect(rectOf(h, 'a')).toEqual(A);
    expect(h.store.getSelection()).toEqual(['a']);
  });

  it('a press through the drag handle drags', () => {
    const { h, grip } = withDragHandle();
    down(grip, 150, 150);
    move(250, 150);
    expect(h.store.getInteraction().phase).toBe('dragging');
    up(250, 150);
    expect(rectOf(h, 'a').x).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/* collision                                                           */
/* ------------------------------------------------------------------ */

describe('forbid collision policy', () => {
  it('the ghost tracks the pointer but the drop resolves to the last valid rect', () => {
    const h = setup(
      makeDoc([item('a', 'a0', A, { collision: 'forbid' }), item('b', 'b0', B)]),
    );
    const a = h.nodes.get('a')!;

    down(a, 150, 150);
    move(300, 150); // +150 → a spans 250..450, clear of b at 500
    const legal = h.store.getInteraction();
    expect(legal.phase === 'dragging' && legal.valid).toBe(true);

    move(500, 150); // +350 → a spans 450..650, overlapping b
    const illegal = h.store.getInteraction();
    expect(illegal.phase === 'dragging' && illegal.valid).toBe(false);
    // The ghost is NEVER pinned: it follows the pointer 1:1 even while invalid.
    expect(a.style.transform).toBe('translate(350px, 0px)');

    up(500, 150);
    expect(rectOf(h, 'a')).toEqual({ x: 250, y: 100, w: 200, h: 150 });
  });

  it('collisionWith scopes which items forbid an overlap', () => {
    const h = setup(
      makeDoc([
        item('a', 'a0', A, { collision: 'forbid', collisionWith: ['pinned'] }),
        item('b', 'b0', B, { tags: ['floating'] }),
      ]),
    );
    down(h.nodes.get('a')!, 150, 150);
    move(500, 150);
    const state = h.store.getInteraction();
    expect(state.phase === 'dragging' && state.valid).toBe(true);
    up(500, 150);
    expect(rectOf(h, 'a').x).toBe(450);
  });
});

/* ------------------------------------------------------------------ */
/* snapping                                                            */
/* ------------------------------------------------------------------ */

describe('snapping', () => {
  it('snaps a drag onto a sibling edge, and the bypass key drops it', () => {
    const snapped = setup(twoItems(), { snap: { bypassKey: 'meta' } });
    down(snapped.nodes.get('a')!, 150, 150);
    move(447, 150); // a.x = 397, three px short of b's left edge at 500 − 100
    up(447, 150);
    expect(rectOf(snapped, 'a').x).toBe(400);
    snapped.detach();

    const free = setup(twoItems(), { snap: { bypassKey: 'meta' } });
    down(free.nodes.get('a')!, 150, 150);
    move(447, 150, { metaKey: true });
    const state = free.store.getInteraction();
    expect(state.phase === 'dragging' && state.guides.length).toBe(0);
    up(447, 150, { metaKey: true });
    expect(rectOf(free, 'a').x).toBe(397);
  });

  it('the bypass modifier is read live, without a pointer move', () => {
    const h = setup(twoItems(), { snap: { bypassKey: 'meta' } });
    down(h.nodes.get('a')!, 150, 150);
    move(447, 150);
    expect(h.nodes.get('a')!.style.transform).toBe('translate(300px, 0px)');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }));
    expect(h.nodes.get('a')!.style.transform).toBe('translate(297px, 0px)');
  });
});

/* ------------------------------------------------------------------ */
/* resize                                                              */
/* ------------------------------------------------------------------ */

describe('resize', () => {
  it('the moved edge follows the pointer, the opposite edge stays put, limits clamp live', () => {
    const h = setup(makeDoc([item('a', 'a0', A, { maxW: 260, minH: 120 })]));
    down(h.handles.get('a')!, 300, 250);
    move(400, 300); // +100, +50 → w would be 300, clamped to 260

    const state = h.store.getInteraction();
    expect(state.phase).toBe('resizing');
    expect(h.nodes.get('a')!.style.width).toBe('260px');

    up(400, 300);
    expect(rectOf(h, 'a')).toEqual({ x: 100, y: 100, w: 260, h: 200 });
    expect(h.nodes.get('a')!.style.width).toBe('');
  });

  it('a west handle moves the start edge and keeps the end edge fixed', () => {
    expect(resizeRect(A, 'w', -50, 0)).toEqual({ x: 50, y: 100, w: 250, h: 150 });
    // Clamping re-derives the position from the anchor, so hitting maxW pins
    // the east edge instead of dragging the whole item along.
    expect(resizeRect(A, 'w', -50, 0, { maxW: 220 })).toEqual({ x: 80, y: 100, w: 220, h: 150 });
    expect(resizeRect(A, 'e', -150, 0, { minW: 120 })).toEqual({ x: 100, y: 100, w: 120, h: 150 });
  });

  it('Alt resizes from the centre and Shift preserves the aspect ratio', () => {
    expect(resizeRect(A, 'e', 50, 0, { fromCenter: true })).toEqual({
      x: 50,
      y: 100,
      w: 300,
      h: 150,
    });
    // 200x150 → 300 wide keeps 4:3, so height follows to 225.
    expect(resizeRect(A, 'se', 100, 10, { aspect: true })).toEqual({
      x: 100,
      y: 100,
      w: 300,
      h: 225,
    });
  });
});

/* ------------------------------------------------------------------ */
/* marquee                                                             */
/* ------------------------------------------------------------------ */

describe('marquee', () => {
  it('selects intersecting items from a background press', () => {
    const h = setup(twoItems());
    down(h.container, 50, 50);
    move(350, 300);

    const state = h.store.getInteraction();
    expect(state.phase).toBe('marquee');
    expect(state.phase === 'marquee' && state.rect).toEqual({ x: 50, y: 50, w: 300, h: 250 });
    expect(state.phase === 'marquee' && state.pending).toEqual(['a']);

    up(350, 300);
    expect(h.store.getSelection()).toEqual(['a']);
    expect(h.store.getInteraction().phase).toBe('idle');
  });

  it('Shift makes the marquee additive', () => {
    const h = setup(twoItems());
    h.store.setSelection(['a']);
    down(h.container, 450, 50, { shiftKey: true });
    move(900, 300, { shiftKey: true });
    up(900, 300, { shiftKey: true });
    expect(h.store.getSelection()).toEqual(['a', 'b']);
  });

  it('a background click clears the selection', () => {
    const h = setup(twoItems());
    h.store.setSelection(['a', 'b']);
    down(h.container, 50, 50);
    up(51, 51);
    expect(h.store.getSelection()).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* RTL + scale                                                         */
/* ------------------------------------------------------------------ */

describe('direction and scale', () => {
  it('negates pointer x deltas under RTL and mirrors the transform back', () => {
    const h = setup(twoItems('rtl'));
    const a = h.nodes.get('a')!;

    down(a, 500, 150);
    move(560, 150); // 60px to the physical right = 60px toward the logical start

    // The transform is physical, so it still points right.
    expect(a.style.transform).toBe('translate(60px, 0px)');
    up(560, 150);
    expect(rectOf(h, 'a')).toEqual({ x: 40, y: 100, w: 200, h: 150 });
  });

  it('divides pointer deltas by the canvas scale', () => {
    const doc = twoItems();
    doc.container.responsive = 'scale';
    const h = setup(doc);
    // The stub reports 1000px wide against a 1000px design width, so scale is 1
    // and the design coordinates are unchanged; halve the box to double it.
    h.container.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 500,
        bottom: 300,
        width: 500,
        height: 300,
        toJSON: () => ({}),
      }) as DOMRect;

    down(h.nodes.get('a')!, 100, 100);
    move(200, 100); // 100 screen px at scale 0.5 = 200 design px
    up(200, 100);
    expect(rectOf(h, 'a').x).toBe(300);
  });
});

/* ------------------------------------------------------------------ */
/* touch                                                               */
/* ------------------------------------------------------------------ */

describe('touch activation', () => {
  it('activates on a long press and then drags', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = setup(twoItems());
    down(h.nodes.get('a')!, 150, 150, { pointerType: 'touch' });
    move(152, 150, { pointerType: 'touch' });
    expect(h.store.getInteraction().phase).toBe('idle');

    vi.advanceTimersByTime(450);
    expect(h.store.getInteraction().phase).toBe('dragging');

    move(190, 150, { pointerType: 'touch' });
    up(190, 150, { pointerType: 'touch' });
    expect(rectOf(h, 'a').x).toBe(140);
  });

  it('abandons the gesture when the finger moves past the slop first', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = setup(twoItems());
    down(h.nodes.get('a')!, 150, 150, { pointerType: 'touch' });
    move(170, 150, { pointerType: 'touch' });

    vi.advanceTimersByTime(600);
    expect(h.store.getInteraction().phase).toBe('idle');

    move(250, 150, { pointerType: 'touch' });
    up(250, 150, { pointerType: 'touch' });
    expect(rectOf(h, 'a')).toEqual(A);
  });

  it("longPress:'off' drops touch to the 3px threshold", () => {
    const h = setup(twoItems(), { longPress: 'off' });
    down(h.nodes.get('a')!, 150, 150, { pointerType: 'touch' });
    move(190, 150, { pointerType: 'touch' });
    expect(h.store.getInteraction().phase).toBe('dragging');
    up(190, 150, { pointerType: 'touch' });
    expect(rectOf(h, 'a').x).toBe(140);
  });
});

/* ------------------------------------------------------------------ */
/* tap-to-place                                                        */
/* ------------------------------------------------------------------ */

describe('tap-to-place (SC 2.5.7)', () => {
  it('lands the item top-left at the point and announces both ends', () => {
    const h = setup(twoItems());
    h.controller.beginPlace('a');

    expect(h.store.getInteraction()).toEqual({ phase: 'placing', id: 'a' });
    expect(h.announcements[0]).toEqual({ message: 'Placing a. Choose a position in the dashboard.', tone: 'assertive' });

    h.controller.completePlace({ x: 300, y: 200 });
    expect(rectOf(h, 'a')).toEqual({ x: 300, y: 200, w: 200, h: 150 });
    expect(h.store.getInteraction().phase).toBe('idle');
    expect(h.announcements[1]).toEqual({ message: 'a placed at 300, 200.', tone: 'assertive' });
  });

  it('clamps the landing rect into the container', () => {
    const h = setup(twoItems());
    h.controller.beginPlace('a');
    h.controller.completePlace({ x: 5000, y: 5000 });
    expect(rectOf(h, 'a')).toEqual({ x: 800, y: 450, w: 200, h: 150 });
  });

  it('a press inside the container completes the placement', () => {
    const h = setup(twoItems());
    h.controller.beginPlace('a');
    down(h.container, 300, 200);
    expect(rectOf(h, 'a')).toEqual({ x: 300, y: 200, w: 200, h: 150 });
    expect(h.store.getInteraction().phase).toBe('idle');
  });

  it('cancelPlace commits nothing', () => {
    const h = setup(twoItems());
    h.controller.beginPlace('a');
    h.controller.cancelPlace();
    expect(h.store.getInteraction().phase).toBe('idle');
    expect(rectOf(h, 'a')).toEqual(A);
    expect(h.store.canUndo()).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* hit testing                                                         */
/* ------------------------------------------------------------------ */

describe('hit testing', () => {
  it('returns the topmost item by z, and null over the background', () => {
    const store = createStore(
      makeDoc([item('under', 'a0', A), item('over', 'b0', { x: 150, y: 150, w: 200, h: 150 })]),
      { mode: 'edit' },
    );
    expect(hitTest(store, 120, 120)).toBe('under');
    expect(hitTest(store, 200, 200)).toBe('over');
    expect(hitTestAll(store, 200, 200)).toEqual(['over', 'under']);
    expect(hitTest(store, 900, 500)).toBeNull();
  });

  it('skips hidden items and intersects for the marquee', () => {
    const store = createStore(
      makeDoc([item('a', 'a0', A), item('b', 'b0', B, { hidden: true })]),
      { mode: 'edit' },
    );
    expect(hitTest(store, 550, 150)).toBeNull();
    expect(itemsIntersecting(store, { x: 0, y: 0, w: 1000, h: 600 })).toEqual(['a']);
    // Touching edges are not an intersection.
    expect(itemsIntersecting(store, { x: 0, y: 0, w: 100, h: 600 })).toEqual([]);
  });

  it('resolves composed paths by attribute precedence', () => {
    const container = document.createElement('div');
    const el = document.createElement('div');
    el.setAttribute('data-vzb-item', 'a');
    const grip = document.createElement('span');
    grip.setAttribute('data-vzb-drag-handle', '');
    const handle = document.createElement('span');
    handle.setAttribute('data-vzb-handle', 'se');
    el.append(grip, handle);
    container.append(el);

    expect(resolvePointerTarget([handle, el, container], container)).toMatchObject({
      kind: 'handle',
      id: 'a',
      handle: 'se',
    });
    expect(resolvePointerTarget([grip, el, container], container)).toMatchObject({
      kind: 'item',
      id: 'a',
      viaDragHandle: true,
      hasDragHandle: true,
    });
    expect(resolvePointerTarget([container], container)).toMatchObject({ kind: 'background' });
    expect(resolvePointerTarget([document.createElement('div')], container)).toMatchObject({
      kind: 'outside',
    });
  });
});

/* ------------------------------------------------------------------ */
/* lifecycle                                                           */
/* ------------------------------------------------------------------ */

describe('lifecycle', () => {
  it('detach stops listening and aborts an in-flight gesture', () => {
    const h = setup(twoItems());
    const a = h.nodes.get('a')!;
    down(a, 150, 150);
    move(250, 150);
    h.detach();
    expect(a.style.transform).toBe('');
    expect(rectOf(h, 'a')).toEqual(A);

    down(a, 150, 150);
    move(250, 150);
    expect(h.store.getInteraction().phase).toBe('idle');
  });

  it('destroy is idempotent and clears the transient channel', () => {
    const h = setup(twoItems());
    down(h.nodes.get('a')!, 150, 150);
    move(250, 150);
    h.controller.destroy();
    h.controller.destroy();
    expect(h.store.getInteraction().phase).toBe('idle');
  });
});
