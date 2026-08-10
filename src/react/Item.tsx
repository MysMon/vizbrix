/**
 * One item shell.
 *
 * This component is the whole reason vizbrix can claim "dragging one item never
 * re-renders another". It is memoized on a single `id` prop and subscribes to
 * exactly one channel — `subscribeItem(id)` — which the store fires only when
 * THAT item's snapshot actually changed. It deliberately subscribes to nothing
 * else:
 *
 * - not the interaction channel (that fires every frame),
 * - not the selection channel (selection is folded into the item snapshot),
 * - not the document channel (a sibling's commit is not this item's business).
 *
 * It also writes NO positional inline styles. Every `left/top/width/height` for
 * every item and every breakpoint comes from the generated stylesheet (§1.3):
 * an inline style would win over the `@container` override blocks and silently
 * break responsive behaviour — which is precisely the bug this rule exists to
 * prevent.
 */

import { memo, useCallback, useRef, useSyncExternalStore } from 'react';
import type { CSSProperties, HTMLAttributes, ReactElement } from 'react';
import type {
  HandleId,
  InteractionState,
  ItemStringContext,
  LayoutItem,
} from '../core/schema/types';
import type { ItemUI, ItemView } from './context';
import {
  applyTransientAttrs,
  instructionsId,
  transientOf,
  useIsomorphicLayoutEffect,
  useVizbrixContext,
} from './context';

/* ------------------------------------------------------------------ */
/* Resize handles                                                      */
/* ------------------------------------------------------------------ */

/**
 * Handles are chrome, not placement: they carry inline styles because they are
 * not items, never appear in the generated stylesheet, and are never subject to
 * a responsive override. Frozen module constants — zero allocation per render.
 */
const HANDLE_BASE: CSSProperties = {
  position: 'absolute',
  width: 10,
  height: 10,
  boxSizing: 'border-box',
  background: 'var(--vzb-handle-bg, #fff)',
  border: '1px solid var(--vzb-handle-border, #4c8dff)',
  borderRadius: 2,
  touchAction: 'none',
};

const HANDLE_STYLE: Record<HandleId, CSSProperties> = {
  nw: { ...HANDLE_BASE, top: -5, left: -5, cursor: 'nwse-resize' },
  n: { ...HANDLE_BASE, top: -5, left: '50%', marginLeft: -5, cursor: 'ns-resize' },
  ne: { ...HANDLE_BASE, top: -5, right: -5, cursor: 'nesw-resize' },
  e: { ...HANDLE_BASE, top: '50%', right: -5, marginTop: -5, cursor: 'ew-resize' },
  se: { ...HANDLE_BASE, bottom: -5, right: -5, cursor: 'nwse-resize' },
  s: { ...HANDLE_BASE, bottom: -5, left: '50%', marginLeft: -5, cursor: 'ns-resize' },
  sw: { ...HANDLE_BASE, bottom: -5, left: -5, cursor: 'nesw-resize' },
  w: { ...HANDLE_BASE, top: '50%', left: -5, marginTop: -5, cursor: 'ew-resize' },
};

const HANDLE_IDS: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** §1.18: at rest a touch on an item must still scroll the page. */
const EDIT_ROOT_STYLE: CSSProperties = { touchAction: 'pan-y' };

/**
 * Marks an element as the drag handle. Carries no pointer listener on purpose:
 * the interaction layer resolves targets through `composedPath()`, so the
 * attribute alone scopes the gesture and the consumer's own handlers keep
 * working untouched.
 */
const HANDLE_PROPS = { 'data-vzb-drag-handle': '' } as unknown as HTMLAttributes<HTMLElement>;

const INERT_MOVE_BUTTON = Object.freeze({ type: 'button' as const, disabled: true });

/* ------------------------------------------------------------------ */
/* Transient state (read, never subscribed)                            */
/* ------------------------------------------------------------------ */

