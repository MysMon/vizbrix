// @vitest-environment jsdom
/**
 * The editor adapter's behavioural contract: controlled/uncontrolled flows,
 * StrictMode safety, mode switching, the hooks, and the generated stylesheet.
 *
 * These tests drive the store directly rather than through synthetic pointer
 * events. The pointer sensor has its own tests; what is being pinned down here
 * is the React binding around it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, useEffect, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import type { AxisPlacement, LayoutDoc, Transaction } from '../core/schema/types';
import { defineLayout } from '../core/schema/normalize';
import { createStore } from '../core/store/store';
import { syncIncomingDoc } from './context';
import { Vizbrix } from './Vizbrix';
import { VizbrixView } from './View';
import { useHistory, useSelection, useVizbrix } from './hooks';
import type { HistoryApi, SelectionApi, VizbrixApi } from './hooks';

class InertResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
const globalWithRO = globalThis as unknown as { ResizeObserver?: unknown };
globalWithRO.ResizeObserver ??= InertResizeObserver;

function makeDoc(): LayoutDoc {
  return defineLayout({
    container: { base: { width: 1000 }, stackBelow: 0 },
    items: [
      { id: 'a', x: 0, y: 0, w: 100, h: 50 },
      { id: 'b', x: 200, y: 0, w: 100, h: 50 },
    ],
  });
}

const at = (offset: number, size: number): AxisPlacement => ({ mode: 'start', offset, size });

/** Hand-authored `z` keys the fractional generator cannot use as bounds. */
function handAuthored(): LayoutDoc {
  return {
    version: 1,
    container: { base: { width: 1000 }, stackBelow: 0 },
    items: [
      { id: 'a', z: 'b0', x: at(10, 100), y: at(10, 50) },
      { id: 'b', z: 'c0', x: at(300, 100), y: at(10, 50) },
    ],
  };
}

interface Probed {
  api: VizbrixApi<unknown>;
  history: HistoryApi;
  selection: SelectionApi;
}

let probed: Probed | null = null;

function Probe(): null {
  probed = {
    api: useVizbrix(),
    history: useHistory(),
    selection: useSelection(),
  };
  return null;
}

/** Renders the probe once, under the first item. */
function children(item: { id: string }): ReactNode {
  return item.id === 'a' ? <Probe /> : null;
}

function itemEl(id: string): HTMLElement {
  const el = document.querySelector(`[data-vzb-item="${id}"]`);
  if (!el) throw new Error(`no item element for ${id}`);
  return el as HTMLElement;
}

function styleText(): string {
  const el = document.querySelector('style[data-vzb-style]');
  if (!el) throw new Error('no generated stylesheet');
  return el.innerHTML;
}

afterEach(() => {
  cleanup();
  probed = null;
});

/* ------------------------------------------------------------------ */

describe('uncontrolled mode', () => {
  it('reports every committed transaction with the new doc and the tx', () => {
    const onLayoutChange = vi.fn<(doc: LayoutDoc, tx: Transaction) => void>();
    render(
      <Vizbrix defaultLayout={makeDoc()} mode="edit" onLayoutChange={onLayoutChange}>
        {children}
      </Vizbrix>,
    );

    const store = probed!.api.store;
    act(() => {
      store.moveItem('a', { x: 40, y: 10, w: 100, h: 50 });
    });

    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    const [doc, tx] = onLayoutChange.mock.calls[0];
    expect(doc).toBe(store.getDoc());
    expect(tx.label.kind).toBe('move');
    expect(tx.label.ids).toEqual(['a']);
    expect(tx.ops).toHaveLength(1);
    // §1.15: the transaction is an argument, never stamped onto the document.
    expect(Object.keys(doc)).not.toContain('__txId');

    // A no-op commit is not a transaction at all.
    act(() => {
      store.moveItem('a', { x: 40, y: 10, w: 100, h: 50 });
    });
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
  });

  it('ignores later changes to defaultLayout', () => {
    const first = makeDoc();
    const { rerender } = render(
      <Vizbrix defaultLayout={first} mode="edit">
        {children}
      </Vizbrix>,
    );
    const store = probed!.api.store;
    rerender(
      <Vizbrix defaultLayout={makeDoc()} mode="edit">
        {children}
      </Vizbrix>,
    );
    expect(store.getDoc()).toBe(first);
  });
});

