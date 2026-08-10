/**
 * `vizbrix/react/view` — the read-only adapter.
 *
 * Same render contract as the editor, none of the editing weight: no
 * interaction controller, no overlay, no history, no editing ARIA. The hooks
 * that make sense without an editor (`useVizbrix`, `useSelection`) are
 * re-exported; `useHistory` is not, because view mode has no history by design
 * (§1.16).
 */

export { VizbrixView } from './View';
export type { VizbrixViewProps } from './View';

export { useSelection, useVizbrix } from './hooks';
export type { SelectionApi, VizbrixApi } from './hooks';

export type { ItemRenderer, ItemUI, ItemView } from './context';

export type {
  ContainerConfig,
  LayoutDoc,
  LayoutItem,
  LayoutItemBase,
  Rect,
  VizbrixStore,
  VizbrixStrings,
} from '../core/schema/types';
