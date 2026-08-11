/**
 * `<VizbrixStatic>` — the RSC-safe renderer (`vizbrix/react/static`).
 *
 * A pure function of a document. No hooks, no store, no context, no state, no
 * effects, no event handlers, no client directive — nothing in this file may ever
 * acquire any of those, because this entry point is compiled WITHOUT the
 * client banner and is meant to run inside a React Server Component.
 *
 * That is not a limitation, it is the product claim: positions are expressions,
 * resolution is pure and measurement-free, so the first paint is correct with
 * zero JavaScript on the page. This component is the proof.
 *
 * It assumes a valid `LayoutDoc` — run `load()` at your persistence boundary
 * (it never throws) and pass the result's `doc`.
 */

import type { CSSProperties, HTMLAttributes, ReactElement } from 'react';
import type { LayoutDoc, LayoutItem } from '../core/schema/types';
import { emitStylesheet } from '../core/geometry/css';
import { buildServerViews } from '../core/store/server-view';
import type { AnyItemRenderer, ItemRenderer, ItemUI, ItemView } from './context';

export interface VizbrixStaticProps<TData = undefined> {
  layout: LayoutDoc<TData>;
  /**
   * Scopes every generated selector. Defaults to `'vzb0'` — pass a distinct id
   * when two dashboards share a page.
   */
  instanceId?: string;
  className?: string;
  style?: CSSProperties;
  children: ItemRenderer<TData>;
}

/**
 * The UI object handed to the render callback here is deliberately inert: there
 * is no store to mutate and no controller to talk to. Consumers branch on
 * `ui.attributes` being enough, or render a different tree on the server.
 */
function inertUI(id: string, selected: boolean): ItemUI {
  return {
    isSelected: selected,
    isDragging: false,
    isResizing: false,
    isPlacing: false,
    handleProps: {},
    moveButtonProps: { type: 'button', disabled: true },
    attributes: { 'data-vzb-item': id } as unknown as HTMLAttributes<HTMLElement>,
    remove: noop,
    bringToFront: noop,
    select: noop,
  };
}

function noop(): void {
  /* inert by construction — there is no client here */
}

export function VizbrixStatic<TData = undefined>(
  props: VizbrixStaticProps<TData>,
): ReactElement {
  const { layout, instanceId = 'vzb0', className, style, children } = props;

  // The same snapshot builder the store freezes at construction: rects resolved
  // at `base.width`, sparse z ranks, z-sorted iteration order — so the GEOMETRY
  // and the stylesheet here are byte-identical to what the interactive surfaces
  // render on the server (§1.21).
  //
  // That is not the same as being hydratable: this root writes
  // `data-vzb-mode="static"` and the shells omit the editing attributes, so
  // React reports an attribute mismatch (and does not patch it up) if this
  // markup is handed to `hydrateRoot` with `<Vizbrix>`/`<VizbrixView>`. That is
  // the documented contract — see docs/ssr.md: server-render the interactive
  // component itself when you want to hydrate; both are SSR-safe.
  const views = buildServerViews(layout);

  const zRanks = new Map<string, number>();
  for (const [id, view] of views) zRanks.set(id, view.zIndex);
  const css = emitStylesheet(layout as unknown as LayoutDoc<never>, instanceId, zRanks);

  const shells: ReactElement[] = [];
  for (const [id, view] of views) {
    const item = view.item as LayoutItem<unknown>;
    const locked = item.locked === true;
    const hidden = item.hidden === true;
    const itemView = {
      id,
      data: item.data,
      rect: view.rect,
      hidden,
      locked,
    } as ItemView<unknown>;
    shells.push(
      <div key={id} data-vzb-item={id} {...(locked ? { 'data-locked': '' } : {})}>
        {(children as unknown as AnyItemRenderer)(itemView, inertUI(id, false))}
      </div>,
    );
  }

  return (
    // The wrapper is the query container (queries resolve against the nearest
    // ANCESTOR container); the inner root is the positioning context that the
    // `@container` blocks — size overrides and the tier-3 stack — restyle.
    <div data-vzb-container={instanceId} className={className} style={style}>
      <div data-vzb={instanceId} data-vzb-mode="static">
        {/* Child combinators must survive: React would escape `>` in a text child. */}
        <style data-vzb-style={instanceId} dangerouslySetInnerHTML={{ __html: css }} />
        {shells}
      </div>
    </div>
  );
}