describe('controlled mode', () => {
  it('commits internally first and does not loop when the parent echoes', () => {
    let renders = 0;
    let changes = 0;

    function Host(): ReactElement {
      const [doc, setDoc] = useState(makeDoc);
      renders += 1;
      return (
        <Vizbrix
          layout={doc}
          mode="edit"
          onLayoutChange={(next) => {
            changes += 1;
            setDoc(next);
          }}
        >
          {children}
        </Vizbrix>
      );
    }

    render(<Host />);
    const store = probed!.api.store;
    const before = store.getDoc();

    act(() => {
      store.moveItem('a', { x: 40, y: 10, w: 100, h: 50 });
    });

    expect(changes).toBe(1);
    // The store moved first; the parent's echo did not replace the doc again.
    expect(store.getDoc()).not.toBe(before);
    expect(store.getItemView('a')!.rect.x).toBe(40);

    const settled = renders;
    act(() => {
      /* let every scheduled effect drain */
    });
    expect(renders).toBe(settled);
    expect(changes).toBe(1);
  });

  it('rolls back when the parent does not change the prop (§1.15 rejection)', () => {
    const frozen = makeDoc();
    render(
      <Vizbrix layout={frozen} mode="edit" onLayoutChange={() => {}}>
        {children}
      </Vizbrix>,
    );
    const store = probed!.api.store;

    act(() => {
      store.moveItem('a', { x: 400, y: 10, w: 100, h: 50 });
    });

    expect(store.getDoc()).toBe(frozen);
    expect(store.getItemView('a')!.rect.x).toBe(0);
  });

  it('adopts a document the parent transformed', () => {
    const first = makeDoc();
    const second = defineLayout({
      container: { base: { width: 1000 }, stackBelow: 0 },
      items: [{ id: 'a', x: 0, y: 0, w: 100, h: 50 }],
    });

    const { rerender } = render(
      <Vizbrix layout={first} mode="edit">
        {children}
      </Vizbrix>,
    );
    const store = probed!.api.store;
    expect(store.getOrder()).toEqual(['a', 'b']);

    rerender(
      <Vizbrix layout={second} mode="edit">
        {children}
      </Vizbrix>,
    );

    expect(store.getDoc()).toBe(second);
    expect(store.getOrder()).toEqual(['a']);
    expect(document.querySelectorAll('[data-vzb-item]')).toHaveLength(1);
  });

  // A parent that maps the emitted doc into a fresh object hands back a NEW
  // identity after every commit. Treating that as an assertion issues a
  // replaceDoc, and replaceDoc is the load boundary: it clears history. Undo
  // would be dead for every consumer that stores anything but the raw object.
  it('keeps undo/redo alive when the parent stores a transformed copy', () => {
    const seen: LayoutDoc[] = [];

    function Host(): ReactElement {
      const [doc, setDoc] = useState(makeDoc);
      return (
        <Vizbrix
          layout={doc}
          mode="edit"
          onLayoutChange={(next) => {
            seen.push(next);
            // Structurally identical, every object along the way brand new.
            setDoc({ ...next, items: next.items.map((entry) => ({ ...entry })) });
          }}
        >
          {children}
        </Vizbrix>
      );
    }

    render(<Host />);
    const store = probed!.api.store;

    act(() => {
      store.moveItem('a', { x: 40, y: 10, w: 100, h: 50 });
    });
    expect(seen).toHaveLength(1);
    expect(store.getItemView('a')!.rect.x).toBe(40);
    expect(store.canUndo()).toBe(true);

    act(() => {
      store.undo();
    });
    expect(store.getItemView('a')!.rect.x).toBe(0);
    // And the undo itself is a commit, which the transforming parent echoes.
    expect(store.canRedo()).toBe(true);
  });

  // The store REPAIRS a document as it installs it (non-canonical `z` keys), so
  // a hand-authored prop is never `=== getDoc()` afterwards and would look like
  // a fresh assertion forever — each replay clearing history and re-installing
  // the keys `keyBetween()` rejects.
  // The store REPAIRS a document as it adopts it (non-canonical `z` keys), so
  // `getDoc() !== theProp` from the very first render. Replaying the prop over
  // that repair on mount clears history and re-keys the whole document, and
  // before the store repaired at the `replaceDoc` door it also reinstalled the
  // exact keys `keyBetween()` rejects.
  it('does not replay a hand-authored prop over the repair on mount', () => {
    const source = handAuthored();
    let atFirstRender: LayoutDoc<unknown> | null = null;
    let live: VizbrixApi<unknown>['store'] | null = null;

    function Capture(): null {
      const { store } = useVizbrix<unknown>();
      live = store;
      // Renders run before effects: this is the document as CONSTRUCTED.
      atFirstRender ??= store.getDoc() as LayoutDoc<unknown>;
      return null;
    }

    render(
      <Vizbrix layout={source} mode="edit" onLayoutChange={() => {}}>
        {(item) => (item.id === 'a' ? <Capture /> : null)}
      </Vizbrix>,
    );

    const store = live as VizbrixApi<unknown>['store'] | null;
    expect(atFirstRender).not.toBeNull();
    expect(atFirstRender).not.toBe(source);
    expect(atFirstRender!.items.map((entry) => entry.z)).not.toEqual(['b0', 'c0']);
    // No mount-time replaceDoc: the store still holds exactly what it built.
    expect(store!.getDoc()).toBe(atFirstRender);
    expect(() => store!.bringToFront('a')).not.toThrow();
  });

  it('treats a repaired document as an echo at the syncIncomingDoc boundary', () => {
    const source = handAuthored() as LayoutDoc<unknown>;
    const store = createStore(source, { mode: 'edit' });
    const adopted = store.getDoc();
    expect(adopted).not.toBe(source);
    // How every surface calls it on mount: the seed is what the store adopted.
    expect(syncIncomingDoc(store, source, source)).toBe(false);
    expect(store.getDoc()).toBe(adopted);
  });

  it('still applies a genuinely different document', () => {
    const store = createStore(makeDoc() as LayoutDoc<unknown>, { mode: 'edit' });
    const next = defineLayout({
      container: { base: { width: 1000 }, stackBelow: 0 },
      items: [{ id: 'a', x: 0, y: 0, w: 100, h: 50 }],
    }) as LayoutDoc<unknown>;
    expect(syncIncomingDoc(store, next, null)).toBe(true);
    expect(store.getOrder()).toEqual(['a']);
  });

  // React runs CHILD effects before parent effects, so a descendant seeding the
  // dashboard from its own mount effect commits before the tx sink exists.
  it('reports a transaction committed from a child effect', () => {
    const onLayoutChange = vi.fn<(doc: LayoutDoc, tx: Transaction) => void>();

    function Seeder(): null {
      const { store } = useVizbrix();
      useEffect(() => {
        store.moveItem('a', { x: 42, y: 10, w: 100, h: 50 });
      }, [store]);
      return null;
    }

    render(
      <Vizbrix defaultLayout={makeDoc()} mode="edit" onLayoutChange={onLayoutChange}>
        {(item) => (item.id === 'a' ? <Seeder /> : null)}
      </Vizbrix>,
    );

    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    const [doc, tx] = onLayoutChange.mock.calls[0];
    expect(tx.label.kind).toBe('move');
    expect(doc.items.find((entry) => entry.id === 'a')).toBeTruthy();
  });
});

