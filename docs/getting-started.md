# Getting started

## Install

```sh
npm install vizbrix      # pnpm add vizbrix · yarn add vizbrix
```

React 18 or 19 is an optional peer dependency. There are no runtime dependencies.

Entry points, so you import only what you ship:

| Import | Contains |
|---|---|
| `vizbrix` | the framework-agnostic core: schema, geometry, store, ops, snap, grid import |
| `vizbrix/react` | `<Vizbrix>` — the editor |
| `vizbrix/react/view` | `<VizbrixView>` — read-only, no sensors, no history |
| `vizbrix/react/static` | `<VizbrixStatic>` — RSC-safe, no client JavaScript |
| `vizbrix/schema` | types + `validate`/`load`/`migrate`/`serialize` for servers and scripts |
| `vizbrix/locales/ja` | Japanese strings (English is built in) |

## Your first dashboard

A layout document has a container and a list of items. `defineLayout` accepts flat pixel sugar and
normalizes it into the canonical document.

```tsx
import { defineLayout } from 'vizbrix';

const layout = defineLayout({
  container: { base: { width: 1200 } },
  items: [
    { id: 'revenue', x: 0, y: 0, w: 580, h: 260 },
    { id: 'signups', x: 620, y: 0, w: 580, h: 260 },
    { id: 'funnel', x: 0, y: 300, w: 1200, h: 320 },
  ],
});
```

`container.base.width` is required. It fixes what a pixel offset *means*, the reading order used
when the layout stacks on a phone, and the rect the server renders — changing it later is a
migration-class edit, so pick your design width once.

Render it:

```tsx
import { Vizbrix } from 'vizbrix/react';

export function Dashboard() {
  return (
    <Vizbrix defaultLayout={layout} mode="edit">
      {(item, ui) => (
        <article className="card">
          <header {...ui.handleProps}>{item.id}</header>
          <button {...ui.moveButtonProps}>Move</button>
          <Widget id={item.id} />
        </article>
      )}
    </Vizbrix>
  );
}
```

The `children` callback receives `(item, ui)`:

- `item` — `{ id, rect, hidden, locked, data? }`. `rect` is resolved at the current measured width.
- `ui` — `isSelected`, `isDragging`, `isResizing`, `isPlacing`, plus `handleProps`,
  `moveButtonProps`, `attributes`, and the actions `remove()`, `bringToFront()`, `select()`.

`handleProps` is optional: spread it on a sub-element to make only that element start a drag; if you
never spread it, the whole item is the handle. `moveButtonProps` is the accessibility affordance —
render it and every drag gains a single-pointer, non-drag alternative (WCAG 2.2 SC 2.5.7). See
[accessibility](./accessibility.md).

vizbrix writes no positional inline styles — every `left/top/width/height` comes from a generated
stylesheet, so `@container` overrides are never out-specified. Style items however you like; the
library only sets `data-vzb-item`, plus `data-selected`, `data-dragging`, `data-resizing` and
`data-locked` for you to hook.

```css
[data-vzb-item] { background: #fff; border-radius: 8px; }
[data-vzb-item][data-selected] { outline: 2px solid #4c8dff; }
```

## Edit and view

`mode` defaults to `'view'`, and view mode attaches **no listeners at all** — not no-op guarded
ones. Geometry is identical between modes, so `<Vizbrix mode={editing ? 'edit' : 'view'}>` cannot
shift a pixel when it flips.

If a surface is *only* ever read-only, import the smaller entry point instead — it ships without the
interaction layer, the overlay and history:

```tsx
import { VizbrixView } from 'vizbrix/react/view';
<VizbrixView layout={doc}>{(item) => <Widget id={item.id} />}</VizbrixView>
```

## Controlled and uncontrolled

```tsx
// uncontrolled — vizbrix owns the document and reports commits
<Vizbrix defaultLayout={layout} mode="edit" onLayoutChange={(doc, tx) => save(doc)}>{render}</Vizbrix>

// controlled — you own it
<Vizbrix layout={doc} mode="edit" onLayoutChange={(next) => setDoc(next)}>{render}</Vizbrix>
```

