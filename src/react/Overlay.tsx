/**
 * The editing overlay: guides, marquee, live regions, instructions.
 *
 * Mounted exactly once, in edit mode only. This is the ONE component allowed to
 * re-render per frame (§1.25) — and it is deliberately built so that doing so
 * costs almost nothing: the element tree is structurally identical on every
 * frame (a fixed pool of `<line>`s whose props never change), so React's
 * reconciliation is a no-op, and the actual geometry is written straight to the
 * DOM through refs in a layout effect.
 *
 * The precise claim this supports: *0 item renders during a drag, 1 imperative
 * overlay write per frame, 1 item render at commit.*
 */

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { Guide, InteractionState, Rect } from '../core/schema/types';
import type { AnnounceTargets } from './context';
import {
  SR_ONLY,
  applyTransientAttrs,
  instructionsId,
  sameIds,
  transientIds,
  useIsomorphicLayoutEffect,
  useVizbrixContext,
} from './context';

/** Guides beyond this many in one frame are not information, they are noise. */
const MAX_GUIDES = 12;

const IDLE: InteractionState = { phase: 'idle' };

const SVG_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  overflow: 'visible',
  pointerEvents: 'none',
  zIndex: 2000000,
};

const MARQUEE_STYLE: CSSProperties = {
  position: 'absolute',
  display: 'none',
  boxSizing: 'border-box',
  border: '1px solid var(--vzb-marquee-border, #4c8dff)',
  background: 'var(--vzb-marquee-bg, rgba(76, 141, 255, 0.12))',
  pointerEvents: 'none',
  zIndex: 2000001,
};

const GUIDE_STYLE: CSSProperties = {
  stroke: 'var(--vzb-guide-color, #ff2d95)',
  strokeWidth: 1,
  shapeRendering: 'crispEdges',
};

/* ------------------------------------------------------------------ */
/* Imperative writers                                                  */
/* ------------------------------------------------------------------ */

function guidesOf(state: InteractionState): readonly Guide[] {
  if (state.phase === 'dragging' || state.phase === 'resizing') return state.guides;
  return EMPTY_GUIDES;
}

const EMPTY_GUIDES: readonly Guide[] = Object.freeze([]);
const NO_IDS: readonly string[] = Object.freeze([]);

function marqueeOf(state: InteractionState): Rect | null {
  return state.phase === 'marquee' ? state.rect : null;
}

/** One frame's worth of DOM writes. No allocation, no React. */
function writeGuides(pool: readonly (SVGLineElement | null)[], guides: readonly Guide[]): void {
  for (let i = 0; i < pool.length; i++) {
    const el = pool[i];
    if (!el) continue;
    const g = i < guides.length ? guides[i] : undefined;
    if (!g) {
      el.setAttribute('visibility', 'hidden');
      continue;
    }
    // A guide on the x axis is a VERTICAL line: it marks a position along x and
    // extends along y.
    const vertical = g.axis === 'x';
    el.setAttribute('x1', String(vertical ? g.at : g.from));
    el.setAttribute('x2', String(vertical ? g.at : g.to));
    el.setAttribute('y1', String(vertical ? g.from : g.at));
    el.setAttribute('y2', String(vertical ? g.to : g.at));
    el.setAttribute('data-vzb-guide', g.kind);
    el.setAttribute('visibility', 'visible');
  }
}

function writeMarquee(el: HTMLElement | null, rect: Rect | null): void {
  if (!el) return;
  if (!rect) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.style.left = `${rect.x}px`;
  el.style.top = `${rect.y}px`;
  el.style.width = `${rect.w}px`;
  el.style.height = `${rect.h}px`;
}

/**
 * Push a message into a live region.
 *
 * Setting identical text twice is a no-announcement in most screen readers, so
 * a repeated message is nudged with a zero-width space — invisible, but a
 * genuine text change.
 */
export function announceTo(
  targets: AnnounceTargets,
  message: string,
  tone: 'assertive' | 'polite',
): void {
  const el = tone === 'assertive' ? targets.assertive : targets.polite;
  if (!el) return;
  const ZWSP = '\u200B';
  el.textContent = el.textContent === message ? message + ZWSP : message;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function Overlay(): ReactElement {
  const { store, instanceId, strings, announceRef } = useVizbrixContext();

  const subscribe = useCallback((cb: () => void) => store.subscribeInteraction(cb), [store]);
  const getSnapshot = useCallback(() => store.getInteraction(), [store]);
  const getServerSnapshot = useCallback(() => IDLE, []);
  const interaction = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const linesRef = useRef<(SVGLineElement | null)[]>([]);
  const marqueeRef = useRef<HTMLDivElement | null>(null);
  const assertiveRef = useRef<HTMLDivElement | null>(null);
  const politeRef = useRef<HTMLDivElement | null>(null);

  useIsomorphicLayoutEffect(() => {
    announceRef.current = {
      assertive: assertiveRef.current,
      polite: politeRef.current,
    };
    return () => {
      announceRef.current = { assertive: null, polite: null };
    };
  }, [announceRef]);

  useIsomorphicLayoutEffect(() => {
    writeGuides(linesRef.current, guidesOf(interaction));
    writeMarquee(marqueeRef.current, marqueeOf(interaction));
  }, [interaction]);

  /**
   * `data-dragging` / `data-resizing` on the items themselves.
   *
   * The overlay owns this because it is the ONE component subscribed to the
   * interaction channel: the items are not, by design. The work is proportional
   * to how many ids started or stopped moving (usually one, usually twice per
   * gesture) — never to how many items exist, and never once per frame.
   */
  const activeRef = useRef<readonly string[]>(NO_IDS);
  useIsomorphicLayoutEffect(() => {
    const next = transientIds(interaction);
    const prev = activeRef.current;
    if (sameIds(prev, next)) return;
    const kind = interaction.phase === 'resizing' ? 'resizing' : 'dragging';
    for (const id of prev) {
      if (next.indexOf(id) < 0) applyTransientAttrs(store.getNode(id), null);
    }
    for (const id of next) applyTransientAttrs(store.getNode(id), kind);
    activeRef.current = next;
  }, [interaction, store]);

  useIsomorphicLayoutEffect(() => {
    return () => {
      for (const id of activeRef.current) applyTransientAttrs(store.getNode(id), null);
      activeRef.current = NO_IDS;
    };
  }, [store]);

  // The line pool is built once and never rebuilt: identical elements with
  // identical (stable) ref callbacks mean React's per-frame reconciliation of
  // the overlay walks a tree in which literally nothing changed.
  const pool = useMemo(
    () =>
      Array.from({ length: MAX_GUIDES }, (_unused, i) => (
        <line
          key={i}
          ref={(el: SVGLineElement | null) => {
            linesRef.current[i] = el;
          }}
          visibility="hidden"
          style={GUIDE_STYLE}
        />
      )),
    [],
  );

  return (
    <>
      <svg data-vzb-guides="" aria-hidden="true" style={SVG_STYLE}>
        {pool}
      </svg>
      <div data-vzb-marquee="" aria-hidden="true" ref={marqueeRef} style={MARQUEE_STYLE} />
      <div id={instructionsId(instanceId)} style={SR_ONLY}>
        {strings.instructions()}
      </div>
      <div
        data-vzb-live="assertive"
        ref={assertiveRef}
        role="status"
        aria-live="assertive"
        aria-atomic="true"
        style={SR_ONLY}
      />
      <div
        data-vzb-live="polite"
        ref={politeRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={SR_ONLY}
      />
    </>
  );
}