describe('StrictMode', () => {
  it('mounts once, leaks no second store, and logs nothing', () => {
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const onLayoutChange = vi.fn();

    render(
      <StrictMode>
        <Vizbrix defaultLayout={makeDoc()} mode="edit" onLayoutChange={onLayoutChange}>
          {children}
        </Vizbrix>
      </StrictMode>,
    );

    expect(document.querySelectorAll('[data-vzb-item="a"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-vzb-guides]')).toHaveLength(1);

    act(() => {
      probed!.api.store.moveItem('a', { x: 40, y: 10, w: 100, h: 50 });
    });
    // Two live stores (or two live tx sinks) would report the commit twice.
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
    spy.mockRestore();
  });
});

describe('mode', () => {
  it('defaults to view: no editing ARIA, no overlay', () => {
    render(<Vizbrix defaultLayout={makeDoc()}>{children}</Vizbrix>);
    const el = itemEl('a');
    expect(el.getAttribute('role')).toBeNull();
    expect(el.getAttribute('tabindex')).toBeNull();
    expect(el.getAttribute('aria-roledescription')).toBeNull();
    expect(document.querySelector('[data-vzb-guides]')).toBeNull();
  });

  it('attaches editing ARIA when switched to edit', () => {
    const doc = makeDoc();
    const { rerender } = render(<Vizbrix defaultLayout={doc}>{children}</Vizbrix>);
    expect(itemEl('a').getAttribute('role')).toBeNull();

    rerender(
      <Vizbrix defaultLayout={doc} mode="edit">
        {children}
      </Vizbrix>,
    );

    const el = itemEl('a');
    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('aria-roledescription')).toBeTruthy();
    const describedBy = el.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBeTruthy();
    expect(probed!.api.store.getMode()).toBe('edit');
  });
});