function isPlacingId(state: InteractionState, id: string): boolean {
  return state.phase === 'placing' && state.id === id;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export interface ItemProps {
  id: string;
}

function ItemImpl({ id }: ItemProps): ReactElement | null {
  const {
    store,
    instanceId,
    mode,
    strings,
    getLabel,
    renderRef,
    controllerRef,
  } = useVizbrixContext();

  const subscribe = useCallback((cb: () => void) => store.subscribeItem(id, cb), [store, id]);
  const getSnapshot = useCallback(() => store.getItemView(id), [store, id]);
  // Hydration and SSR resolve at `base.width` — a pure function of the doc, so
  // the two renders cannot disagree (§1.21).
  const getServerSnapshot = useCallback(() => store.getServerItemView(id), [store, id]);
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const elRef = useRef<HTMLDivElement | null>(null);
  const setNode = useCallback(
    (el: HTMLDivElement | null) => {
      elRef.current = el;
      // The node registry is how the interaction layer writes transforms
      // without going through React at all.
      store.registerNode(id, el);
    },
    [store, id],
  );

  // React renders the state attributes from a render-time read, and the overlay
  // writes them imperatively while a gesture runs. This reconciles the two
  // after every commit, so a React render can never resurrect a `data-dragging`
  // that the gesture already cleared.
  useIsomorphicLayoutEffect(() => {
    applyTransientAttrs(elRef.current, transientOf(store.getInteraction(), id));
  });

  // Removed items keep their subscription alive for one render; the parent's
  // order channel drops them on the same commit.
  if (!snap) return null;

  const item = snap.item as LayoutItem<unknown>;
  const editing = mode === 'edit';
  const locked = item.locked === true;
  const hidden = item.hidden === true;
  const interaction = store.getInteraction();
  const transient = transientOf(interaction, id);
  const placing = isPlacingId(interaction, id);

  const view = {
    id,
    data: item.data,
    rect: snap.rect,
    hidden,
    locked,
  } as ItemView<unknown>;

  const attributes: Record<string, unknown> = {
    'data-vzb-item': id,
  };
  if (snap.selected) attributes['data-selected'] = '';
  if (locked) attributes['data-locked'] = '';
  if (transient === 'dragging') attributes['data-dragging'] = '';
  if (transient === 'resizing') attributes['data-resizing'] = '';
  if (editing) {
    attributes.role = 'button';
    attributes.tabIndex = 0;
    attributes['aria-roledescription'] = strings.itemRole();
    attributes['aria-describedby'] = instructionsId(instanceId);
    if (snap.selected) attributes['aria-pressed'] = true;
  }

  let moveButtonProps = INERT_MOVE_BUTTON as ItemUI['moveButtonProps'];
  if (editing && !locked) {
    const order = store.getOrder();
    const ctx: ItemStringContext = {
      label: getLabel(item),
      x: Math.round(snap.rect.x),
      y: Math.round(snap.rect.y),
      w: Math.round(snap.rect.w),
      h: Math.round(snap.rect.h),
      position: order.indexOf(id) + 1,
      count: order.length,
    };
    moveButtonProps = {
      type: 'button',
      'aria-label': strings.moveButtonLabel(ctx),
      'aria-pressed': placing,
      onClick: () => {
        const controller = controllerRef.current;
        if (!controller) return;
        if (isPlacingId(store.getInteraction(), id)) controller.cancelPlace();
        else controller.beginPlace(id);
      },
    };
  }

  const ui: ItemUI = {
    isSelected: snap.selected,
    isDragging: transient === 'dragging',
    isResizing: transient === 'resizing',
    isPlacing: placing,
    handleProps: HANDLE_PROPS,
    moveButtonProps,
    attributes: attributes as HTMLAttributes<HTMLElement>,
    remove: () => void store.removeItem(id),
    bringToFront: () => void store.bringToFront(id),
    select: () => store.setSelection([id]),
  };

  const showHandles = editing && snap.selected && !locked && !hidden;

  return (
    <div
      ref={setNode}
      {...(attributes as HTMLAttributes<HTMLDivElement>)}
      style={editing ? EDIT_ROOT_STYLE : undefined}
    >
      {renderRef.current(view, ui)}
      {showHandles
        ? HANDLE_IDS.map((handle) => (
            <span key={handle} data-vzb-handle={handle} aria-hidden="true" style={HANDLE_STYLE[handle]} />
          ))
        : null}
    </div>
  );
}

/**
 * Memoized on `id` alone. Everything else it needs is either a subscription or
 * context — and the context value is itself memoized, so a parent re-render
 * does not reach this component at all.
 */
export const Item = memo(ItemImpl);
