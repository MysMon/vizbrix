/**
 * React adapter context — the shared plumbing every surface hangs off.
 *
 * Two things live here that are load-bearing for the render-count claim
 * (§1.25, §15.1):
 *
 * 1. **The render callback is ref-backed.** Consumers overwhelmingly pass an
 *    inline arrow as `children`, whose identity changes on every parent render.
 *    Putting that function straight into context would re-render every item on
 *    every parent render. Instead the callback lives in a stable box, and a
 *    separate `renderVersion` counter is bumped from an effect when the
 *    identity actually changes — so items pick up a new callback exactly once,
 *    on the commit after it changed, and never otherwise. (Documented tradeoff:
 *    the very first paint after a callback swap still uses the previous
 *    callback; there is no stale-forever class, only a stale-for-one-commit
 *    one.)
 * 2. **Transient gesture state is NOT in context.** The interaction channel is
 *    read imperatively by the overlay and by the interaction layer's own DOM
 *    writes. If a component subscribed to it here, every item would re-render
 *    per frame — which is exactly the failure mode vizbrix exists to avoid.
 */

import { createContext, useContext, useEffect, useLayoutEffect } from 'react';
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
} from 'react';
import type { InteractionController } from '../core/interact/controller';
import type {
  InteractionState,
  LayoutDoc,
  LayoutItemBase,
  Rect,
  VizbrixStore,
  VizbrixStrings,
} from '../core/schema/types';

/* ------------------------------------------------------------------ */
/* Public render contract                                              */
/* ------------------------------------------------------------------ */

/**
 * What the consumer's render callback receives for one item.
 *
 * `data` follows the same conditional-requiredness rule as `LayoutItem`: it is
 * optional for data-less dashboards and required (hence narrowable without a
 * null check) as soon as a `TData` is supplied.
 *
 * `rect` is resolved at the CURRENT measured width — except on the server and
 * during hydration, where it is the `base.width` rect (§1.21).
 */
export type ItemView<TData = undefined> = {
  id: string;
  rect: Rect;
  hidden: boolean;
  locked: boolean;
} & ([undefined] extends [TData] ? { data?: TData } : { data: TData });

/**
 * Editing affordances for one item.
 *
 * `isDragging` / `isResizing` / `isPlacing` are snapshots taken at RENDER time,
 * not reactive subscriptions: an item that re-rendered whenever the gesture
 * state changed would re-render 60 times a second. The live signal is the
 * `data-dragging` attribute, which the interaction layer writes imperatively on
 * the item root — style against that in CSS, and treat these booleans as
 * "what was true the last time this item rendered".
 */
export interface ItemUI {
  isSelected: boolean;
  isDragging: boolean;
  isResizing: boolean;
  isPlacing: boolean;
  /**
   * Spread onto a sub-element to make ONLY that element start a pointer drag.
   * If it is never spread, the whole item is the drag handle.
   */
  handleProps: HTMLAttributes<HTMLElement>;
  /** Tap-to-place affordance (WCAG 2.2 SC 2.5.7). Render it inside the item. */
  moveButtonProps: ButtonHTMLAttributes<HTMLButtonElement>;
  /** role / aria / data-* — already spread on the item root by the library. */
  attributes: HTMLAttributes<HTMLElement>;
  remove(): void;
  bringToFront(): void;
  select(): void;
}

/** The `children` callback of every vizbrix surface. */
export type ItemRenderer<TData = undefined> = (
  item: ItemView<TData>,
  ui: ItemUI,
) => ReactNode;

/** Internal, type-erased form of {@link ItemRenderer}. */
export type AnyItemRenderer = (item: ItemView<unknown>, ui: ItemUI) => ReactNode;

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

/** A mutable box. Local so the adapter works against React 18 and 19 typings. */
export interface Box<T> {
  current: T;
}

export interface AnnounceTargets {
  assertive: HTMLElement | null;
  polite: HTMLElement | null;
}

export interface VizbrixRuntime {
  store: VizbrixStore<unknown>;
  instanceId: string;
  mode: 'view' | 'edit';
  strings: VizbrixStrings;
  getLabel: (item: LayoutItemBase) => string;
  /** Null in view mode and until the attach effect has run. */
  controllerRef: Box<InteractionController | null>;
  renderRef: Box<AnyItemRenderer>;
  /** Bumped when the render callback's identity changed. */
  renderVersion: number;
  announceRef: Box<AnnounceTargets>;
}

export const VizbrixContext = createContext<VizbrixRuntime | null>(null);