describe('hooks', () => {
  it('useHistory undoes and redoes through the store', () => {
    render(
      <Vizbrix defaultLayout={makeDoc()} mode="edit">
        {children}
      </Vizbrix>,
    );
    const store = probed!.api.store;
    expect(probed!.history.canUndo).toBe(false);

    act(() => {
      store.moveItem('a', { x: 400, y: 10, w: 100, h: 50 });
    });
    expect(probed!.history.canUndo).toBe(true);
    expect(probed!.history.undoLabel).toBeTruthy();

    act(() => {
      probed!.history.undo();
    });
    expect(store.getItemView('a')!.rect.x).toBe(0);
    expect(probed!.history.canRedo).toBe(true);

    act(() => {
      probed!.history.redo();
    });
    expect(store.getItemView('a')!.rect.x).toBe(400);
  });

  it('undoes exactly once per Cmd/Ctrl+Z keystroke', () => {
    render(
      <Vizbrix defaultLayout={makeDoc()} mode="edit">
        {children}
      </Vizbrix>,
    );
    const store = probed!.api.store;
    act(() => {
      store.moveItem('a', { x: 400, y: 10, w: 100, h: 50 });
    });
    act(() => {
      store.moveItem('a', { x: 500, y: 10, w: 100, h: 50 });
    });

    act(() => {
      itemEl('a').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
      );
    });

    // The core keyboard sensor owns this shortcut. A duplicate React handler on
    // the same element would land on x = 0 instead, because the sensor calls
    // preventDefault() but not stopPropagation().
    expect(store.getItemView('a')!.rect.x).toBe(400);
  });

  it('useHistory reports frozen history in view mode', () => {
    render(<Vizbrix defaultLayout={makeDoc()}>{children}</Vizbrix>);
    act(() => {
      probed!.api.store.moveItem('a', { x: 400, y: 10, w: 100, h: 50 });
    });
    expect(probed!.history.canUndo).toBe(false);
  });

  it('useSelection reflects and drives the selection channel', () => {
    render(
      <Vizbrix defaultLayout={makeDoc()} mode="edit">
        {children}
      </Vizbrix>,
    );
    expect(probed!.selection.ids).toEqual([]);

    act(() => {
      probed!.selection.set(['b']);
    });
    expect(probed!.selection.ids).toEqual(['b']);
    expect(itemEl('b').getAttribute('data-selected')).toBe('');
    // Selected items in edit mode expose resize handles.
    expect(itemEl('b').querySelectorAll('[data-vzb-handle]')).toHaveLength(8);

    act(() => {
      probed!.selection.clear();
    });
    expect(probed!.selection.ids).toEqual([]);
    expect(itemEl('b').getAttribute('data-selected')).toBeNull();
  });

  it('useVizbrix throws outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Orphan(): null {
      useVizbrix();
      return null;
    }
    expect(() => render(<Orphan />)).toThrow(/no layout context/);
    spy.mockRestore();
  });
});

