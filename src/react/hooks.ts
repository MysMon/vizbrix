/**
 * Public hooks (§11).
 *
 * Each one subscribes to exactly the channel it needs and nothing more —
 * `useSelection` does not re-render on a move, `useHistory` does not re-render
 * on a selection change, and neither of them ever re-renders during a gesture.
 * All three return identity-stable snapshots so they are safe as effect
 * dependencies.
 */

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import type { LayoutItem, Rect, VizbrixStore, VizbrixStrings } from '../core/schema/types';
import { useVizbrixContext } from './context';

/* ------------------------------------------------------------------ */
/* useVizbrix                                                          */
/* ------------------------------------------------------------------ */

export interface VizbrixApi<TData = undefined> {
  /** The live store. Every mutation goes through it. */
  store: VizbrixStore<TData>;
  instanceId: string;
  mode: 'view' | 'edit';
  isEditing: boolean;
  strings: VizbrixStrings;
  /** Start a tap-to-place session (WCAG 2.2 SC 2.5.7). No-op in view mode. */
  beginPlace(id: string): void;
  /** Finish a tap-to-place session at a point in CONTAINER coordinates. */
  completePlace(point: { x: number; y: number }): void;
  cancelPlace(): void;
}

/**
 * Access the surrounding dashboard. Throws outside a provider — a hook that
 * silently returned `null` would push the same error one stack frame deeper.
 *
 * The returned object is stable across renders; nothing on it is reactive, so
 * read live state through the store's channels (or `useSelection` /
 * `useHistory`) rather than snapshotting it here.
 */
export function useVizbrix<TData = undefined>(): VizbrixApi<TData> {
  const { store, instanceId, mode, strings, controllerRef } = useVizbrixContext();
  return useMemo<VizbrixApi<TData>>(
    () => ({
      store: store as unknown as VizbrixStore<TData>,
      instanceId,
      mode,
      isEditing: mode === 'edit',
      strings,
      beginPlace: (id: string) => controllerRef.current?.beginPlace(id),
      completePlace: (point: { x: number; y: number }) =>
        controllerRef.current?.completePlace(point),
      cancelPlace: () => controllerRef.current?.cancelPlace(),
    }),
    [store, instanceId, mode, strings, controllerRef],
  );
}

/* ------------------------------------------------------------------ */
/* useHistory                                                          */
/* ------------------------------------------------------------------ */

export interface HistoryApi {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
  /** Rendered through `strings.undoLabel(tx)`, e.g. "Move Revenue chart (md)". */
  undoLabel?: string;
  redoLabel?: string;
}

interface HistorySnapshot {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | undefined;
  redoLabel: string | undefined;
}

/**
 * Undo/redo state, refreshed on every commit.
 *
 * Both stacks are frozen in view mode by the store itself, so a read-only
 * dashboard reports `canUndo: false` without the adapter special-casing it.
 */
export function useHistory(): HistoryApi {
  const { store, strings } = useVizbrixContext();
  const cache = useRef<HistorySnapshot | null>(null);

  const subscribe = useCallback((cb: () => void) => store.subscribeDoc(cb), [store]);

  const getSnapshot = useCallback((): HistorySnapshot => {
    const undoTx = store.peekUndo();
    const redoTx = store.peekRedo();
    const next: HistorySnapshot = {
      canUndo: store.canUndo(),
      canRedo: store.canRedo(),
      undoLabel: undoTx ? strings.undoLabel(undoTx) : undefined,
      redoLabel: redoTx ? strings.redoLabel(redoTx) : undefined,
    };
    const prev = cache.current;
    if (
      prev !== null &&
      prev.canUndo === next.canUndo &&
      prev.canRedo === next.canRedo &&
      prev.undoLabel === next.undoLabel &&
      prev.redoLabel === next.redoLabel
    ) {
      return prev;
    }
    cache.current = next;
    return next;
  }, [store, strings]);

  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo<HistoryApi>(
    () => ({
      canUndo: snap.canUndo,
      canRedo: snap.canRedo,
      undoLabel: snap.undoLabel,
      redoLabel: snap.redoLabel,
      undo: () => void store.undo(),
      redo: () => void store.redo(),
    }),
    [snap, store],
  );
}

/* ------------------------------------------------------------------ */
/* useSelection                                                        */
/* ------------------------------------------------------------------ */

export interface SelectionApi {
  ids: readonly string[];
  set(ids: readonly string[]): void;
  clear(): void;
}

/** The current selection. Re-renders only when the selection itself changes. */
export function useSelection(): SelectionApi {
  const { store } = useVizbrixContext();
  const subscribe = useCallback((cb: () => void) => store.subscribeSelection(cb), [store]);
  // The store hands out a frozen array that is replaced only on real change,
  // so this is already identity-stable.
  const getSnapshot = useCallback(() => store.getSelection(), [store]);
  const ids = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo<SelectionApi>(
    () => ({
      ids,
      set: (next: readonly string[]) => store.setSelection(next),
      clear: () => store.setSelection([]),
    }),
    [ids, store],
  );
}

/* ------------------------------------------------------------------ */
/* useVizbrixItem                                                      */
/* ------------------------------------------------------------------ */

export interface ItemStateApi<TData = undefined> {
  /** The persisted item, or undefined once it has been removed. */
  item: LayoutItem<TData> | undefined;
  /** Resolved at the current measured width (base width on the server). */
  rect: Rect | undefined;
  isSelected: boolean;
}

/**
 * Subscribe to ONE item's committed state from anywhere inside the provider —
 * an inspector panel, a properties sidebar, a badge. Re-renders only when that
 * item's snapshot changes: never on a sibling's commit, never during a
 * gesture, exactly like the item shells themselves.
 */
export function useVizbrixItem<TData = undefined>(id: string): ItemStateApi<TData> {
  const { store } = useVizbrixContext();
  const subscribe = useCallback((cb: () => void) => store.subscribeItem(id, cb), [store, id]);
  const getSnapshot = useCallback(() => store.getItemView(id), [store, id]);
  const getServerSnapshot = useCallback(() => store.getServerItemView(id), [store, id]);
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return useMemo<ItemStateApi<TData>>(
    () => ({
      item: snap?.item as LayoutItem<TData> | undefined,
      rect: snap?.rect,
      isSelected: snap?.selected === true,
    }),
    [snap],
  );
}