`onLayoutChange(doc, tx)` fires once per committed transaction — one gesture, one call. The second
argument is the transaction (`{ label, ops, source, actor? }`); it is never stamped onto the
document. Cancelled gestures and drops back at the origin commit nothing and fire nothing.

In controlled mode the commit lands in the store first and is reported afterwards, so a slow parent
cannot stutter a drag. Whatever you pass next is honoured: pass the document you received — or a
transform of it (snapping to your own rules, stripping a field) — to accept, and undo history
survives; pass a copy of the *previous* document to reject and roll the commit back. Adopting
asynchronously (`await save(next); setDoc(next)`, or inside a transition) is fine — the store keeps
the committed document until the prop changes.

## Saving and loading

`serialize()` writes canonical JSON with a stable key order, so layout diffs are reviewable.
`load()` reads it back and **never throws** for any input — it returns a `LoadOutcome`, so you write
a `switch` instead of a `try`.

```tsx
import { load, isLoaded, serialize } from 'vizbrix/schema';

await db.dashboards.update(id, { layout: serialize(doc) });

const outcome = load(row.layout);

if (!isLoaded(outcome)) {
  return <LayoutBroken outcome={outcome} />;   // 'incompatible' | 'invalid'
}
if (outcome.status === 'migrated') {
  await db.dashboards.update(id, { layout: serialize(outcome.doc) });  // write back once
}

return <VizbrixView layout={outcome.doc}>{render}</VizbrixView>;
```

`isLoaded` narrows to the three arms that carry a document (`ok`, `migrated`, `forward-degraded`).
Full details in the [persistence guide](./persistence.md).

## Undo, redo, selection

Inside the provider, three hooks give you the editor chrome:

```tsx
import { useHistory, useSelection, useVizbrix } from 'vizbrix/react';

function Toolbar() {
  const { canUndo, canRedo, undo, redo, undoLabel } = useHistory();
  const { ids } = useSelection();
  const { store } = useVizbrix();

  return (
    <div>
      <button onClick={undo} disabled={!canUndo}>{undoLabel ?? 'Undo'}</button>
      <button onClick={redo} disabled={!canRedo}>Redo</button>
      <button onClick={() => ids.forEach((id) => store.removeItem(id))}>Delete {ids.length}</button>
    </div>
  );
}
```

Each hook subscribes to exactly one store channel: `useSelection` does not re-render on a move,
`useHistory` does not re-render on a selection change, and neither re-renders during a gesture.
Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z already work on the container in edit mode — do not add your own
handler for them.

`useVizbrix().store` is the full engine API: `moveItem`, `resizeItem`, `addItem`, `removeItem`,
`bringToFront`, `sendToBack`, `setAnchor`, `setHidden`, `setLocked`, `setOrder`, `setData`,
`apply(ops)`, plus the subscription channels. `addItem` takes the same flat sugar `defineLayout`
does — `store.addItem({ id: 'kpi', x: 40, y: 40, w: 300, h: 200 })` lands the new item on top.

For chrome that lives *outside* the dashboard subtree — an app toolbar, a command palette — the
`apiRef` prop exposes the same API through a ref. Inside the subtree, `useVizbrixItem(id)`
subscribes a panel to one item's committed state without re-rendering on anything else.

## Snapping

Snapping is on by default for sibling edges and centres, equal gaps, and container edges. A grid is
opt-in, because a grid is an interaction here, not a data model:

```tsx
<Vizbrix defaultLayout={layout} mode="edit" snap={{ grid: 8, threshold: 8, bypassKey: 'meta' }}>
  {render}
</Vizbrix>
```

- `grid` — step in px, or `false` (default).
- `threshold` — screen px, divided by canvas scale. Default 8.
- `bypassKey` — hold to suspend snapping mid-gesture. Default `'meta'` (Cmd on macOS, Ctrl
  elsewhere); `'none'` disables the bypass.
- `siblings`, `gaps`, `containerEdges` — turn individual providers off. `snap={false}` disables
  everything.

Because snapping never touches the stored model, changing any of this cannot invalidate a saved
layout.

## Next

[Responsive layout](./responsive.md) · [Accessibility](./accessibility.md) ·
[SSR & RSC](./ssr.md) · [Persistence](./persistence.md) ·
[Importing a column-grid layout](./import-from-grid.md)