/** Internal accessor. Throws with an actionable message outside a provider. */
export function useVizbrixContext(): VizbrixRuntime {
  const ctx = useContext(VizbrixContext);
  if (ctx === null) {
    throw new Error(
      'vizbrix: no layout context found. Render this inside <Vizbrix> or <VizbrixView>.',
    );
  }
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Small shared utilities                                              */
/* ------------------------------------------------------------------ */

/**
 * `useLayoutEffect` on the client, `useEffect` on the server.
 *
 * The adapter renders under `renderToString` (hydration path), where React
 * warns about layout effects. The DOM-write effects it guards are no-ops
 * without a DOM anyway.
 */
export const useIsomorphicLayoutEffect =
  typeof document !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Feed the container's measured width into the store, and keep the
 * `responsive:'scale'` canvas scaled.
 *
 * Shared by the editor and the read-only adapter — both measure, neither lets
 * measurement rewrite the stylesheet (§6: measurement feeds interaction math
 * and the active-size computation, nothing else).
 *
 * Two deliberate behaviours:
 * - A measurement of `0` is IGNORED. A container inside a closed `<details>`,
 *   a hidden tab panel or an unattached tree measures zero, and collapsing the
 *   whole dashboard into tier-3 stacking because a panel is hidden is a bug the
 *   user sees the moment they open the panel again.
 * - `forcedSize` (the `size` prop) pins the measured width to that named size's
 *   `maxWidth`, which is how Storybook/tests render a breakpoint on a desktop.
 */
export function useContainerMeasure(
  store: VizbrixStore<unknown>,
  measureRef: Box<HTMLElement | null>,
  canvasRef: Box<HTMLElement | null>,
  forcedSize: string | undefined,
): void {
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;

    const measure = (): void => {
      const config = store.getDoc().container;
      const observed = el.clientWidth;

      if (config?.responsive === 'scale') {
        const baseWidth = config.base?.width ?? 0;
        const canvas = canvasRef.current;
        const factor = baseWidth > 0 && observed > 0 ? observed / baseWidth : 1;
        if (canvas) {
          // The transform goes on the WRAPPER of the canvas, never on items
          // (§4) — items keep their untransformed geometry for hit-testing.
          canvas.style.transformOrigin = 'top left';
          canvas.style.transform = factor === 1 ? '' : `scale(${factor})`;
          const baseHeight = config.base?.height;
          if (typeof baseHeight === 'number' && baseHeight > 0) {
            el.style.height = `${baseHeight * factor}px`;
          }
        }
      }

      const forced = forcedSize ? config?.sizes?.[forcedSize]?.maxWidth : undefined;
      const width = typeof forced === 'number' ? forced : observed;
      if (!(width > 0)) return;
      const height = config?.height === 'fill' ? el.clientHeight || undefined : undefined;
      store.setContainerSize(width, height);
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [store, measureRef, canvasRef, forcedSize]);
}

/**
 * Reconcile an incoming document prop into the store.
 *
 * Returns true when a replacement was applied. The identity checks are the
 * whole contract: a document that is already the store's current document, or
 * the exact object the store just emitted, is an ECHO and must not be
 * re-applied — re-applying it would clear history and fight the user mid-edit.
 * Anything else is the parent asserting a different document, including the
 * §1.15 rejection case where the parent left the prop untouched after a commit.
 */
export function syncIncomingDoc(
  store: VizbrixStore<unknown>,
  incoming: LayoutDoc<unknown> | undefined,
  lastEmitted: LayoutDoc<unknown> | null,
): boolean {
  if (incoming === undefined || incoming === null) return false;
  const currentDoc = store.getDoc();
  if (incoming === currentDoc || incoming === lastEmitted) return false;
  store.apply(
    [
      {
        type: 'replaceDoc',
        before: currentDoc as unknown as LayoutDoc<never>,
        after: incoming as unknown as LayoutDoc<never>,
      },
    ],
    { source: 'api' },
  );
  return true;
}

/* ------------------------------------------------------------------ */
/* Transient state attributes                                          */
/* ------------------------------------------------------------------ */

export type TransientKind = 'dragging' | 'resizing' | null;

/**
 * Is this item the one being moved or resized right now?
 *
 * Read, never subscribed: an item component that subscribed to the interaction
 * channel would re-render 60 times a second, which is the exact cost vizbrix
 * exists to avoid. The state attributes derived from this are written
 * imperatively by the overlay while a gesture runs (see `Overlay.tsx`), and
 * rendered by React on the commits either side of it — both read the same
 * store, so they always agree.
 */
export function transientOf(state: InteractionState, id: string): TransientKind {
  switch (state.phase) {
    case 'dragging':
      return state.ids.indexOf(id) >= 0 ? 'dragging' : null;
    case 'kb-grab':
      return state.id === id ? 'dragging' : null;
    case 'resizing':
      return state.id === id ? 'resizing' : null;
    default:
      return null;
  }
}

/** Ids currently being moved or resized. Allocation-light: usually empty. */
export function transientIds(state: InteractionState): readonly string[] {
  switch (state.phase) {
    case 'dragging':
      return state.ids;
    case 'kb-grab':
    case 'resizing':
      return [state.id];
    default:
      return NO_IDS;
  }
}

const NO_IDS: readonly string[] = Object.freeze([]);

/** Content equality for the tiny id lists above. */
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Reconcile `data-dragging` / `data-resizing` on one element. */
export function applyTransientAttrs(el: HTMLElement | null, kind: TransientKind): void {
  if (!el) return;
  if (kind === 'dragging') el.setAttribute('data-dragging', '');
  else el.removeAttribute('data-dragging');
  if (kind === 'resizing') el.setAttribute('data-resizing', '');
  else el.removeAttribute('data-resizing');
}

/** Visually hidden but announced — live regions and off-screen instructions. */
export const SR_ONLY: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

/** DOM id of the off-screen instructions node, referenced by aria-describedby. */
export function instructionsId(instanceId: string): string {
  return `vzb-${instanceId}-instructions`;
}

/**
 * Turn `useId()`'s output into something readable inside a `data-` attribute
 * and a CSS `container-name`. Deterministic, so server and client agree.
 */
export function sanitizeInstanceId(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, '');
  return cleaned.length > 0 ? `vzb${cleaned}` : 'vzb';
}
