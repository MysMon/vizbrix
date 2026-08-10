/**
 * `<Vizbrix>` — the editor surface.
 *
 * Everything below is arranged around four contracts from the spec:
 *
 * - **StrictMode safety (§1.22).** The store is created inside a `useState`
 *   initializer (construction touches no globals, so a discarded double
 *   construction costs nothing), every subscription and observer lives in a
 *   symmetric effect, and no store is ever assigned to a ref during render.
 * - **Controlled mode (§1.15).** A commit lands in the store FIRST and is
 *   reported to the parent afterwards, so a slow parent can never stutter a
 *   drag. Rejection is detected as "the prop did not change at all after a
 *   commit" — not as "the prop is not what I asked for", because a parent is
 *   entitled to transform what it stores.
 * - **Mode default `'view'` (§1.16).** No interaction controller is created, no
 *   listener is attached, no overlay is mounted, no editing ARIA is emitted.
 *   The geometry is byte-identical to edit mode.
 * - **Render precision (§1.25).** This component re-renders on container-config
 *   changes and (in controlled mode) once per commit. Items do not follow it:
 *   they are memoized, and the context value is memoized on inputs that do not
 *   change per commit.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type {
  ContainerConfig,
  LayoutDoc,
  LayoutItemBase,
  LoadOutcome,
  SnapConfig,
  Transaction,
  TxResult,
  VizbrixStore,
  VizbrixStrings,
} from '../core/schema/types';
import { SCHEMA_VERSION } from '../core/schema/types';
import { validate } from '../core/schema/validate';
import { createStore } from '../core/store/store';
import { createInteractionController } from '../core/interact/controller';
import type { InteractionController } from '../core/interact/controller';
import { defaultStrings } from '../core/locales/en';
import type { AnnounceTargets, AnyItemRenderer, ItemRenderer, VizbrixRuntime } from './context';
import {
  VizbrixContext,
  sanitizeInstanceId,
  syncIncomingDoc,
  useContainerMeasure,
} from './context';
import { Item } from './Item';
import { Overlay, announceTo } from './Overlay';
import { StyleSheet } from './StyleSheet';

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export interface VizbrixProps<TData = undefined> {
  /** Controlled document. Mutually exclusive with `defaultLayout`. */
  layout?: LayoutDoc<TData>;
  /** Uncontrolled initial document. Later changes to it are ignored. */
  defaultLayout?: LayoutDoc<TData>;
  /** Fires after every committed transaction, with the new doc and that tx. */
  onLayoutChange?: (doc: LayoutDoc<NoInfer<TData>>, tx: Transaction) => void;
  /** Default `'view'`. */
  mode?: 'view' | 'edit';
  snap?: SnapConfig | false;
  /** Touch activation delay in ms; `'off'` switches to a 3px threshold. */
  longPress?: number | 'off';
  strings?: VizbrixStrings;
  /** Force a named container size (tests, Storybook). */
  size?: string;
  /** Stable id for CSS scoping. Defaults to `useId()`. */
  instanceId?: string;
  className?: string;
  /** Root passthrough. Never used for item placement. */
  style?: CSSProperties;
  /** Human label for an item, used in announcements and undo labels. */
  getLabel?: (item: LayoutItemBase) => string;
  /** Mirror of what the live regions announce, e.g. for a toast system. */
  onAnnounce?: (message: string, tone: 'assertive' | 'polite') => void;
  children: ItemRenderer<TData>;
  /** Rendered instead of the dashboard when the document cannot be shown. */
  renderIncompatible?: (outcome: LoadOutcome) => ReactNode;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const EMPTY_DOC: LayoutDoc<unknown> = {
  version: SCHEMA_VERSION,
  // A width is required by the schema; with no items it only fixes the unit of
  // px offsets for whatever gets added later.
  container: { base: { width: 1200 } },
  items: [],
};

function defaultLabel(item: LayoutItemBase): string {
  return item.id;
}

/**
 * Is this document renderable at all?
 *
 * Only consulted when the consumer passed `renderIncompatible` — the component
 * takes a `LayoutDoc`, so the expensive `load()` path belongs at the app's
 * persistence boundary, not on every render of the dashboard.
 */
function incompatibilityOf(doc: LayoutDoc<unknown> | undefined): LoadOutcome | null {
  if (!doc || typeof doc !== 'object') {
    return {
      status: 'invalid',
      errors: [{ severity: 'error', path: '', message: 'no layout document was provided' }],
    };
  }
  const compat = typeof doc.compat === 'number' ? doc.compat : 1;
  if (compat > SCHEMA_VERSION) {
    return {
      status: 'incompatible',
      reason: `this document requires a reader of at least schema version ${compat}; this build reads version ${SCHEMA_VERSION}`,
      compat,
    };
  }
  const errors = validate(doc).filter((issue) => issue.severity === 'error');
  return errors.length > 0 ? { status: 'invalid', errors } : null;
}

