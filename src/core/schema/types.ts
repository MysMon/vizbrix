/**
 * vizbrix — cross-module contracts.
 *
 * This file is types-only (no runtime code) and is the frozen contract every
 * module implements against. Positions are expressions, not numbers: every
 * placement is affine in the container extent (`a·W + b`), which is exactly
 * what CSS `calc(P% + Xpx)` expresses and exactly what a future linear
 * constraint solver can consume.
 */

/* ------------------------------------------------------------------ */
/* Geometry primitives                                                 */
/* ------------------------------------------------------------------ */

/**
 * Affine length. A bare number means pixels. The object form is
 * `pct% of the container extent + px`, i.e. `(pct/100)·W + px`.
 */
export type Len = number | { pct?: number; px?: number };

export type Axis = 'x' | 'y';

export type AxisMode = 'start' | 'end' | 'both' | 'center' | 'scale';

/**
 * Per-axis placement. Modes have disjoint field meanings, so placements are
 * always replaced wholesale — partial merges across modes are unsound.
 *
 * - `start`:  offset from the container's start edge; explicit size.
 * - `end`:    offset from the container's END edge; explicit size.
 * - `both`:   pinned to both edges; size is derived (stretch).
 * - `center`: offset of the item's CENTER from the container's center.
 * - `scale`:  resolves identically to `start`; exists so reencode writes
 *             fractions (pct) back instead of pixels.
 */
export type AxisPlacement =
  | { mode: 'start'; offset: Len; size: Len }
  | { mode: 'end'; offset: Len; size: Len }
  | { mode: 'both'; start: Len; end: Len }
  | { mode: 'center'; offset: Len; size: Len }
  | { mode: 'scale'; offset: Len; size: Len };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* ------------------------------------------------------------------ */
/* Persisted document schema (version 1)                               */
/* ------------------------------------------------------------------ */

export type CollisionPolicy = 'allow' | 'guide' | 'forbid';

/** Field-level responsive override. Placements replace wholesale. */
export interface ItemOverride {
  x?: AxisPlacement;
  y?: AxisPlacement;
  hidden?: boolean;
  /** Tier-3 stacking order override at this size. */
  order?: number;
}

export interface LayoutItemBase {
  /** Unique within the document. */
  id: string;
  x: AxisPlacement;
  y: AxisPlacement;
  /** Fractional index key, base-62, ASCII-ordinal ordering. */
  z: string;
  /** Size limits in px, measured in base space. */
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  /** Default 'allow'. `forbid` is enforced at commit, never inside resolve(). */
  collision?: CollisionPolicy;
  /** Restrict collision checks to items carrying any of these tags. */
  collisionWith?: string[];
  tags?: string[];
  /** Locked items are not movable/resizable in edit mode. */
  locked?: boolean;
  hidden?: boolean;
  /** Tier-3 reading-order override. */
  order?: number;
  /** Responsive overrides keyed by declared size name; cascading desktop-first. */
  at?: Record<string, ItemOverride>;
  /** Forward-compat parking: unknown keys survive load→serialize verbatim. */
  $unknown?: Record<string, unknown>;
}

/**
 * `data` is required exactly when the consumer supplies a TData that cannot
 * be undefined — so `item.data.kind` narrows without null checks, while
 * data-less dashboards need no annotation at all.
 */
export type LayoutItem<TData = undefined> = LayoutItemBase &
  ([undefined] extends [TData] ? { data?: TData } : { data: TData });

export interface SizeDef {
  /** The size is active when the measured container width is ≤ maxWidth. */
  maxWidth: number;
}

export interface ContainerConfig {
  /**
   * Base design extent. `width` is REQUIRED: it fixes the meaning of px
   * offsets, tier-3 reading order, and server-rendered rects. Changing it is
   * a migration-class edit.
   */
  base: { width: number; height?: number };
  /**
   * 'auto' (default): container height is content-determined; vertical
   * `end|both|center|scale` are unresolvable and degrade to `start` with a
   * dev warning. 'fill': container fills its parent; all y modes honored.
   */
  height?: 'auto' | 'fill';
  /** Named container sizes for the `at` cascade, e.g. `{ md: { maxWidth: 900 } }`. */
  sizes?: Record<string, SizeDef>;
  /** Tier-3: stack into a single column below this width. 0 disables. Default 480. */
  stackBelow?: number;
  /** 'reflow' (default): constraint-based. 'scale': uniform canvas scaling. */
  responsive?: 'reflow' | 'scale';
  /** Default 'ltr'. Affects which physical edge 'start' maps to. */
  direction?: 'ltr' | 'rtl';
}

