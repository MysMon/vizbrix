// @vitest-environment jsdom
/**
 * THE claim, under test (spec §15.1).
 *
 * > "Dragging one item never re-renders another. 0 item renders during the
 * >  drag, 1 imperative overlay write per frame, 1 item render at commit."
 *
 * This is the thing every grid layout library for React gets wrong, and it is
 * measurable rather than rhetorical — so it gets a test rather than a README
 * paragraph. See react-grid-layout discussion #2228 ("Performance with many
 * items / re-render of all children on drag"), where the accepted answer is
 * that every child re-renders on every drag frame because layout state lives in
 * the parent component's state. vizbrix keeps layout in an external store with
 * per-item channels, so a drag frame touches: the dragged node's `transform`
 * (imperative), the overlay's guide lines (imperative), and nothing else.
 *
 * The gesture here is driven through the store directly — transient frames,
 * imperative transform writes, then one commit — rather than through synthetic
 * pointer events. That is deliberate: this test measures the RENDER topology,
 * not the pointer sensor, and it must stay meaningful even if the sensor is
 * rewritten.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import type { InteractionState, LayoutDoc, Rect } from '../core/schema/types';
import { defineLayout } from '../core/schema/normalize';
import { Vizbrix } from './Vizbrix';
import { useVizbrix } from './hooks';
import type { VizbrixApi } from './hooks';

/* jsdom has no ResizeObserver; the adapter tolerates that, but we want the
 * observing code path exercised, so give it an inert one. */
class InertResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
const globalWithRO = globalThis as unknown as { ResizeObserver?: unknown };
globalWithRO.ResizeObserver ??= InertResizeObserver;

const ITEM_COUNT = 200;
const FRAMES = 500;
const DRAGGED = 'i77';

function makeDoc(): LayoutDoc {
  return defineLayout({
    container: { base: { width: 1200 }, stackBelow: 0 },
    items: Array.from({ length: ITEM_COUNT }, (_unused, i) => ({
      id: `i${i}`,
      x: (i % 10) * 120,
      y: Math.floor(i / 10) * 80,
      w: 100,
      h: 60,
    })),
  });
}

let captured: VizbrixApi<unknown> | null = null;
function Probe(): null {
  captured = useVizbrix();
  return null;
}

function draggingState(id: string, rect: Rect): InteractionState {
  return {
    phase: 'dragging',
    ids: [id],
    rects: new Map([[id, rect]]),
    guides: [{ axis: 'x', at: rect.x, from: 0, to: 600, kind: 'edge' }],
    valid: true,
    lastValidRects: null,
  };
}

afterEach(() => {
  cleanup();
  captured = null;
});

describe('render topology during a drag', () => {
  it('renders 0 siblings across 500 frames and exactly 1 item at commit', () => {
    const renders = new Map<string, number>();
    const doc = makeDoc();

    render(
      <Vizbrix defaultLayout={doc} mode="edit">
        {(item) => {
          renders.set(item.id, (renders.get(item.id) ?? 0) + 1);
          return item.id === 'i0' ? <Probe /> : null;
        }}
      </Vizbrix>,
    );

    // Mount is one render per item. Anything else here would already be a bug.
    expect(renders.size).toBe(ITEM_COUNT);
    for (const [id, count] of renders) expect(`${id}:${count}`).toBe(`${id}:1`);

    const api = captured;
    expect(api).not.toBeNull();
    const store = api!.store;

    const start = store.getItemView(DRAGGED)!.rect;
    const node = store.getNode(DRAGGED)!;
    expect(node).toBeTruthy();

    /* ---- the gesture: 500 transient frames ---- */
    for (let frame = 1; frame <= FRAMES; frame++) {
      const rect: Rect = { ...start, x: start.x + frame };
      act(() => {
        // Exactly what the interaction layer does per frame: one imperative
        // write to the dragged node, one transient store update for the
        // overlay and the snap/collision math. No React state anywhere.
        node.style.transform = `translate(${frame}px, 0px)`;
        store.setInteraction(draggingState(DRAGGED, rect));
      });
    }

    // Not one render, for any item, in 500 frames.
    for (const [id, count] of renders) expect(`${id}:${count}`).toBe(`${id}:1`);

    // The state attribute consumers style against is live — written
    // imperatively by the overlay, at a cost of zero item renders.
    expect(node.getAttribute('data-dragging')).toBe('');
    expect(store.getNode('i78')!.getAttribute('data-dragging')).toBeNull();

    // The overlay did do its per-frame work — imperatively, through refs.
    const line = document.querySelector('[data-vzb-guides] line[visibility="visible"]');
    expect(line).not.toBeNull();
    expect(line!.getAttribute('x1')).toBe(String(start.x + FRAMES));

    /* ---- the commit ---- */
    act(() => {
      store.moveItem(DRAGGED, { ...start, x: start.x + FRAMES });
      store.setInteraction({ phase: 'idle' });
      node.style.transform = '';
    });

    expect(node.getAttribute('data-dragging')).toBeNull();
    expect(renders.get(DRAGGED)).toBe(2); // mount + commit
    for (const [id, count] of renders) {
      if (id === DRAGGED) continue;
      expect(`${id}:${count}`).toBe(`${id}:1`);
    }

    // And the commit really did move it.
    expect(store.getItemView(DRAGGED)!.rect.x).toBe(start.x + FRAMES);
  });

  it('re-renders only the item whose snapshot changed on a container resize', () => {
    const renders = new Map<string, number>();
    const doc = defineLayout({
      container: { base: { width: 1000 }, stackBelow: 0 },
      items: [
        // Pure pixels: its rect is width-independent.
        { id: 'fixed', x: 10, y: 10, w: 100, h: 50 },
        // Fractional: its rect moves with the container.
        { id: 'fluid', x: 500, y: 10, w: 100, h: 50, anchor: 'scale' },
      ],
    });

    render(
      <Vizbrix defaultLayout={doc} mode="edit">
        {(item) => {
          renders.set(item.id, (renders.get(item.id) ?? 0) + 1);
          return item.id === 'fixed' ? <Probe /> : null;
        }}
      </Vizbrix>,
    );

    const store = captured!.store;
    act(() => {
      store.setContainerSize(800);
    });

    expect(renders.get('fixed')).toBe(1);
    expect(renders.get('fluid')).toBe(2);
  });

  it('holds under StrictMode double-mounting', () => {
    const renders = new Map<string, number>();
    const doc = makeDoc();

    render(
      <StrictMode>
        <Vizbrix defaultLayout={doc} mode="edit">
          {(item) => {
            renders.set(item.id, (renders.get(item.id) ?? 0) + 1);
            return item.id === 'i0' ? <Probe /> : null;
          }}
        </Vizbrix>
      </StrictMode>,
    );

    const store = captured!.store;
    const baseline = new Map(renders);
    const start = store.getItemView(DRAGGED)!.rect;

    for (let frame = 1; frame <= 50; frame++) {
      act(() => {
        store.setInteraction(draggingState(DRAGGED, { ...start, x: start.x + frame }));
      });
    }

    for (const [id, count] of renders) expect(`${id}:${count}`).toBe(`${id}:${baseline.get(id)}`);
  });
});
