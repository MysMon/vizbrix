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
  settings: string;
  close: string;
  none: string;
  inlineData: string;
  custom: string;
  loading: string;
  loadError: string;
  noData: string;
  tableView: string;
  resetZoom: string;
  search: string;
  brickActions: string;
  exportCsv: string;
  exportPng: string;
  alignLabel: string;
  align: Record<'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' | 'distributeX' | 'distributeY', string>;
  /** Labels for brick setting fields, keyed by prop name. */
  fields: Readonly<Record<string, string>>;
  /** Labels for setting option values. */
  options: Readonly<Record<string, string>>;
  selected: (count: number) => string;
  pasted: (count: number) => string;
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
  settings: 'Settings',
  close: 'Close',
  none: 'None',
  inlineData: 'Inline data',
  custom: 'Custom',
  loading: 'Loading…',
  loadError: 'Could not load the data.',
  noData: 'No data',
  tableView: 'Table view',
  resetZoom: 'Reset zoom',
  search: 'Search',
  brickActions: 'Brick actions',
  exportCsv: 'Download CSV',
  exportPng: 'Download image',
  alignLabel: 'Align',
  align: {
    left: 'Align left',
    centerX: 'Centre horizontally',
    right: 'Align right',
    top: 'Align top',
    centerY: 'Centre vertically',
    bottom: 'Align bottom',
    distributeX: 'Distribute horizontally',
    distributeY: 'Distribute vertically',
  },
  fields: {
    data: 'Data',
    x: 'X axis',
    y: 'Y axis',
    series: 'Series',
    lines: 'Line series',
    stacked: 'Stacked',
    horizontal: 'Horizontal',
    labels: 'Value labels',
    curve: 'Line shape',
    zoom: 'Drag to zoom',
    yFormat: 'Number format',
    format: 'Number format',
    value: 'Value',
    label: 'Label',
    group: 'Group by',
    size: 'Size by',
    limit: 'Rows to show',
    deltaLabel: 'Comparison label',
    upIsGood: 'Increase is good',
    centerLabel: 'Centre caption',
    text: 'Text',
    variant: 'Style',
    searchable: 'Search box',
  },
  options: {
    auto: 'Automatic',
    number: 'Number',
    integer: 'Whole number',
    compact: 'Compact (12.9K)',
    percent: 'Percent',
    linear: 'Straight',
    smooth: 'Smooth',
    body: 'Body text',
    heading: 'Heading',
  },
  selected: (count) => `${count} selected`,
  pasted: (count) => (count === 1 ? 'Brick pasted' : `${count} bricks pasted`),
  moved: (name, x, y) => `${name} moved to ${x}, ${y}`,
  resized: (name, w, h) => `${name} resized to ${w} by ${h}`,
  added: (name) => `${name} added`,
  removed: (count) => (count === 1 ? 'Brick removed' : `${count} bricks removed`),
  duplicated: (count) => (count === 1 ? 'Brick duplicated' : `${count} bricks duplicated`),
  undone: 'Undone',
  redone: 'Redone',
  cancelled: 'Cancelled',
};