describe('generated stylesheet', () => {
  it('carries the placement and is re-emitted after a commit', () => {
    render(
      <Vizbrix defaultLayout={makeDoc()} mode="edit" instanceId="fixture">
        {children}
      </Vizbrix>,
    );

    const before = styleText();
    expect(before).toContain('[data-vzb="fixture"]');
    expect(before).toContain('[data-vzb-item="a"]');
    expect(before).toContain('position:absolute');
    // Placement never appears inline (§1.3) — an inline style would beat the
    // @container override blocks.
    expect(itemEl('a').getAttribute('style') ?? '').not.toContain('left');

    act(() => {
      probed!.api.store.moveItem('a', { x: 40, y: 10, w: 100, h: 50 });
    });

    const after = styleText();
    expect(after).not.toBe(before);
    expect(after).toContain('40px');
  });
});

describe('generated stylesheet scope', () => {
  it('re-emits the sheet when instanceId changes', () => {
    const doc = makeDoc();
    const { rerender } = render(
      <Vizbrix defaultLayout={doc} instanceId="one" mode="edit">
        {children}
      </Vizbrix>,
    );
    expect(styleText()).toContain('[data-vzb="one"]');

    rerender(
      <Vizbrix defaultLayout={doc} instanceId="two" mode="edit">
        {children}
      </Vizbrix>,
    );
    // The document did not change, but every selector in the sheet did: a sheet
    // still scoped to `one` matches nothing, so every item loses its position.
    expect(document.querySelector('[data-vzb]')!.getAttribute('data-vzb')).toBe('two');
    expect(styleText()).toContain('[data-vzb="two"]');
    expect(styleText()).not.toContain('[data-vzb="one"]');
  });
});

describe('renderIncompatible', () => {
  const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

  afterEach(() => {
    if (originalWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalWidth);
    else delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth;
  });

  it('leaves the dashboard measured and interactive once the document recovers', () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 640,
    });

    const future = { ...makeDoc(), compat: 99 } as LayoutDoc;
    const good = makeDoc();
    const fallback = (): ReactNode => <p data-testid="nope">cannot show this</p>;

    const { rerender } = render(
      <Vizbrix layout={future} mode="edit" renderIncompatible={fallback} onLayoutChange={() => {}}>
        {children}
      </Vizbrix>,
    );
    expect(document.querySelectorAll('[data-vzb-item]')).toHaveLength(0);

    rerender(
      <Vizbrix layout={good} mode="edit" renderIncompatible={fallback} onLayoutChange={() => {}}>
        {children}
      </Vizbrix>,
    );

    expect(document.querySelectorAll('[data-vzb-item]')).toHaveLength(2);
    // The canvas mounted a commit AFTER the effects that measure it and attach
    // the controller first ran; both must have re-run against the real node.
    expect(probed!.api.store.getContainerWidth()).toBe(640);
    act(() => {
      probed!.api.beginPlace('a');
    });
    expect(probed!.api.store.getInteraction()).toMatchObject({ phase: 'placing', id: 'a' });
  });
});

describe('hydration', () => {
  it('hydrates server markup with no mismatch', async () => {
    const { renderToString } = await import('react-dom/server');
    const { hydrateRoot } = await import('react-dom/client');

    const tree = (
      <VizbrixView layout={makeDoc()} instanceId="hyd">
        {(item) => <span>{item.id}</span>}
      </VizbrixView>
    );

    const host = document.createElement('div');
    host.innerHTML = renderToString(tree);
    document.body.appendChild(host);
    expect(host.querySelectorAll('[data-vzb-item]')).toHaveLength(2);

    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    // A mismatch would be React's loudest warning; the server snapshot exists
    // precisely so the first client render agrees with the server (§1.21).
    let root: { unmount(): void } | null = null;
    act(() => {
      root = hydrateRoot(host, tree);
    });
    expect(errors).toEqual([]);
    act(() => {
      root!.unmount();
    });
    host.remove();
    spy.mockRestore();
  });
});

