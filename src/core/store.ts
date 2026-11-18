import * as ops from './ops';
import { BASE, type DashboardDoc, type Rect } from './types';

type Doc = DashboardDoc<unknown>;

export interface DashboardState {
  doc: Doc;
  /** Selected brick ids, in selection order. */
  selection: readonly string[];
  editing: boolean;
  /** Variant the dashboard is currently displaying (set by the adapter). */
  variant: string;
  canUndo: boolean;
  canRedo: boolean;
}

/** What produced a change, for labels, analytics and persistence decisions. */
export type ChangeReason =
  | 'move'
  | 'resize'
  | 'add'
  | 'remove'
  | 'duplicate'
  | 'update'
  | 'reorder'
  | 'reset-layout'
  | 'undo'
  | 'redo';

export interface ChangeMeta {
  reason: ChangeReason;
  /** Bricks the change touched. */
  ids: readonly string[];
}

export interface CommitOptions extends ChangeMeta {
  /**
   * Consecutive commits with the same key within a short window collapse
   * into one undo step (keyboard nudges, typing in an inspector field).
   */
  coalesce?: string;
}

export interface StoreOptions {
  doc: Doc;
  editing?: boolean;
  /** Max undo steps kept. */
  historyLimit?: number;
  onChange?: (doc: Doc, meta: ChangeMeta) => void;
}

export interface DashboardStore {
  getState(): DashboardState;
  subscribe(listener: () => void): () => void;
  /** Replace the document as one undoable step. No-op if `doc` is unchanged. */
  commit(doc: Doc, options: CommitOptions): void;
  /** Swap in an externally supplied document (controlled mode). Not undoable. */
  replace(doc: Doc): void;
  undo(): void;
  redo(): void;
  select(ids: readonly string[]): void;
  setEditing(editing: boolean): void;
  setVariant(variant: string): void;
  setOnChange(fn: StoreOptions['onChange']): void;

  // Convenience commands. Each is a single undo step.
  add(item: ops.NewItem): string;
  remove(ids?: readonly string[]): void;
  duplicate(ids?: readonly string[]): string[];
  update(id: string, patch: ops.ItemPatch, coalesce?: string): void;
  setRects(updates: Readonly<Record<string, Rect>>, reason?: 'move' | 'resize', coalesce?: string): void;
  reorder(id: string, to: 'front' | 'back'): void;
  resetLayout(variant?: string): void;
}

const COALESCE_MS = 1200;

export function createDashboardStore(options: StoreOptions): DashboardStore {
  const limit = options.historyLimit ?? 100;
  let onChange = options.onChange;
  let past: Doc[] = [];
  let future: Doc[] = [];
  let lastCoalesce: { key: string; at: number } | null = null;
  const listeners = new Set<() => void>();

  let state: DashboardState = {
    doc: options.doc,
    selection: [],
    editing: options.editing ?? false,
    variant: BASE,
    canUndo: false,
    canRedo: false,
  };

  const set = (patch: Partial<DashboardState>): void => {
    state = { ...state, ...patch, canUndo: past.length > 0, canRedo: future.length > 0 };
    for (const listener of [...listeners]) listener();
  };

  const pruneSelection = (doc: Doc, selection: readonly string[]): readonly string[] => {
    const ids = new Set(doc.items.map((i) => i.id));
    const next = selection.filter((id) => ids.has(id));
    return next.length === selection.length ? selection : next;
  };

  const store: DashboardStore = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    commit(doc, opts) {
      if (doc === state.doc) return;
      const now = Date.now();
      const merge =
        opts.coalesce !== undefined &&
        lastCoalesce !== null &&
        lastCoalesce.key === opts.coalesce &&
        now - lastCoalesce.at < COALESCE_MS &&
        past.length > 0;
      if (!merge) {
        past.push(state.doc);
        if (past.length > limit) past = past.slice(past.length - limit);
      }
      future = [];
      lastCoalesce = opts.coalesce !== undefined ? { key: opts.coalesce, at: now } : null;
      set({ doc, selection: pruneSelection(doc, state.selection) });
      onChange?.(doc, { reason: opts.reason, ids: opts.ids });
    },
    replace(doc) {
      if (doc === state.doc) return;
      lastCoalesce = null;
      set({ doc, selection: pruneSelection(doc, state.selection) });
    },
    undo() {
      const previous = past.pop();
      if (!previous) return;
      future.push(state.doc);
      lastCoalesce = null;
      set({ doc: previous, selection: pruneSelection(previous, state.selection) });
      onChange?.(previous, { reason: 'undo', ids: [] });
    },
    redo() {
      const next = future.pop();
      if (!next) return;
      past.push(state.doc);
      lastCoalesce = null;
      set({ doc: next, selection: pruneSelection(next, state.selection) });
      onChange?.(next, { reason: 'redo', ids: [] });
    },
    select(ids) {
      const next = pruneSelection(state.doc, [...new Set(ids)]);
      if (next.length === state.selection.length && next.every((id, i) => id === state.selection[i])) return;
      set({ selection: next });
    },
    setEditing(editing) {
      if (editing === state.editing) return;
      set({ editing, selection: editing ? state.selection : [] });
    },
    setVariant(variant) {
      if (variant !== state.variant) set({ variant });
    },
    setOnChange(fn) {
      onChange = fn;
    },

    add(item) {
      const result = ops.addItem(state.doc, item);
      store.commit(result.doc, { reason: 'add', ids: [result.id] });
      set({ selection: [result.id] });
      return result.id;
    },
    remove(ids = state.selection) {
      store.commit(ops.removeItems(state.doc, ids), { reason: 'remove', ids });
    },
    duplicate(ids = state.selection) {
      const result = ops.duplicateItems(state.doc, ids);
      store.commit(result.doc, { reason: 'duplicate', ids: result.ids });
      if (result.ids.length) set({ selection: result.ids });
      return result.ids;
    },
    update(id, patch, coalesce) {
      store.commit(ops.updateItem(state.doc, id, patch), { reason: 'update', ids: [id], coalesce });
    },
    setRects(updates, reason = 'move', coalesce) {
      store.commit(ops.setRects(state.doc, state.variant, updates), {
        reason,
        ids: Object.keys(updates),
        coalesce,
      });
    },
    reorder(id, to) {
      store.commit(ops.reorderItem(state.doc, id, to), { reason: 'reorder', ids: [id] });
    },
    resetLayout(variant = state.variant) {
      store.commit(ops.resetVariant(state.doc, variant), { reason: 'reset-layout', ids: [] });
    },
  };
  return store;
}