export interface LayoutDoc<TData = undefined> {
  /** Writer schema version. Current: 1. */
  version: number;
  /** Reader floor: lowest schema version able to render this doc. Default 1. */
  compat?: number;
  container: ContainerConfig;
  items: LayoutItem<TData>[];
  $unknown?: Record<string, unknown>;
}

export const SCHEMA_VERSION = 1 as const;

/* ------------------------------------------------------------------ */
/* Authoring sugar                                                     */
/* ------------------------------------------------------------------ */

export type AnchorSpec = 'scale' | { x?: AxisMode; y?: AxisMode };

/** Relaxed authoring input consumed by defineLayout(). */
export type FlatItemInput<TData = undefined> = {
  id: string;
  /** px in base space */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Default: `{ x: 'start', y: 'start' }`. */
  anchor?: AnchorSpec;
  z?: string;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  collision?: CollisionPolicy;
  collisionWith?: string[];
  tags?: string[];
  locked?: boolean;
  hidden?: boolean;
  order?: number;
  at?: Record<string, ItemOverride>;
} & ([undefined] extends [TData] ? { data?: TData } : { data: TData });

export interface LayoutInput<TData = undefined> {
  version?: number;
  container?: Partial<ContainerConfig> & { base?: { width: number; height?: number } };
  /** Either canonical items or flat sugar; defineLayout normalizes both. */
  items: Array<FlatItemInput<TData> | LayoutItem<TData>>;
}

/* ------------------------------------------------------------------ */
/* Load / persistence contract                                         */
/* ------------------------------------------------------------------ */

export interface Issue {
  severity: 'warn' | 'error';
  /** JSON-path-ish location, e.g. `items[3].x.offset`. */
  path: string;
  message: string;
}

export type LoadOutcome<TData = undefined> =
  | { status: 'ok'; doc: LayoutDoc<TData>; issues: Issue[] }
  | { status: 'migrated'; doc: LayoutDoc<TData>; from: number; issues: Issue[] }
  | { status: 'forward-degraded'; doc: LayoutDoc<TData>; ignored: string[]; issues: Issue[] }
  | { status: 'incompatible'; reason: string; compat: number }
  | { status: 'invalid'; errors: Issue[] };

/* ------------------------------------------------------------------ */
/* Ops, transactions, history                                          */
/* ------------------------------------------------------------------ */

export interface PlacementPair {
  x: AxisPlacement;
  y: AxisPlacement;
}

/**
 * Every op carries before/after so inversion is mechanical and rebase checks
 * are "current still equals after".
 */
export type Op =
  | { type: 'add'; item: LayoutItem<never> }
  | { type: 'remove'; item: LayoutItem<never> }
  | { type: 'move'; id: string; before: PlacementPair; after: PlacementPair }
  | { type: 'resize'; id: string; before: PlacementPair; after: PlacementPair }
  | { type: 'setZ'; id: string; before: string; after: string }
  | {
      type: 'placeAt';
      id: string;
      size: string;
      /** `undefined` means the override did not / will not exist (DELETE, never null). */
      before: ItemOverride | undefined;
      after: ItemOverride | undefined;
    }
  | { type: 'setHidden'; id: string; before: boolean; after: boolean }
  | { type: 'setLocked'; id: string; before: boolean; after: boolean }
  | { type: 'setOrder'; id: string; before: number | undefined; after: number | undefined }
  | { type: 'setData'; id: string; before: unknown; after: unknown }
  | { type: 'replaceDoc'; before: LayoutDoc<never>; after: LayoutDoc<never> };

export type TxSource = 'pointer' | 'keyboard' | 'place' | 'api' | 'history';

