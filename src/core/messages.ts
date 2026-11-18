import type { Pin } from './types';

/**
 * Every string the editor shows or announces. Entries are plain strings or
 * functions, so a translation can reorder clauses instead of filling slots.
 */
export interface Messages {
  /** BCP 47 tag used for number and date formatting inside bricks. */
  lang: string;
  dashboard: string;
  edit: string;
  done: string;
  undo: string;
  redo: string;
  addBrick: string;
  emptyTitle: string;
  emptyHint: string;
  emptyHintEditing: string;
  brickMenu: string;
  brickFallbackName: string;
  editBrick: string;
  rename: string;
  duplicate: string;
  remove: string;
  bringToFront: string;
  sendToBack: string;
  lock: string;
  unlock: string;
  positionAndSize: string;
  x: string;
  y: string;
  width: string;
  height: string;
  pinLabel: string;
  pin: Record<Pin, string>;
  variantLabel: (name: string) => string;
  autoLayout: string;
  customLayout: string;
  resetLayout: string;
  unknownBrick: (type: string) => string;
  brickError: string;
  retry: string;
  resizeHandle: string;
  itemInstructions: string;
  // Live-region announcements
  moved: (name: string, x: number, y: number) => string;
  resized: (name: string, w: number, h: number) => string;
  added: (name: string) => string;
  removed: (count: number) => string;
  duplicated: (count: number) => string;
  undone: string;
  redone: string;
  cancelled: string;
}

export const en: Messages = {
  lang: 'en',
  dashboard: 'Dashboard',
  edit: 'Edit',
  done: 'Done',
  undo: 'Undo',
  redo: 'Redo',
  addBrick: 'Add',
  emptyTitle: 'Nothing here yet',
  emptyHint: 'This dashboard has no bricks.',
  emptyHintEditing: 'Use “Add” to place your first brick.',
  brickMenu: 'Brick options',
  brickFallbackName: 'Brick',
  editBrick: 'Edit…',
  rename: 'Rename',
  duplicate: 'Duplicate',
  remove: 'Remove',
  bringToFront: 'Bring to front',
  sendToBack: 'Send to back',
  lock: 'Lock',
  unlock: 'Unlock',
  positionAndSize: 'Position and size',
  x: 'X',
  y: 'Y',
  width: 'W',
  height: 'H',
  pinLabel: 'When the width changes',
  pin: {
    scale: 'Scale',
    left: 'Pin left',
    right: 'Pin right',
    stretch: 'Stretch',
    center: 'Keep centred',
  },
  variantLabel: (name) => `Layout: ${name}`,
  autoLayout: 'auto',
  customLayout: 'custom',
  resetLayout: 'Reset to automatic',
  unknownBrick: (type) => `Unknown brick type “${type}”`,
  brickError: 'This brick failed to render.',
  retry: 'Retry',
  resizeHandle: 'Resize',
  itemInstructions:
    'Arrow keys move, Shift plus arrow keys resize, Alt for fine steps. Delete removes, Control D duplicates.',
  moved: (name, x, y) => `${name} moved to ${x}, ${y}`,
  resized: (name, w, h) => `${name} resized to ${w} by ${h}`,
  added: (name) => `${name} added`,
  removed: (count) => (count === 1 ? 'Brick removed' : `${count} bricks removed`),
  duplicated: (count) => (count === 1 ? 'Brick duplicated' : `${count} bricks duplicated`),
  undone: 'Undone',
  redone: 'Redone',
  cancelled: 'Cancelled',
};
