/**
 * `vizbrix/react` — the editor adapter.
 *
 * Ships with the interaction layer, the overlay and history. If you only need
 * to display a saved layout, import `vizbrix/react/view` (no sensors, no
 * observer, no history) or `vizbrix/react/static` (no client JavaScript at
 * all): the bundle claims in the README are measured against those real entry
 * points, never against a prop-gated dynamic import (§1.17).
 */

export { Vizbrix } from './Vizbrix';
export type { VizbrixProps } from './Vizbrix';

export { useHistory, useSelection, useVizbrix } from './hooks';
export type { HistoryApi, SelectionApi, VizbrixApi } from './hooks';

export type { ItemRenderer, ItemUI, ItemView } from './context';

export type {
  ContainerConfig,
  Guide,
  HandleId,
  InteractionState,
  ItemStringContext,
  LayoutDoc,
  LayoutItem,
  LayoutItemBase,
  LoadOutcome,
  Op,
  Rect,
  SnapConfig,
  Transaction,
  TxResult,
  VizbrixStore,
  VizbrixStrings,
} from '../core/schema/types';
