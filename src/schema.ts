/**
 * `vizbrix/schema` — the persistence surface, on its own.
 *
 * Types, validation, loading, migration and serialization with no React, no
 * DOM and no store: this is what a server route, a migration script or a
 * database trigger imports. `load()` never throws — it returns a `LoadOutcome`
 * describing exactly what it did (§12).
 */

export type {
  AnchorSpec,
  Axis,
  AxisMode,
  AxisPlacement,
  CollisionPolicy,
  ContainerConfig,
  FlatItemInput,
  Issue,
  ItemOverride,
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
  Transaction,
  TxResult,
  TxSource,
} from './core/schema/types';
export { SCHEMA_VERSION } from './core/schema/types';

export { validate } from './core/schema/validate';
export { isLoaded, load } from './core/schema/load';
export { migrate } from './core/schema/migrate';
export type { Migration, MigrationContext, MigrationRegistry } from './core/schema/migrate';
export { serialize } from './core/schema/serialize';
export type { SerializeOptions } from './core/schema/serialize';
export { DEFAULT_BASE_WIDTH, defineLayout, normalize } from './core/schema/normalize';
