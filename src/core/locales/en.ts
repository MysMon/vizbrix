/**
 * Built-in English strings — the default `VizbrixStrings` implementation.
 *
 * Every method returns a complete, natural sentence (or short sequence of
 * sentences) rather than a fragment, because the contract is FUNCTIONS, not
 * templates (§1.24): a translator is free to reorder clauses, drop a clause
 * a language doesn't need, or add particles/counters a template-substitution
 * approach could never express. `fromMessages` (`../a11y/announce.ts`) is
 * the degraded, template-shaped adapter for TMS pipelines that can only ship
 * flat JSON — this file is the primary contract.
 *
 * Coordinates are rounded to whole px for announcement — nobody needs
 * sub-pixel precision read aloud by a screen reader.
 */

import type { ItemStringContext, Transaction, VizbrixStrings } from '../schema/types';

const round = (n: number): number => Math.round(n);

/** Verb used in undo/redo history labels, keyed by `Transaction['label']['kind']`. */
const KIND_VERB: Record<Transaction['label']['kind'], string> = {
  move: 'move',
  resize: 'resize',
  add: 'add',
  remove: 'remove',
  reorder: 'reorder',
  edit: 'edit',
};

/** "Undo move: revenue" / "Redo resize: a, b (md)" */
function historyLabel(verbPrefix: 'Undo' | 'Redo', tx: Transaction): string {
  const verb = KIND_VERB[tx.label.kind];
  const ids = tx.label.ids.join(', ');
  const sizeSuffix = tx.label.size !== undefined ? ` (${tx.label.size})` : '';
  return `${verbPrefix} ${verb}: ${ids}${sizeSuffix}`;
}

export const en: VizbrixStrings = {
  itemRole(): string {
    return 'draggable widget';
  },

  instructions(): string {
    return (
      'Press Enter or Space to grab this widget, then use the arrow keys to move it — ' +
      'hold Shift for larger, 10 pixel steps. Press Enter or Space again to drop it in place, ' +
      'or press Escape to cancel and return it to its original position. ' +
      'Hold Command or Control and press the left or right bracket key to send it backward ' +
      'or bring it forward in the stacking order. ' +
      'Press Delete or Backspace to remove the selected widget.'
    );
  },

  grabbed(ctx: ItemStringContext): string {
    return (
      `${ctx.label} grabbed. Position ${ctx.position} of ${ctx.count}. ` +
      `${round(ctx.x)}, ${round(ctx.y)}.`
    );
  },

  moved(ctx: ItemStringContext): string {
    return `${ctx.label} moved. ${round(ctx.x)}, ${round(ctx.y)}.`;
  },

  dropped(ctx: ItemStringContext): string {
    return `${ctx.label} dropped. Position ${ctx.position} of ${ctx.count}. ${round(ctx.x)}, ${round(ctx.y)}.`;
  },

  canceled(ctx: ItemStringContext): string {
    return `${ctx.label} move canceled. Returned to ${round(ctx.x)}, ${round(ctx.y)}.`;
  },

  resized(ctx: ItemStringContext): string {
    return `${ctx.label} resized. ${round(ctx.w)} by ${round(ctx.h)} pixels.`;
  },

  removed(ctx: ItemStringContext): string {
    return `${ctx.label} removed. ${ctx.count} widgets remaining.`;
  },

  placingStarted(ctx: ItemStringContext): string {
    return `Placing ${ctx.label}. Choose a location and press Enter to place it, or press Escape to cancel.`;
  },

  placed(ctx: ItemStringContext): string {
    return `${ctx.label} placed. ${round(ctx.x)}, ${round(ctx.y)}.`;
  },

  reordered(ctx: ItemStringContext & { direction: 'front' | 'back' }): string {
    const where = ctx.direction === 'front' ? 'brought to front' : 'sent to back';
    return `${ctx.label} ${where}. Position ${ctx.position} of ${ctx.count}.`;
  },

  undoLabel(tx: Transaction): string {
    return historyLabel('Undo', tx);
  },

  redoLabel(tx: Transaction): string {
    return historyLabel('Redo', tx);
  },

  moveButtonLabel(ctx: ItemStringContext): string {
    return `Move ${ctx.label}`;
  },
};

/** Alias for the default strings passed to `VizbrixProps.strings` / `createStore`. */
export const defaultStrings: VizbrixStrings = en;
