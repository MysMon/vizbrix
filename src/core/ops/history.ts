/**
 * The undo/redo stacks.
 *
 * Deliberately dumb: this file stores transactions and nothing else. It does
 * not know what an op means, cannot rebase, and never touches a document —
 * replaying an entry is the store's job (`applyOp` + `invertOp` + `rebaseOk`).
 * Keeping the container ignorant is what lets the store decide, per entry,
 * whether a popped transaction was actually replayable and push it back if it
 * was not.
 *
 * Two rules carry the semantics:
 *
 * - **A new transaction clears the redo stack.** Editing after an undo forks
 *   the timeline; the abandoned branch is gone. Replaying an EXISTING entry is
 *   not a new edit, which is why the store moves entries between the stacks
 *   with `pushRedo` / `popUndo` instead of `push`.
 * - **Depth evicts from the bottom.** The oldest entry is dropped so the newest
 *   is always undoable — a bounded history that forgets the beginning, never
 *   the end.
 */

import type { Transaction } from '../schema/types';

/** Entries retained when the caller does not choose a depth. */
export const DEFAULT_HISTORY_DEPTH = 100;

export interface History {
  /** Record a new transaction. Clears the redo stack. */
  push(tx: Transaction): void;
  popUndo(): Transaction | undefined;
  pushRedo(tx: Transaction): void;
  popRedo(): Transaction | undefined;
  peekUndo(): Transaction | undefined;
  peekRedo(): Transaction | undefined;
  /** Drop both stacks (document replacement, mode reset, teardown). */
  clear(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

function usable(tx: unknown): tx is Transaction {
  return (
    typeof tx === 'object' &&
    tx !== null &&
    Array.isArray((tx as Transaction).ops) &&
    (tx as Transaction).ops.length > 0
  );
}

/**
 * Create a pair of bounded transaction stacks.
 *
 * @param depth maximum entries kept on the undo stack; defaults to
 * {@link DEFAULT_HISTORY_DEPTH}. `0` disables history retention entirely while
 * keeping the interface live (pushes are dropped, `canUndo()` stays false),
 * which is what a read-only surface wants.
 */
export function createHistory(depth: number = DEFAULT_HISTORY_DEPTH): History {
  const limit =
    typeof depth === 'number' && Number.isFinite(depth) ? Math.max(0, Math.floor(depth)) : DEFAULT_HISTORY_DEPTH;

  const undoStack: Transaction[] = [];
  const redoStack: Transaction[] = [];

  return {
    push(tx) {
      // An empty transaction is not an edit; recording one would give the user
      // an undo step that visibly does nothing (spec §8).
      if (!usable(tx)) return;
      redoStack.length = 0;
      if (limit === 0) return;
      undoStack.push(tx);
      // Evict from the bottom: the oldest entry is the one nobody misses.
      if (undoStack.length > limit) undoStack.splice(0, undoStack.length - limit);
    },

    popUndo() {
      return undoStack.pop();
    },

    pushRedo(tx) {
      if (!usable(tx) || limit === 0) return;
      redoStack.push(tx);
      if (redoStack.length > limit) redoStack.splice(0, redoStack.length - limit);
    },

    popRedo() {
      return redoStack.pop();
    },

    peekUndo() {
      return undoStack[undoStack.length - 1];
    },

    peekRedo() {
      return redoStack[redoStack.length - 1];
    },

    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
    },

    canUndo() {
      return undoStack.length > 0;
    },

    canRedo() {
      return redoStack.length > 0;
    },
  };
}
