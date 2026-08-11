// @vitest-environment jsdom
/**
 * The keyboard sensor: nudges, grab sessions, z-order, removal, history and the
 * announcements each transition produces (spec §10, §11).
 */

import { afterEach, describe, expect, it } from 'vitest';
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

/* ------------------------------------------------------------------ */
/* harness                                                             */
/* ------------------------------------------------------------------ */

const at = (offset: number, size: number): AxisPlacement => ({ mode: 'start', offset, size });

function item(id: string, z: string, rect: Rect, extra: Partial<LayoutItemBase> = {}): LayoutItem {
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

interface Harness {
  store: VizbrixStore;
  container: HTMLElement;
  nodes: Map<string, HTMLElement>;
  controller: InteractionController;
  announcements: Array<{ message: string; tone: string }>;
  detach: () => void;
}

function setup(doc: LayoutDoc = makeDoc([item('a', 'a0', A), item('b', 'b0', B)]), opts: InteractionOptions = {}): Harness {
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
  for (const id of store.getOrder()) {
    const el = document.createElement('div');
    el.setAttribute('data-vzb-item', id);
    el.tabIndex = 0;
    container.appendChild(el);
    store.registerNode(id, el);
    nodes.set(id, el);
  }

  const announcements: Array<{ message: string; tone: string }> = [];
  const controller = createInteractionController(store, {
    snap: false,
    getLabel: (i) => (i.id === 'a' ? 'Revenue chart' : i.id),
    onAnnounce: (message, tone) => announcements.push({ message, tone }),
    ...opts,
  });
  const detach = controller.attach(container);
  return { store, container, nodes, controller, announcements, detach };
}

interface KeyInit {
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

function key(h: Harness, id: string, k: string, init: KeyInit = {}): void {
  h.nodes
    .get(id)!
    .dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
}

function rectOf(h: Harness, id: string): Rect {
  return h.store.getItemView(id)!.rect;
}

afterEach(() => {
  document.body.innerHTML = '';
});

/* ------------------------------------------------------------------ */
/* nudges                                                              */
/* ------------------------------------------------------------------ */

describe('nudging', () => {
  it('moves 1px per arrow and 10px with Shift, one undo step each', () => {
    const h = setup();
    key(h, 'a', 'ArrowRight');
    expect(rectOf(h, 'a')).toEqual({ ...A, x: 101 });
    key(h, 'a', 'ArrowDown', { shiftKey: true });
    expect(rectOf(h, 'a')).toEqual({ ...A, x: 101, y: 110 });

    // Immediate-commit design: every arrow press is its own transaction.
    h.store.undo();
    expect(rectOf(h, 'a')).toEqual({ ...A, x: 101 });
    h.store.undo();
    expect(rectOf(h, 'a')).toEqual(A);
    expect(h.store.canUndo()).toBe(false);
  });

  it('announces the new position politely', () => {
    const h = setup();
    key(h, 'a', 'ArrowRight');
    expect(h.announcements).toEqual([
      { message: 'Revenue chart, moved to 101, 100.', tone: 'polite' },
    ]);
  });

  it('negates the arrow direction under RTL', () => {
    const h = setup(makeDoc([item('a', 'a0', A)], 'rtl'));
    key(h, 'a', 'ArrowLeft');
    // Logical x grows toward the physical left when the start edge is on the right.
    expect(rectOf(h, 'a').x).toBe(101);
    key(h, 'a', 'ArrowRight');
    expect(rectOf(h, 'a').x).toBe(100);
  });

  it('Cmd/Ctrl+Arrow jumps to the next snap candidate', () => {
    const h = setup();
    key(h, 'a', 'ArrowRight', { metaKey: true });
    // a's end edge (300) jumps to b's start edge (500).
    expect(rectOf(h, 'a').x).toBe(300);

    key(h, 'a', 'ArrowLeft', { ctrlKey: true });
    // Back to the container's start edge.
    expect(rectOf(h, 'a').x).toBe(0);
  });

  it('Cmd/Ctrl+Arrow skips ref/line pairings the snap engine forbids', () => {
    // s's centre line (410) is the nearest stop ahead of m's end edge (400),
    // but a centre line may only capture the moving CENTRE (providers.ts), so
    // the jump lands the centre on it instead: centre 350 → 410, i.e. x 360.
    const h = setup(
      makeDoc([
        item('m', 'a0', { x: 300, y: 100, w: 100, h: 100 }),
        item('s', 'b0', { x: 0, y: 400, w: 820, h: 50 }),
      ]),
    );
    key(h, 'm', 'ArrowRight', { metaKey: true });
    expect(rectOf(h, 'm').x).toBe(360);
  });

  it('ignores locked items and view mode', () => {
    const locked = setup(makeDoc([item('a', 'a0', A, { locked: true })]));
    key(locked, 'a', 'ArrowRight');
    expect(rectOf(locked, 'a')).toEqual(A);

    const h = setup();
    h.store.setMode('view');
    key(h, 'a', 'ArrowRight');
    expect(rectOf(h, 'a')).toEqual(A);
  });
});

/* ------------------------------------------------------------------ */
/* grab sessions                                                       */
/* ------------------------------------------------------------------ */

describe('grab sessions', () => {
  it('moves a ghost without committing, then drops as ONE transaction', () => {
    const h = setup();
    key(h, 'a', 'Enter');
    expect(h.store.getInteraction()).toEqual({ phase: 'kb-grab', id: 'a', rect: A });

    key(h, 'a', 'ArrowRight', { shiftKey: true });
    key(h, 'a', 'ArrowRight', { shiftKey: true });
    key(h, 'a', 'ArrowDown');

    const state = h.store.getInteraction();
    expect(state.phase === 'kb-grab' && state.rect).toEqual({ ...A, x: 120, y: 101 });
    // Nothing is committed while the ghost moves.
    expect(rectOf(h, 'a')).toEqual(A);
    expect(h.store.canUndo()).toBe(false);

    key(h, 'a', 'Enter');
    expect(h.store.getInteraction().phase).toBe('idle');
    expect(rectOf(h, 'a')).toEqual({ ...A, x: 120, y: 101 });

    h.store.undo();
    expect(rectOf(h, 'a')).toEqual(A);
    expect(h.store.canUndo()).toBe(false);
  });

  it('Space grabs and drops too', () => {
    const h = setup();
    key(h, 'a', ' ');
    expect(h.store.getInteraction().phase).toBe('kb-grab');
    key(h, 'a', 'ArrowRight');
    key(h, 'a', ' ');
    expect(rectOf(h, 'a').x).toBe(101);
  });

  it('Escape cancels the grab and commits nothing', () => {
    const h = setup();
    key(h, 'a', 'Enter');
    key(h, 'a', 'ArrowRight', { shiftKey: true });
    key(h, 'a', 'Escape');

    expect(h.store.getInteraction().phase).toBe('idle');
    expect(rectOf(h, 'a')).toEqual(A);
    expect(h.store.canUndo()).toBe(false);

    // The grab is over: arrows go back to committing immediately.
    key(h, 'a', 'ArrowRight');
    expect(rectOf(h, 'a').x).toBe(101);
  });

  it('announces each transition with the tone spec §11 assigns it', () => {
    const h = setup();
    key(h, 'a', 'Enter');
    key(h, 'a', 'ArrowRight');
    key(h, 'a', 'Enter');
    expect(h.announcements).toEqual([
      { message: 'Revenue chart grabbed. 100, 100. Item 1 of 2.', tone: 'assertive' },
      { message: 'Revenue chart, moved to 101, 100.', tone: 'polite' },
      { message: 'Revenue chart dropped at 101, 100.', tone: 'assertive' },
    ]);

    key(h, 'a', 'Enter');
    key(h, 'a', 'Escape');
    expect(h.announcements.at(-1)).toEqual({
      message: 'Revenue chart move canceled. Back at 101, 100.',
      tone: 'assertive',
    });
  });

  it('the grab keeps the keyboard even if the event comes from elsewhere', () => {
    const h = setup();
    key(h, 'a', 'Enter');
    key(h, 'b', 'ArrowRight');
    const state = h.store.getInteraction();
    expect(state.phase === 'kb-grab' && state.id).toBe('a');
    expect(state.phase === 'kb-grab' && state.rect.x).toBe(101);
  });

  it('losing focus cancels the grab', () => {
    const h = setup();
    key(h, 'a', 'Enter');
    h.nodes
      .get('a')!
      .dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(h.store.getInteraction().phase).toBe('idle');
    expect(h.store.canUndo()).toBe(false);
  });

  it('keeps the grab when focus moves within the dashboard', () => {
    const h = setup();
    key(h, 'a', 'Enter');
    h.nodes
      .get('a')!
      .dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: h.nodes.get('b')! }));
    expect(h.store.getInteraction().phase).toBe('kb-grab');
  });
});