export interface Transaction {
  /** Human-readable label material; rendered via strings.undoLabel(tx). */
  label: { kind: 'move' | 'resize' | 'add' | 'remove' | 'reorder' | 'edit'; ids: string[]; size?: string };
  ops: Op[];
  source: TxSource;
  actor?: string;
}

export interface TxResult {
  status: 'applied' | 'blocked' | 'empty';
  /** Ops skipped by rebase conflict policy. */
  skipped: Op[];
  tx?: Transaction;
}

/* ------------------------------------------------------------------ */
/* Snapping                                                            */
/* ------------------------------------------------------------------ */

export type HandleId = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface Guide {
  axis: Axis;
  /** Position of the guide line on `axis`, container coordinates. */
  at: number;
  /** Extent of the line along the perpendicular axis. */
  from: number;
  to: number;
  kind: 'edge' | 'center' | 'gap' | 'grid' | 'forbid';
}

/** Frozen at pointerdown: zero getBoundingClientRect during a gesture. */
export interface GestureSnapshot {
  /** Container content box in viewport coordinates. */
  container: Rect;
  /** Canvas scale factor (1 unless responsive:'scale'). */
  scale: number;
  /** Resolved rects of ALL items at gesture start, container coordinates. */
  rects: ReadonlyMap<string, Rect>;
  /** Ids being moved/resized (excluded from snap candidates). */
  movingIds: ReadonlySet<string>;
  /** Measured container extent at gesture start. */
  width: number;
  height: number;
}

export interface SnapResult {
  /** Correction to apply to the proposed rect, container px. */
  dx: number;
  dy: number;
  /** Guide lines to draw this frame (imperatively; reused buffer). */
  guides: readonly Guide[];
}

export interface SnapConfig {
  /** Grid step in px. OFF by default — grids are an interaction, not a model. */
  grid?: number | false;
  /** Screen-px snap threshold, divided by canvas scale. Default 8. */
  threshold?: number;
  /** Hold to bypass snapping. Default 'meta' (Cmd on macOS, Ctrl elsewhere). */
  bypassKey?: 'meta' | 'ctrl' | 'alt' | 'shift' | 'none';
  /** Disable specific providers. */
  siblings?: boolean;
  gaps?: boolean;
  containerEdges?: boolean;
}

export interface SnapEngine {
  begin(snapshot: GestureSnapshot): void;
  query(rect: Rect, kind: 'move' | 'resize', handle: HandleId | null, bypass: boolean): SnapResult;
  end(): void;
}

/* ------------------------------------------------------------------ */
/* Interaction state (transient channel)                               */
/* ------------------------------------------------------------------ */

export type InteractionState =
  | { phase: 'idle' }
  | {
      phase: 'dragging';
      ids: readonly string[];
      /** Proposed (post-snap) rects this frame. */
      rects: ReadonlyMap<string, Rect>;
      guides: readonly Guide[];
      /** False while a forbid-policy overlap is active. */
      valid: boolean;
      /** Last collision-valid rects (drop target when valid=false). */
      lastValidRects: ReadonlyMap<string, Rect> | null;
    }
  | {
      phase: 'resizing';
      id: string;
      handle: HandleId;
      rect: Rect;
      guides: readonly Guide[];
      valid: boolean;
      lastValidRect: Rect | null;
    }
  | { phase: 'marquee'; rect: Rect; pending: readonly string[] }
  | { phase: 'placing'; id: string }
  | { phase: 'kb-grab'; id: string; rect: Rect };

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export interface ItemSnapshot<TData = undefined> {
  item: LayoutItem<TData>;
  /** Resolved at the current measured width (base width on the server). */
  rect: Rect;
  /** Derived sparse z-index for CSS. */
  zIndex: number;
  selected: boolean;
  /** Bumped on every change to this snapshot; memoization key. */
  version: number;
}

export interface ApplyOptions {
  source?: TxSource;
  actor?: string;
  /** Label override; default derived from ops. */
  label?: Transaction['label'];
  /** Skip history (e.g. transient programmatic sync). */
  transient?: boolean;
}

export type Unsubscribe = () => void;

