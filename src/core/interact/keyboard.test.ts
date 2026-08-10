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