describe('the render callback', () => {
  // §1.25: a new `children` identity must NOT re-render every item — an inline
  // arrow is a new function on every parent render, and in controlled mode the
  // parent re-renders after every commit. The callback is ref-backed and the
  // box is updated silently; the documented cost is a stale-render window, and
  // `renderKey` is the documented escape hatch.
  it('does not re-render items when only the callback identity changed', () => {
    const doc = makeDoc();
    const { rerender } = render(
      <Vizbrix defaultLayout={doc} mode="edit">
        {(item) => <span>first:{item.id}</span>}
      </Vizbrix>,
    );
    expect(itemEl('a').textContent).toBe('first:a');

    rerender(
      <Vizbrix defaultLayout={doc} mode="edit">
        {(item) => <span>second:{item.id}</span>}
      </Vizbrix>,
    );
    // Nothing about item `a` changed, so item `a` did not render.
    expect(itemEl('a').textContent).toBe('first:a');
  });

  it('uses the CURRENT callback the next time an item renders for its own reason', () => {
    const doc = makeDoc();
    const { rerender } = render(
      <Vizbrix defaultLayout={doc} mode="edit">
        {(item) => (
          <span>
            first:{item.id}:{Math.round(item.rect.x)}
            {item.id === 'a' ? <Probe /> : null}
          </span>
        )}
      </Vizbrix>,
    );
    const store = probed!.api.store;

    rerender(
      <Vizbrix defaultLayout={doc} mode="edit">
        {(item) => (
          <span>
            second:{item.id}:{Math.round(item.rect.x)}
            {item.id === 'a' ? <Probe /> : null}
          </span>
        )}
      </Vizbrix>,
    );

    act(() => {
      store.moveItem('a', { x: 40, y: 0, w: 100, h: 50 });
    });
    // No stale-forever class: the commit that re-rendered `a` used the callback
    // the parent last passed, not the one it was mounted with.
    expect(itemEl('a').textContent).toBe('second:a:40');
    expect(itemEl('b').textContent).toBe('first:b:200');
  });

  it('adopts a new callback everywhere when renderKey changes', () => {
    const doc = makeDoc();
    const { rerender } = render(
      <Vizbrix defaultLayout={doc} mode="edit" renderKey="v1">
        {(item) => <span>first:{item.id}</span>}
      </Vizbrix>,
    );
    expect(itemEl('a').textContent).toBe('first:a');

    rerender(
      <Vizbrix defaultLayout={doc} mode="edit" renderKey="v2">
        {(item) => <span>second:{item.id}</span>}
      </Vizbrix>,
    );
    expect(itemEl('a').textContent).toBe('second:a');
    expect(itemEl('b').textContent).toBe('second:b');
  });

  it('exposes a drag-handle marker and a tap-to-place button', () => {
    render(
      <Vizbrix defaultLayout={makeDoc()} mode="edit">
        {(item, ui) => (
          <>
            {item.id === 'a' ? <Probe /> : null}
            <span {...ui.handleProps}>grip</span>
            <button {...ui.moveButtonProps}>move {item.id}</button>
          </>
        )}
      </Vizbrix>,
    );

    const el = itemEl('a');
    expect(el.querySelector('[data-vzb-drag-handle]')).not.toBeNull();
    const button = el.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBeTruthy();
    expect(button.getAttribute('aria-pressed')).toBe('false');

    // WCAG 2.2 SC 2.5.7: a single-pointer, non-drag alternative to dragging.
    act(() => {
      button.click();
    });
    expect(probed!.api.store.getInteraction()).toMatchObject({ phase: 'placing', id: 'a' });

    // And clicking it again backs out of the placing session.
    act(() => {
      (itemEl('a').querySelector('button') as HTMLButtonElement).click();
    });
    expect(probed!.api.store.getInteraction().phase).toBe('idle');
  });
});