/* ------------------------------------------------------------------ */
/* resize grab sessions                                                */
/* ------------------------------------------------------------------ */

describe('resize grab sessions (R)', () => {
  it('R arms a resize grab; arrows size the ghost; Enter commits ONE transaction', () => {
    const h = setup();
    key(h, 'a', 'r');
    expect(h.store.getInteraction()).toEqual({ phase: 'kb-grab', id: 'a', rect: A });

    key(h, 'a', 'ArrowRight', { shiftKey: true }); // w +10
    key(h, 'a', 'ArrowDown'); // h +1
    key(h, 'a', 'ArrowUp'); // h -1
    key(h, 'a', 'ArrowDown', { shiftKey: true }); // h +10

    const state = h.store.getInteraction();
    // The start edges stay anchored: only w/h move, never x/y.
    expect(state.phase === 'kb-grab' && state.rect).toEqual({ ...A, w: 210, h: 160 });
    // Nothing is committed while the ghost is being sized.
    expect(rectOf(h, 'a')).toEqual(A);
    expect(h.store.canUndo()).toBe(false);

    key(h, 'a', 'Enter');
    expect(h.store.getInteraction().phase).toBe('idle');
    expect(rectOf(h, 'a')).toEqual({ ...A, w: 210, h: 160 });

    // One session = one undo step, however many arrow presses it took.
    h.store.undo();
    expect(rectOf(h, 'a')).toEqual(A);
    expect(h.store.canUndo()).toBe(false);
  });

  it('Space and R commit too, and Shift+R still arms', () => {
    const h = setup();
    key(h, 'a', 'R', { shiftKey: true });
    expect(h.store.getInteraction().phase).toBe('kb-grab');
    key(h, 'a', 'ArrowRight');
    key(h, 'a', ' ');
    expect(rectOf(h, 'a').w).toBe(201);

    key(h, 'a', 'r');
    key(h, 'a', 'ArrowLeft');
    key(h, 'a', 'r'); // R during its own session commits, mirroring Enter
    expect(h.store.getInteraction().phase).toBe('idle');
    expect(rectOf(h, 'a').w).toBe(200);
  });

  it('announces the session through existing strings only', () => {
    const h = setup();
    key(h, 'a', 'r');
    key(h, 'a', 'ArrowRight');
    key(h, 'a', 'Enter');
    expect(h.announcements).toEqual([
      // Session start reuses `grabbed`; no new required string for locales.
      { message: 'Revenue chart grabbed. 100, 100. Item 1 of 2.', tone: 'assertive' },
      // Size status while the ghost changes is polite, like `moved`.
      { message: 'Revenue chart, resized to 201 by 150.', tone: 'polite' },
      // The commit is a transition (§11), so `resized` fires assertively with
      // the final w/h in the context.
      { message: 'Revenue chart, resized to 201 by 150.', tone: 'assertive' },
    ]);
  });

  it('keeps Left/Right as SCREEN directions under RTL', () => {
    const h = setup(makeDoc([item('a', 'a0', A)], 'rtl'));
    key(h, 'a', 'r');
    // The width is driven at the logical end edge — the physical LEFT edge
    // under RTL — so screen-left grows and screen-right shrinks.
    key(h, 'a', 'ArrowLeft');
    let state = h.store.getInteraction();
    expect(state.phase === 'kb-grab' && state.rect).toEqual({ ...A, w: 201 });
    key(h, 'a', 'ArrowRight');
    key(h, 'a', 'ArrowRight');
    state = h.store.getInteraction();
    expect(state.phase === 'kb-grab' && state.rect).toEqual({ ...A, w: 199 });
  });

  it('clamps to min/max live and never sizes below 1px', () => {
    const h = setup(makeDoc([item('a', 'a0', A, { maxW: 205, minH: 145 })]));
    key(h, 'a', 'r');
    key(h, 'a', 'ArrowRight', { shiftKey: true }); // 210 → clamped to maxW 205
    key(h, 'a', 'ArrowRight'); // pinned at the limit
    key(h, 'a', 'ArrowUp', { shiftKey: true }); // 140 → clamped to minH 145
    let state = h.store.getInteraction();
    expect(state.phase === 'kb-grab' && state.rect).toEqual({ ...A, w: 205, h: 145 });
    key(h, 'a', 'Enter');
    expect(rectOf(h, 'a')).toEqual({ ...A, w: 205, h: 145 });

    // With no declared minimum the floor is 1px — a shrink never collapses
    // the rect to nothing or below.
    const tiny = setup(makeDoc([item('t', 't0', { x: 0, y: 0, w: 3, h: 3 })]));
    key(tiny, 't', 'r');
    key(tiny, 't', 'ArrowLeft', { shiftKey: true });
    key(tiny, 't', 'ArrowUp', { shiftKey: true });
    key(tiny, 't', 'ArrowLeft');
    state = tiny.store.getInteraction();
    expect(state.phase === 'kb-grab' && state.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('Escape cancels and reverts, committing nothing', () => {
    const h = setup();
    key(h, 'a', 'r');
    key(h, 'a', 'ArrowRight', { shiftKey: true });
    key(h, 'a', 'Escape');

    expect(h.store.getInteraction().phase).toBe('idle');
    expect(rectOf(h, 'a')).toEqual(A);
    expect(h.store.canUndo()).toBe(false);
    expect(h.announcements.at(-1)).toEqual({
      message: 'Revenue chart move canceled. Back at 100, 100.',
      tone: 'assertive',
    });
  });

  it('a commit at the starting size records nothing', () => {
    const h = setup();
    key(h, 'a', 'r');
    key(h, 'a', 'Enter'); // untouched ghost
    expect(h.store.getInteraction().phase).toBe('idle');
    expect(h.store.canUndo()).toBe(false);

    key(h, 'a', 'r');
    key(h, 'a', 'ArrowRight');
    key(h, 'a', 'ArrowLeft'); // grown and shrunk back: same size on commit
    key(h, 'a', 'r');
    expect(rectOf(h, 'a')).toEqual(A);
    expect(h.store.canUndo()).toBe(false);
  });

  it('keeps the session live when the commit lands on a forbidden overlap', () => {
    // a's end edge touches b's start edge: one px of growth and they overlap.
    const h = setup(
      makeDoc([
        item('a', 'a0', A, { collision: 'forbid' }),
        item('b', 'b0', { x: 300, y: 100, w: 200, h: 150 }),
      ]),
    );
    key(h, 'a', 'r');
    key(h, 'a', 'ArrowRight');
    key(h, 'a', 'Enter');
    // §1.12 through the same commitRects chokepoint as the move grab: the
    // landing is refused, the session stays live, announced assertively.
    expect(h.store.getInteraction().phase).toBe('kb-grab');
    expect(rectOf(h, 'a')).toEqual(A);
    expect(h.store.canUndo()).toBe(false);
    expect(h.announcements.at(-1)).toEqual({
      message: 'Revenue chart move canceled. Back at 100, 100.',
      tone: 'assertive',
    });

    key(h, 'a', 'ArrowLeft');
    key(h, 'a', 'ArrowLeft');
    key(h, 'a', 'Enter');
    expect(h.store.getInteraction().phase).toBe('idle');
    expect(rectOf(h, 'a').w).toBe(199);
  });

  it('losing focus cancels the resize grab', () => {
    const h = setup();
    key(h, 'a', 'r');
    key(h, 'a', 'ArrowRight');
    h.nodes
      .get('a')!
      .dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(h.store.getInteraction().phase).toBe('idle');
    expect(rectOf(h, 'a')).toEqual(A);
    expect(h.store.canUndo()).toBe(false);
  });

  it('Delete during a resize grab removes the item and clears the session', () => {
    const h = setup();
    key(h, 'a', 'r');
    key(h, 'a', 'Delete');
    expect(h.store.getItem('a')).toBeUndefined();
    expect(h.store.getInteraction().phase).toBe('idle');
  });

  it('a mode flip to view freezes the session; detach (the adapter path) cancels it', () => {
    const h = setup();
    key(h, 'a', 'r');
    key(h, 'a', 'ArrowRight');
    h.store.setMode('view');
    // Keys are inert in view mode: the ghost can neither move nor commit.
    key(h, 'a', 'ArrowRight');
    key(h, 'a', 'Enter');
    expect(rectOf(h, 'a')).toEqual(A);
    // A mode flip tears the controller down in the adapter; its detach cancels
    // the session outright — the same rule the move grab follows.
    h.detach();
    expect(h.store.getInteraction().phase).toBe('idle');
    h.store.setMode('edit');
    expect(h.store.canUndo()).toBe(false);
  });

  it('ignores locked items and view mode', () => {
    const locked = setup(makeDoc([item('a', 'a0', A, { locked: true })]));
    key(locked, 'a', 'r');
    expect(locked.store.getInteraction().phase).toBe('idle');

    const h = setup();
    h.store.setMode('view');
    key(h, 'a', 'r');
    expect(h.store.getInteraction().phase).toBe('idle');
  });

  it('is inert from a form control, like every other layout shortcut', () => {
    const h = setup();
    const input = document.createElement('input');
    h.nodes.get('a')!.appendChild(input);
    const ev = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    // The keystroke reaches the field as the letter r, not a layout command.
    expect(ev.defaultPrevented).toBe(false);
    expect(h.store.getInteraction().phase).toBe('idle');
  });

  it('leaves Cmd/Ctrl+R to the browser', () => {
    const h = setup();
    for (const init of [{ ctrlKey: true }, { metaKey: true }] as const) {
      const ev = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true, ...init });
      h.nodes.get('a')!.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(h.store.getInteraction().phase).toBe('idle');
  });

  it('R during a MOVE grab is ignored — the arrows keep meaning "move"', () => {
    const h = setup();
    key(h, 'a', 'Enter');
    key(h, 'a', 'r');
    // Still the same move session: nothing committed, nothing switched.
    expect(h.store.getInteraction().phase).toBe('kb-grab');
    key(h, 'a', 'ArrowRight');
    const state = h.store.getInteraction();
    expect(state.phase === 'kb-grab' && state.rect).toEqual({ ...A, x: 101 });
    key(h, 'a', 'Enter');
    expect(rectOf(h, 'a')).toEqual({ ...A, x: 101 });
  });

  it('R hands an armed placement over to a resize grab, silently', () => {
    const h = setup();
    h.controller.beginPlace('a');
    key(h, 'a', 'r');

    // Exactly one live session, and the hand-over is not announced as a cancel.
    expect(h.store.getInteraction()).toEqual({ phase: 'kb-grab', id: 'a', rect: A });
    expect(h.announcements.map((a) => a.message).some((m) => m.includes('canceled'))).toBe(false);

    key(h, 'a', 'ArrowRight');
    key(h, 'a', 'Enter');
    expect(h.store.getInteraction().phase).toBe('idle');
    expect(rectOf(h, 'a').w).toBe(201);
  });

  it('refuses to arm a placement while a resize grab is live', () => {
    const h = setup();
    key(h, 'a', 'r');
    h.controller.beginPlace('a');
    expect(h.store.getInteraction().phase).toBe('kb-grab');
    // Never armed, so a landing attempt is a no-op.
    h.controller.completePlace({ x: 700, y: 400 });
    expect(rectOf(h, 'a')).toEqual(A);
  });
});

/* ------------------------------------------------------------------ */
/* content that owns its own keys                                      */
/* ------------------------------------------------------------------ */

describe('editable targets', () => {
  function withChild(tag: string, attrs: Record<string, string> = {}): { h: Harness; child: HTMLElement } {
    const h = setup();
    const child = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) child.setAttribute(name, value);
    h.nodes.get('a')!.appendChild(child);
    return { h, child };
  }

  function press(node: HTMLElement, k: string, init: KeyInit = {}): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    node.dispatchEvent(ev);
    return ev;
  }

  it('leaves every layout shortcut alone inside a form control', () => {
    const { h, child } = withChild('input');
    for (const k of ['ArrowRight', 'ArrowDown', 'Enter', ' ', 'Delete', 'Backspace', ']']) {
      const ev = press(child, k, { metaKey: k === ']' });
      // The keystroke reaches the field: nothing was consumed on its behalf.
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(rectOf(h, 'a')).toEqual(A);
    expect(h.store.getItem('a')).toBeDefined();
    expect(h.store.getInteraction().phase).toBe('idle');
    expect(h.store.getOrder()).toEqual(['a', 'b']);
    expect(h.announcements).toEqual([]);
  });

  it('leaves undo alone inside a form control', () => {
    const { h, child } = withChild('input');
    key(h, 'a', 'ArrowRight');
    expect(rectOf(h, 'a').x).toBe(101);

    const ev = press(child, 'z', { metaKey: true });
    expect(ev.defaultPrevented).toBe(false);
    expect(rectOf(h, 'a').x).toBe(101);
  });

  it('treats contenteditable content as editable', () => {
    const { h, child } = withChild('div', { contenteditable: 'true' });
    press(child, 'Backspace');
    expect(h.store.getItem('a')).toBeDefined();
  });

  it('data-vzb-keys opts a control back into the layout shortcuts', () => {
    const { h, child } = withChild('button', { 'data-vzb-keys': '' });
    const ev = press(child, 'ArrowRight');
    expect(ev.defaultPrevented).toBe(true);
    expect(rectOf(h, 'a').x).toBe(101);
  });

  it('still lets a live grab own the keyboard from inside a field', () => {
    const { h, child } = withChild('input');
    key(h, 'a', 'Enter');
    press(child, 'ArrowRight');
    const state = h.store.getInteraction();
    expect(state.phase === 'kb-grab' && state.rect.x).toBe(101);
    press(child, 'Escape');
    expect(h.store.getInteraction().phase).toBe('idle');
  });
});

/* ------------------------------------------------------------------ */
/* placing vs. grabbing                                                */
/* ------------------------------------------------------------------ */

describe('tap-to-place and the keyboard', () => {
  it('Escape cancels an armed placement from anywhere in the container', () => {
    const h = setup();
    h.controller.beginPlace('a');
    h.container.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(h.store.getInteraction().phase).toBe('idle');
    expect(h.announcements.at(-1)?.message).toContain('canceled');
  });

  it('Escape cancels an armed placement from a focused field', () => {
    const h = setup();
    const input = document.createElement('input');
    h.nodes.get('a')!.appendChild(input);
    h.controller.beginPlace('a');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(h.store.getInteraction().phase).toBe('idle');
  });

  it('Enter hands an armed placement over to a keyboard grab', () => {
    const h = setup();
    h.controller.beginPlace('a');
    key(h, 'a', 'Enter');

    // Exactly one live session, and the hand-over is not announced as a cancel.
    expect(h.store.getInteraction()).toEqual({ phase: 'kb-grab', id: 'a', rect: A });
    expect(h.announcements.map((a) => a.message).some((m) => m.includes('canceled'))).toBe(false);

    key(h, 'a', 'ArrowRight');
    key(h, 'a', 'Enter');
    expect(h.store.getInteraction().phase).toBe('idle');
    expect(rectOf(h, 'a').x).toBe(101);
  });

  it('refuses to arm a placement while a grab is live', () => {
    const h = setup();
    key(h, 'a', 'Enter');
    h.controller.beginPlace('a');
    expect(h.store.getInteraction().phase).toBe('kb-grab');
  });

  it('focus leaving the container disarms an armed placement', () => {
    // The Escape that ends a placement lives on the container's keydown
    // listener, so once focus is gone the armed state has no exit and the
    // next press inside the container would teleport the item.
    const h = setup();
    h.controller.beginPlace('a');
    h.nodes
      .get('a')!
      .dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(h.store.getInteraction().phase).toBe('idle');
    expect(h.announcements.at(-1)?.message).toContain('canceled');

    // Disarmed for real: a later landing attempt is a no-op.
    h.controller.completePlace({ x: 700, y: 400 });
    expect(rectOf(h, 'a')).toEqual(A);
  });

  it('keeps the placement armed when focus moves within the dashboard', () => {
    const h = setup();
    h.controller.beginPlace('a');
    h.nodes
      .get('a')!
      .dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: h.nodes.get('b')! }));
    expect(h.store.getInteraction()).toEqual({ phase: 'placing', id: 'a' });
  });

  it('removing the armed item disarms the placement', () => {
    const h = setup();
    h.controller.beginPlace('a');
    key(h, 'a', 'Delete');
    expect(h.store.getItem('a')).toBeUndefined();
    // The transient channel does not stay on `placing` for a dead id.
    expect(h.store.getInteraction().phase).toBe('idle');
    h.controller.completePlace({ x: 300, y: 300 });
    expect(h.store.getInteraction().phase).toBe('idle');
  });
});