/**
 * Wrap a store so every applied transaction is reported exactly once.
 *
 * The alternative — subscribing to the document channel — cannot say WHICH
 * transaction landed, and `onLayoutChange`'s second argument is the whole point
 * of the API (§1.15: never stamp transaction metadata onto the document). The
 * store is a flat object of closures, so a spread wrapper is complete and
 * `this`-free.
 */
function instrumentStore<TData>(
  store: VizbrixStore<TData>,
  onTx: (tx: Transaction) => void,
): VizbrixStore<TData> {
  const wrap =
    <A extends unknown[]>(fn: (...args: A) => TxResult) =>
    (...args: A): TxResult => {
      const result = fn(...args);
      if (result.status === 'applied' && result.tx) onTx(result.tx);
      return result;
    };
  return {
    ...store,
    apply: wrap(store.apply),
    moveItem: wrap(store.moveItem),
    resizeItem: wrap(store.resizeItem),
    addItem: wrap(store.addItem),
    removeItem: wrap(store.removeItem),
    bringToFront: wrap(store.bringToFront),
    sendToBack: wrap(store.sendToBack),
    setAnchor: wrap(store.setAnchor),
    undo: wrap(store.undo),
    redo: wrap(store.redo),
  };
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function Vizbrix<TData = undefined>(props: VizbrixProps<TData>): ReactElement {
  const {
    layout,
    defaultLayout,
    onLayoutChange,
    mode = 'view',
    snap,
    longPress,
    strings = defaultStrings,
    size,
    instanceId: instanceIdProp,
    className,
    style,
    getLabel = defaultLabel,
    onAnnounce,
    children,
    renderIncompatible,
  } = props;

  const controlled = layout !== undefined;
  const reactId = useId();
  const instanceId = instanceIdProp ?? sanitizeInstanceId(reactId);

  const incompatible = useMemo(
    () => (renderIncompatible ? incompatibilityOf((layout ?? defaultLayout) as LayoutDoc<unknown>) : null),
    [renderIncompatible, layout, defaultLayout],
  );

  /* ---------------- store ---------------- */

  const txSinkRef = useRef<((tx: Transaction) => void) | null>(null);
  const [store] = useState<VizbrixStore<unknown>>(() => {
    const initial = (layout ?? defaultLayout ?? EMPTY_DOC) as LayoutDoc<unknown>;
    const seed = incompatibilityOf(initial) ? EMPTY_DOC : initial;
    return instrumentStore(createStore(seed, { mode }), (tx) => txSinkRef.current?.(tx));
  });

  /* ---------------- latest-value refs ---------------- */

  const onLayoutChangeRef = useRef(onLayoutChange);
  const onAnnounceRef = useRef(onAnnounce);
  const lastEmittedRef = useRef<LayoutDoc<unknown> | null>(null);
  const syncingRef = useRef(false);
  const controlledRef = useRef(controlled);
  const [commitTick, setCommitTick] = useState(0);

  useEffect(() => {
    onLayoutChangeRef.current = onLayoutChange;
    onAnnounceRef.current = onAnnounce;
    controlledRef.current = controlled;
  });

  useEffect(() => {
    txSinkRef.current = (tx: Transaction) => {
      // The reconciliation replaceDoc below is the parent's own document coming
      // back in; echoing it out again would be a loop with extra steps.
      if (syncingRef.current) return;
      const doc = store.getDoc();
      lastEmittedRef.current = doc;
      onLayoutChangeRef.current?.(doc as unknown as LayoutDoc<TData>, tx);
      // Rejection detection needs a render after every commit: the prop may
      // come back unchanged, and "unchanged" is only observable by looking.
      if (controlledRef.current) setCommitTick((tick) => tick + 1);
    };
    return () => {
      txSinkRef.current = null;
    };
  }, [store]);

  /* ---------------- render callback plumbing ---------------- */

  const renderRef = useRef<AnyItemRenderer>(children as unknown as AnyItemRenderer);
  const [renderVersion, setRenderVersion] = useState(0);
  useEffect(() => {
    const next = children as unknown as AnyItemRenderer;
    if (renderRef.current === next) return;
    renderRef.current = next;
    setRenderVersion((version) => version + 1);
  }, [children]);

  /* ---------------- refs into the DOM ---------------- */

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<InteractionController | null>(null);
  const announceRef = useRef<AnnounceTargets>({ assertive: null, polite: null });

  const announce = useCallback(
    (message: string, tone: 'assertive' | 'polite') => {
      announceTo(announceRef.current, message, tone);
      onAnnounceRef.current?.(message, tone);
    },
    [],
  );

  /* ---------------- container config (rarely changes) ---------------- */

  const subscribeDoc = useCallback((cb: () => void) => store.subscribeDoc(cb), [store]);
  const getContainer = useCallback(() => store.getDoc().container, [store]);
  // Item commits preserve the container object's identity, so this re-renders
  // the root only when the container configuration itself changed.
  const container: ContainerConfig = useSyncExternalStore(
    subscribeDoc,
    getContainer,
    getContainer,
  );
  const scaled = container?.responsive === 'scale';

  const subscribeOrder = useCallback((cb: () => void) => store.subscribeOrder(cb), [store]);
  const getOrder = useCallback(() => store.getOrder(), [store]);
  const ids = useSyncExternalStore(subscribeOrder, getOrder, getOrder);

  /* ---------------- effects ---------------- */

  useEffect(() => {
    store.setMode(mode);
  }, [store, mode]);

  useContainerMeasure(store, scaled ? wrapperRef : canvasRef, canvasRef, size);

  // Controlled reconciliation. Runs on every incoming prop AND after every
  // commit, which is what makes "the parent left the prop alone" observable.
  useEffect(() => {
    if (!controlled) return;
    syncingRef.current = true;
    try {
      syncIncomingDoc(store, layout as LayoutDoc<unknown>, lastEmittedRef.current);
    } finally {
      syncingRef.current = false;
    }
  }, [store, controlled, layout, commitTick]);

  // The interaction layer. Created and destroyed symmetrically so StrictMode's
  // double mount leaves exactly one controller attached.
  useEffect(() => {
    if (mode !== 'edit') return;
    const el = canvasRef.current;
    if (!el) return;
    const controller = createInteractionController(store, {
      snap,
      longPress,
      strings,
      getLabel,
      onAnnounce: announce,
    });
    controllerRef.current = controller;
    const detach = controller.attach(el);
    return () => {
      controllerRef.current = null;
      detach();
      controller.destroy();
    };
    // Deps are (store, mode) ON PURPOSE: option changes are pushed through
    // `setOptions` in the next effect. Re-creating the controller because a
    // `snap` object literal changed identity would drop an in-flight gesture.
    // The initial options are read from the render that created it.
  }, [store, mode]);

  useEffect(() => {
    controllerRef.current?.setOptions({ snap, longPress, strings, getLabel, onAnnounce: announce });
  }, [snap, longPress, strings, getLabel, announce]);

  /* ---------------- context ---------------- */

  const runtime = useMemo<VizbrixRuntime>(
    () => ({
      store,
      instanceId,
      mode,
      strings,
      getLabel,
      controllerRef,
      renderRef,
      renderVersion,
      announceRef,
    }),
    [store, instanceId, mode, strings, getLabel, renderVersion],
  );

  // NOTE: Cmd/Ctrl+Z (and ⇧Z for redo) is handled by the core keyboard sensor,
  // which owns every key the editor responds to. A second React `onKeyDown`
  // here would undo TWICE for one keystroke: the sensor's listener sits on this
  // same element and calls `preventDefault()` but not `stopPropagation()`, so
  // React's delegated handler would still run. `react.test.tsx` pins that down.

  if (incompatible && renderIncompatible) {
    return <>{renderIncompatible(incompatible)}</>;
  }

  const editing = mode === 'edit';
  const canvas = (
    <div
      ref={canvasRef}
      data-vzb={instanceId}
      data-vzb-mode={mode}
      className={scaled ? undefined : className}
      style={scaled ? undefined : style}
    >
      <StyleSheet />
      {ids.map((id) => (
        <Item key={id} id={id} />
      ))}
      {editing ? <Overlay /> : null}
    </div>
  );

  return (
    <VizbrixContext.Provider value={runtime}>
      {scaled ? (
        // `responsive:'scale'` wraps a fixed base-size canvas: the wrapper is
        // what gets measured, the canvas is what gets transformed (§4).
        <div ref={wrapperRef} className={className} style={{ ...style, overflow: 'hidden' }}>
          {canvas}
        </div>
      ) : (
        canvas
      )}
    </VizbrixContext.Provider>
  );
}