describe('container measurement', () => {
  const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

  function pinClientWidth(width: number): void {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => width,
    });
  }

  afterEach(() => {
    if (originalWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalWidth);
    else delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth;
  });

  it('feeds the measured width to the store and activates named sizes', () => {
    pinClientWidth(600);
    const doc = defineLayout({
      container: { base: { width: 1000 }, sizes: { md: { maxWidth: 700 } }, stackBelow: 0 },
      items: [
        {
          id: 'a',
          x: 0,
          y: 0,
          w: 100,
          h: 50,
          at: { md: { x: { mode: 'start', offset: 20, size: 80 } } },
        },
      ],
    });

    render(
      <Vizbrix defaultLayout={doc} mode="edit">
        {children}
      </Vizbrix>,
    );

    const store = probed!.api.store;
    expect(store.getContainerWidth()).toBe(600);
    expect(store.getActiveSizes()).toEqual(['md']);
    expect(store.getItemView('a')!.rect).toMatchObject({ x: 20, w: 80 });
  });

  it('honours the size prop over the real measurement', () => {
    pinClientWidth(1000);
    const doc = defineLayout({
      container: { base: { width: 1000 }, sizes: { md: { maxWidth: 700 } }, stackBelow: 0 },
      items: [{ id: 'a', x: 0, y: 0, w: 100, h: 50 }],
    });

    render(
      <Vizbrix defaultLayout={doc} mode="edit" size="md">
        {children}
      </Vizbrix>,
    );

    expect(probed!.api.store.getContainerWidth()).toBe(700);
    expect(probed!.api.store.getActiveSizes()).toEqual(['md']);
  });

  it('ignores a zero measurement instead of collapsing the dashboard', () => {
    pinClientWidth(0);
    render(
      <Vizbrix defaultLayout={makeDoc()} mode="edit">
        {children}
      </Vizbrix>,
    );
    // The base width survives: a hidden container must not restack everything.
    expect(probed!.api.store.getContainerWidth()).toBe(1000);
    expect(probed!.api.store.isStacked()).toBe(false);
  });

  it('measures the fractional content box, not the rounded clientWidth', () => {
    // `clientWidth` is an integer; `@container (max-width:767px)` is evaluated
    // against the fractional content box. At 767.5px CSS keeps the wide rules,
    // so the resolved rects must not switch to the narrow ones.
    pinClientWidth(767);
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function rect(): DOMRect {
      return { width: 767.5, height: 400 } as DOMRect;
    };

    try {
      const doc = defineLayout({
        container: { base: { width: 1000 }, sizes: { md: { maxWidth: 767 } }, stackBelow: 0 },
        items: [{ id: 'a', x: 0, y: 0, w: 100, h: 50 }],
      });
      render(
        <Vizbrix defaultLayout={doc} mode="edit">
          {children}
        </Vizbrix>,
      );

      expect(probed!.api.store.getContainerWidth()).toBe(767.5);
      expect(probed!.api.store.getActiveSizes()).toEqual([]);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });

  it("scales the canvas wrapper under responsive:'scale'", () => {
    pinClientWidth(600);
    const doc = defineLayout({
      container: { base: { width: 1200, height: 800 }, responsive: 'scale' },
      items: [{ id: 'a', x: 0, y: 0, w: 100, h: 50 }],
    });

    const { container } = render(
      <Vizbrix defaultLayout={doc} mode="edit">
        {children}
      </Vizbrix>,
    );

    const canvas = container.querySelector('[data-vzb]') as HTMLElement;
    expect(canvas.style.transform).toBe('scale(0.5)');
    expect(canvas.parentElement!.style.overflow).toBe('hidden');
    // Design-space geometry is untouched: only the wrapper is scaled (§4).
    expect(probed!.api.store.getItemView('a')!.rect.w).toBe(100);
  });
});

describe('VizbrixView', () => {
  it('renders the same shells with no editing affordances', () => {
    render(
      <VizbrixView layout={makeDoc()} instanceId="ro">
        {(item) => <span data-testid={item.id}>{item.id}</span>}
      </VizbrixView>,
    );

    expect(document.querySelectorAll('[data-vzb-item]')).toHaveLength(2);
    expect(itemEl('a').getAttribute('role')).toBeNull();
    expect(document.querySelector('[data-vzb-guides]')).toBeNull();
    expect(styleText()).toContain('[data-vzb="ro"] [data-vzb-item="a"]');
  });

  it('adopts a new layout prop', () => {
    const { rerender } = render(
      <VizbrixView layout={makeDoc()} instanceId="ro">
        {(item) => <span>{item.id}</span>}
      </VizbrixView>,
    );
    const next = defineLayout({
      container: { base: { width: 1000 }, stackBelow: 0 },
      items: [{ id: 'c', x: 5, y: 5, w: 10, h: 10 }],
    });
    rerender(
      <VizbrixView layout={next} instanceId="ro">
        {(item) => <span>{item.id}</span>}
      </VizbrixView>,
    );
    expect(document.querySelectorAll('[data-vzb-item]')).toHaveLength(1);
    expect(document.querySelector('[data-vzb-item="c"]')).not.toBeNull();
  });
});
