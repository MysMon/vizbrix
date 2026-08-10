/**
 * The generated stylesheet, rendered in-tree.
 *
 * ALL placement CSS lives here — never in an inline `style` attribute (§1.3).
 * The sheet is a pure function of (document, instance id, z-ranks), so it is
 * emitted identically on the server and on the client, and the first paint is
 * correct with zero JavaScript.
 *
 * It is re-emitted on document and order commits only. Container measurement
 * deliberately does NOT invalidate it: responsive behaviour is expressed as
 * `@container` blocks inside the sheet, so resizing the window rewrites
 * nothing — the browser re-evaluates the queries it already has.
 */

import { memo, useCallback, useRef, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import type { LayoutDoc } from '../core/schema/types';
import { emitStylesheet } from '../core/geometry/css';
import { useVizbrixContext } from './context';

interface Cache {
  doc: unknown;
  order: readonly string[];
  /**
   * The instance id the cached CSS is SCOPED TO. Not part of the store's state,
   * and therefore easy to forget: every selector in the sheet is prefixed with
   * `[data-vzb="…"]` and the container is named after it, so serving the cached
   * string after the id changed leaves a sheet that matches nothing — every item
   * silently loses its position.
   */
  id: string;
  css: string;
}

export const StyleSheet = memo(function StyleSheet(): ReactElement {
  const { store, instanceId } = useVizbrixContext();
  const cache = useRef<Cache | null>(null);

  const subscribe = useCallback(
    (cb: () => void) => {
      const offDoc = store.subscribeDoc(cb);
      const offOrder = store.subscribeOrder(cb);
      return () => {
        offDoc();
        offOrder();
      };
    },
    [store],
  );

  // `useSyncExternalStore` compares snapshots by identity, so this must return
  // the same string until something it depends on actually changed. Both keys
  // are stable object identities held by the store, which makes the check O(1).
  const getSnapshot = useCallback(() => {
    const doc = store.getDoc();
    const order = store.getOrder();
    const prev = cache.current;
    if (prev !== null && prev.doc === doc && prev.order === order && prev.id === instanceId) {
      return prev.css;
    }

    const zRanks = new Map<string, number>();
    for (const id of order) {
      const view = store.getItemView(id);
      if (view) zRanks.set(id, view.zIndex);
    }
    const css = emitStylesheet(doc as unknown as LayoutDoc<never>, instanceId, zRanks);
    cache.current = { doc, order, id: instanceId, css };
    return css;
  }, [store, instanceId]);

  const css = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // `dangerouslySetInnerHTML` is required, not a shortcut: React escapes text
  // children, and an escaped `>` would break every child-combinator selector.
  return <style data-vzb-style={instanceId} dangerouslySetInnerHTML={{ __html: css }} />;
});