/* ------------------------------------------------------------------ */
/* forbidden overlaps on the keyboard paths                            */
/* ------------------------------------------------------------------ */

describe('forbidden overlaps (§1.12)', () => {
  // a's end edge touches b's start edge: one px right and they overlap.
  const doc = (): LayoutDoc =>
    makeDoc([
      item('a', 'a0', A, { collision: 'forbid' }),
      item('b', 'b0', { x: 300, y: 100, w: 200, h: 150 }),
    ]);

  it('refuses a nudge into a forbidden overlap, politely', () => {
    const h = setup(doc());
    key(h, 'a', 'ArrowRight');
    expect(rectOf(h, 'a')).toEqual(A);
    expect(h.store.canUndo()).toBe(false);
    expect(h.announcements.at(-1)).toEqual({
      message: 'Revenue chart move canceled. Back at 100, 100.',
      tone: 'polite',
    });

    // The key is only dead in the direction that collides.
    key(h, 'a', 'ArrowLeft');
    expect(rectOf(h, 'a').x).toBe(99);
  });

  it('keeps the item grabbed when the drop would land on an overlap', () => {
    const h = setup(doc());
    key(h, 'a', 'Enter');
    key(h, 'a', 'ArrowRight');
    // The ghost tracks the keys 1:1, exactly like the pointer ghost.
    const ghost = h.store.getInteraction();
    expect(ghost.phase === 'kb-grab' && ghost.rect.x).toBe(101);

    key(h, 'a', 'Enter');
    expect(h.store.getInteraction().phase).toBe('kb-grab');
    expect(rectOf(h, 'a')).toEqual(A);
    expect(h.announcements.at(-1)).toEqual({
      message: 'Revenue chart move canceled. Back at 101, 100.',
      tone: 'assertive',
    });

    key(h, 'a', 'ArrowLeft');
    key(h, 'a', 'ArrowLeft');
    key(h, 'a', 'Enter');
    expect(h.store.getInteraction().phase).toBe('idle');
    expect(rectOf(h, 'a').x).toBe(99);
  });
});