export interface VizbrixStore<TData = undefined> {
  /* documents */
  getDoc(): LayoutDoc<TData>;
  getItem(id: string): LayoutItem<TData> | undefined;
  getItemView(id: string): ItemSnapshot<TData> | undefined;
  /** Frozen at construction, resolved at base.width. Hydration-safe. */
  getServerItemView(id: string): ItemSnapshot<TData> | undefined;
  /** z-sorted ids (ascending; render/DOM order). */
  getOrder(): readonly string[];

  /* container measurement */
  getContainerWidth(): number;
  getContainerHeight(): number | undefined;
  setContainerSize(width: number, height?: number): void;
  /** Active named sizes at the current width, outermost→innermost. */
  getActiveSizes(): readonly string[];
  /** True when width < stackBelow (tier-3). */
  isStacked(): boolean;

  /* selection */
  getSelection(): readonly string[];
  setSelection(ids: readonly string[]): void;

  /* transient interaction channel */
  getInteraction(): InteractionState;
  setInteraction(state: InteractionState): void;
  /** DOM node registry for imperative transform writes. */
  registerNode(id: string, el: HTMLElement | null): void;
  getNode(id: string): HTMLElement | null;

  /* subscriptions — each fires only for its own channel */
  subscribeItem(id: string, cb: () => void): Unsubscribe;
  subscribeOrder(cb: () => void): Unsubscribe;
  subscribeSelection(cb: () => void): Unsubscribe;
  subscribeDoc(cb: () => void): Unsubscribe;
  subscribeInteraction(cb: () => void): Unsubscribe;
  subscribeContainer(cb: () => void): Unsubscribe;

  /* mutation */
  apply(ops: Op[], opts?: ApplyOptions): TxResult;
  /** Convenience builders (each = apply of one op with derived label). */
  moveItem(id: string, rect: Rect, opts?: ApplyOptions): TxResult;
  resizeItem(id: string, rect: Rect, opts?: ApplyOptions): TxResult;
  addItem(item: LayoutItem<TData>, opts?: ApplyOptions): TxResult;
  removeItem(id: string, opts?: ApplyOptions): TxResult;
  bringToFront(id: string): TxResult;
  sendToBack(id: string): TxResult;
  setAnchor(id: string, axis: Axis, mode: AxisMode): TxResult;

  /* history */
  undo(): TxResult;
  redo(): TxResult;
  canUndo(): boolean;
  canRedo(): boolean;
  peekUndo(): Transaction | undefined;
  peekRedo(): Transaction | undefined;

  /* mode */
  getMode(): 'view' | 'edit';
  setMode(mode: 'view' | 'edit'): void;

  destroy(): void;
}

export interface StoreOptions {
  mode?: 'view' | 'edit';
  actor?: string;
  historyDepth?: number;
  onConflict?: 'skip' | 'force' | 'abort';
  /** Called when fractional keys exceed 40 chars — app decides when to rebalance. */
  onKeyGrowth?: (info: { maxLength: number }) => void;
}

/* ------------------------------------------------------------------ */
/* Strings / i18n — functions, not templates                           */
/* ------------------------------------------------------------------ */

export interface ItemStringContext {
  /** Consumer label for the item (falls back to id). */
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 1-based position in z-order. */
  position: number;
  count: number;
}

export interface VizbrixStrings {
  /** aria-roledescription for items. */
  itemRole(): string;
  /** Off-screen usage instructions attached via aria-describedby. */
  instructions(): string;
  grabbed(ctx: ItemStringContext): string;
  moved(ctx: ItemStringContext): string;
  dropped(ctx: ItemStringContext): string;
  canceled(ctx: ItemStringContext): string;
  resized(ctx: ItemStringContext): string;
  removed(ctx: ItemStringContext): string;
  placingStarted(ctx: ItemStringContext): string;
  placed(ctx: ItemStringContext): string;
  reordered(ctx: ItemStringContext & { direction: 'front' | 'back' }): string;
  /** History labels, e.g. "Move Revenue chart (md)". */
  undoLabel(tx: Transaction): string;
  redoLabel(tx: Transaction): string;
  moveButtonLabel(ctx: ItemStringContext): string;
}
