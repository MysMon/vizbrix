/**
 * `vizbrix` — the framework-agnostic core.
 *
 * Schema, geometry, ordering, store, ops, snapping, interaction and i18n, with
 * no React import anywhere below this file (CI enforces it) and no DOM global
 * touched at module scope. A non-React adapter needs nothing more than what is
 * exported here.
 */

/* ---------------- schema ---------------- */

export type {
  AnchorSpec,
  ApplyOptions,
  Axis,
  AxisMode,
  AxisPlacement,
  CollisionPolicy,
  ContainerConfig,
  FlatItemInput,
  GestureSnapshot,
  Guide,
  HandleId,
  InteractionState,
  Issue,
  ItemOverride,
  ItemSnapshot,
  ItemStringContext,
  LayoutDoc,
  LayoutInput,
  LayoutItem,
  LayoutItemBase,
  Len,
  LoadOutcome,
  Op,
  PlacementPair,
  Rect,
  SizeDef,
  SnapConfig,
  SnapEngine,
  SnapResult,
  StoreOptions,
  Transaction,
  TxResult,
  TxSource,
  Unsubscribe,
  VizbrixStore,
  VizbrixStrings,
} from './schema/types';
export { SCHEMA_VERSION } from './schema/types';

export { validate } from './schema/validate';
export { isLoaded, load } from './schema/load';
export { migrate } from './schema/migrate';
export type { Migration, MigrationContext, MigrationRegistry } from './schema/migrate';
export { serialize } from './schema/serialize';
export type { SerializeOptions } from './schema/serialize';
export { DEFAULT_BASE_WIDTH, defineLayout, normalize } from './schema/normalize';

/* ---------------- geometry ---------------- */

export { resolveAxis, resolveItem } from './geometry/resolve';
export { reencodeAxis, reencodeRect } from './geometry/reencode';
export { activeSizesAt, foldItem, stackOrder } from './geometry/cascade';
export { emitStylesheet } from './geometry/css';

/* ---------------- ordering ---------------- */

export { isValidKey, keyBetween, keysBetween } from './order/fractional';
export { createZRanker } from './order/zrank';
export type { ZOrderEntry, ZRanker } from './order/zrank';

/* ---------------- store, ops, history ---------------- */

export { createStore } from './store/store';
export { createHistory } from './ops/history';
export type { History } from './ops/history';
export { applyOp, invertOp } from './ops/ops';

/* ---------------- interaction ---------------- */

export { createSnapEngine } from './snap/engine';
export { createInteractionController } from './interact/controller';
export type { InteractionController, InteractionOptions } from './interact/controller';

/* ---------------- i18n + a11y ---------------- */

export { defaultStrings, en } from './locales/en';
export { fromMessages } from './a11y/announce';

/* ---------------- interop ---------------- */

export { importFromRGL } from './convert/rgl';
export type { RGLImportOptions, RGLLayoutItem, RGLResponsiveLayouts } from './convert/rgl';
