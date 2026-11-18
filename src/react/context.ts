import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Messages } from '../core/messages';
import type { DashboardState, DashboardStore } from '../core/store';
import type { DashboardItem } from '../core/types';
import type { BrickRegistry, DataMap } from './brick';

export interface DashboardContextValue {
  store: DashboardStore;
  bricks: BrickRegistry;
  data: DataMap;
  messages: Messages;
  editable: boolean;
  onEditItem?: (item: DashboardItem) => void;
  renderItem?: (item: DashboardItem, state: { editing: boolean }) => React.ReactNode;
  announce: (text: string) => void;
  /** Request edit mode on/off (routes through the controlled prop when there is one). */
  setEditing: (editing: boolean) => void;
  /** Scroll a brick into view and focus it. */
  reveal: (id: string) => void;
}

export const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboardContext(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('vizbrix: this component must be rendered inside <Dashboard>.');
  return ctx;
}

/**
 * Subscribe to a slice of dashboard state. The selector must return a
 * primitive or a reference taken from the state — a fresh object every call
 * would re-render on every store change.
 */
export function useDashboardState<T>(selector: (state: DashboardState) => T): T {
  const { store } = useDashboardContext();
  const get = (): T => selector(store.getState());
  return useSyncExternalStore(store.subscribe, get, get);
}

const indexCache = new WeakMap<object, Map<string, DashboardItem>>();

export function itemById(state: DashboardState, id: string): DashboardItem | undefined {
  let index = indexCache.get(state.doc);
  if (!index) {
    index = new Map(state.doc.items.map((item) => [item.id, item as DashboardItem]));
    indexCache.set(state.doc, index);
  }
  return index.get(id);
}
