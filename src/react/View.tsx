/**
 * `<VizbrixView>` — the read-only surface (`vizbrix/react/view`).
 *
 * Same render contract as `<Vizbrix>`, same geometry, byte-identical CSS — and
 * none of the editing machinery: no interaction controller, no overlay, no
 * history, no editing ARIA, no keyboard sensor. §1.16 is explicit that view
 * mode attaches no listeners at all rather than attaching no-op guarded ones,
 * which is why this is a separate entry point and not a prop.
 *
 * It keeps the ResizeObserver: measurement drives the active-size computation
 * and therefore which rect the render callback sees. It is the only browser API
 * this surface touches.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { ContainerConfig, LayoutDoc, LayoutItemBase, VizbrixStore, VizbrixStrings } from '../core/schema/types';
// Type-only: erased at build time, so this entry point still ships without the
// interaction layer.
import type { InteractionController } from '../core/interact/controller';
import { createStore } from '../core/store/store';
import { defaultStrings } from '../core/locales/en';
import type { AnnounceTargets, AnyItemRenderer, ItemRenderer, VizbrixRuntime } from './context';
import {
  VizbrixContext,
  sanitizeInstanceId,
  syncIncomingDoc,
  useContainerMeasure,
} from './context';
import { Item } from './Item';
import { StyleSheet } from './StyleSheet';

export interface VizbrixViewProps<TData = undefined> {
  /** The document to display. Changing it replaces the rendered document. */
  layout: LayoutDoc<TData>;
  /** Force a named container size (tests, Storybook). */
  size?: string;
  instanceId?: string;
  className?: string;
  style?: CSSProperties;
  strings?: VizbrixStrings;
  getLabel?: (item: LayoutItemBase) => string;
  children: ItemRenderer<TData>;
  /**
   * Escape hatch for a `children` callback that closes over changing state.
   * Items do not re-render when `children` merely changes identity (§1.25 — see
   * `context.ts`); change `renderKey` to force them to.
   */
  renderKey?: unknown;
}

function defaultLabel(item: LayoutItemBase): string {
  return item.id;
}

const NO_ANNOUNCE: AnnounceTargets = { assertive: null, polite: null };

export function VizbrixView<TData = undefined>(props: VizbrixViewProps<TData>): ReactElement {
  const {
    layout,
    size,
    instanceId: instanceIdProp,
    className,
    style,
    strings = defaultStrings,
    getLabel = defaultLabel,
    children,
    renderKey,
  } = props;

  const reactId = useId();
  const instanceId = instanceIdProp ?? sanitizeInstanceId(reactId);

  // Always constructed in view mode: history is frozen and every mutating entry
  // point is inert, so a read-only dashboard cannot accumulate undo state.
  const [store] = useState<VizbrixStore<unknown>>(() =>
    createStore(layout as LayoutDoc<unknown>, { mode: 'view' }),
  );
  // The last document handed to the store, as handed over. Seeded with the
  // construction document: the store REPAIRS what it adopts (non-canonical `z`
  // keys), so `getDoc()` is not this object and the mount effect would otherwise
  // replay the raw prop straight back over the repair.
  const adoptedRef = useRef<LayoutDoc<unknown> | null>(layout as LayoutDoc<unknown>);

  // Silent, identical to `<Vizbrix>`: a new `children` identity must not
  // re-render every item. See the note at the top of `context.ts`.
  const renderRef = useRef<AnyItemRenderer>(children as unknown as AnyItemRenderer);
  renderRef.current = children as unknown as AnyItemRenderer;
  useEffect(() => {
    renderRef.current = children as unknown as AnyItemRenderer;
  }, [children]);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLDivElement | null>(null);
  const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null);
  const setCanvas = useCallback((el: HTMLDivElement | null) => {
    canvasRef.current = el;
    setCanvasEl(el);
  }, []);
  const setWrapper = useCallback((el: HTMLDivElement | null) => {
    wrapperRef.current = el;
    setWrapperEl(el);
  }, []);
  // Always null here: nothing in this entry point can create a controller.
  const controllerRef = useRef<InteractionController | null>(null);
  const announceRef = useRef<AnnounceTargets>(NO_ANNOUNCE);

  const subscribeDoc = useCallback((cb: () => void) => store.subscribeDoc(cb), [store]);
  const getContainer = useCallback(() => store.getDoc().container, [store]);
  const container: ContainerConfig = useSyncExternalStore(subscribeDoc, getContainer, getContainer);
  const scaled = container?.responsive === 'scale';

  const subscribeOrder = useCallback((cb: () => void) => store.subscribeOrder(cb), [store]);
  const getOrder = useCallback(() => store.getOrder(), [store]);
  const ids = useSyncExternalStore(subscribeOrder, getOrder, getOrder);

  useContainerMeasure(
    store,
    scaled ? wrapperRef : canvasRef,
    canvasRef,
    size,
    scaled ? wrapperEl : canvasEl,
  );

  useEffect(() => {
    syncIncomingDoc(store, layout as LayoutDoc<unknown>, adoptedRef.current);
    adoptedRef.current = layout as LayoutDoc<unknown>;
  }, [store, layout]);

  const runtime = useMemo<VizbrixRuntime>(
    () => ({
      store,
      instanceId,
      mode: 'view',
      strings,
      getLabel,
      controllerRef,
      renderRef,
      renderKey,
      announceRef,
    }),
    [store, instanceId, strings, getLabel, renderKey],
  );

  const canvas = (
    <div
      ref={setCanvas}
      data-vzb={instanceId}
      data-vzb-mode="view"
      className={scaled ? undefined : className}
      style={scaled ? undefined : style}
    >
      <StyleSheet />
      {ids.map((id) => (
        <Item key={id} id={id} />
      ))}
    </div>
  );

  return (
    <VizbrixContext.Provider value={runtime}>
      {scaled ? (
        <div ref={setWrapper} className={className} style={{ ...style, overflow: 'hidden' }}>
          {canvas}
        </div>
      ) : (
        canvas
      )}
    </VizbrixContext.Provider>
  );
}