/* ------------------------------------------------------------------ */
/* structural commands                                                 */
/* ------------------------------------------------------------------ */

describe('structural commands', () => {
  it('Delete and Backspace remove the item and announce it', () => {
    const h = setup();
    key(h, 'a', 'Delete');
    expect(h.store.getItem('a')).toBeUndefined();
    expect(h.announcements).toEqual([{ message: 'Revenue chart removed.', tone: 'assertive' }]);

    h.store.undo();
    expect(h.store.getItem('a')).toBeDefined();
    key(h, 'a', 'Backspace');
    expect(h.store.getItem('a')).toBeUndefined();
  });

  it('does not remove a locked item', () => {
    const h = setup(makeDoc([item('a', 'a0', A, { locked: true })]));
    key(h, 'a', 'Delete');
    expect(h.store.getItem('a')).toBeDefined();
  });

  it('Cmd/Ctrl + ] and [ reorder, and announce politely', () => {
    const h = setup();
    expect(h.store.getOrder()).toEqual(['a', 'b']);

    key(h, 'a', ']', { metaKey: true });
    expect(h.store.getOrder()).toEqual(['b', 'a']);
    expect(h.announcements.at(-1)).toEqual({
      message: 'Revenue chart moved to front. Item 2 of 2.',
      tone: 'polite',
    });

    key(h, 'a', '[', { ctrlKey: true });
    expect(h.store.getOrder()).toEqual(['a', 'b']);

    // Without the modifier the bracket is just a bracket.
    key(h, 'a', ']');
    expect(h.store.getOrder()).toEqual(['a', 'b']);
  });

  it('Cmd/Ctrl+Z undoes and Shift+Z redoes', () => {
    const h = setup();
    key(h, 'a', 'ArrowRight');
    expect(rectOf(h, 'a').x).toBe(101);

    key(h, 'a', 'z', { metaKey: true });
    expect(rectOf(h, 'a').x).toBe(100);

    key(h, 'a', 'z', { metaKey: true, shiftKey: true });
    expect(rectOf(h, 'a').x).toBe(101);

    key(h, 'a', 'Z', { ctrlKey: true });
    expect(rectOf(h, 'a').x).toBe(100);
  });
});

/* ------------------------------------------------------------------ */
/* lifecycle                                                           */
/* ------------------------------------------------------------------ */

describe('keyboard lifecycle', () => {
  it('detach cancels an open grab and stops listening', () => {
    const h = setup();
    key(h, 'a', 'Enter');
    h.detach();
    expect(h.store.getInteraction().phase).toBe('idle');
    key(h, 'a', 'ArrowRight');
    expect(rectOf(h, 'a')).toEqual(A);
  });

  it('setOptions swaps the strings used for announcements', () => {
    const h = setup();
    h.controller.setOptions({ getLabel: () => 'Widget' });
    key(h, 'a', 'ArrowRight');
    expect(h.announcements.at(-1)?.message).toBe('Widget, moved to 101, 100.');
  });
});
