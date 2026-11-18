# Architecture

## Layers

```
src/core      framework-free: no React, no DOM at module scope (lint-enforced)
  types.ts        the persisted document
  doc.ts          createDashboard · parseDashboard (never throws) · serializeDashboard
  geometry.ts     variants, the flow layout, tile → pixel maths, CSS compilation
  ops.ts          pure document transforms; return the same doc when nothing changed
  snap.ts         snapping (sibling edges/centres, canvas edges, grid)
  store.ts        state + undo history + selection
  interaction.ts  pointer and keyboard gestures against a small DOM contract
  grid.ts         importFromGrid
src/react     the adapter
  Dashboard.tsx   client component: store wiring, toolbar, canvas, live region
  Static.tsx      hook-free Server Component producing the same markup
  Shell.tsx       brick chrome shared by both
src/charts    client components: LineChart, BarChart, figures, DataTable
src/bricks    server-safe registry mapping brick types onto src/charts
```

`vizbrix/bricks` imports the charts through the package's own `vizbrix/charts` export, which is kept
external in the build. That import is the client boundary: a Server Component can read the registry
and call `render`, and what comes back are client-component elements with serializable props.

## The document

```ts
{ version: 1, width: 1200, gap: 16, padding: 0,
  breakpoints: [{ name: 'md', maxWidth: 960, columns: 2 }, { name: 'sm', maxWidth: 600, columns: 1 }],
  items: [{ id, type, x, y, w, h, title?, props?, pin?, locked?, minW?, minH? }],
  layouts: { sm: { [id]: { x, y, w, h } } } }      // only for breakpoints arranged by hand
```

- Coordinates are design units: pixels at the design width. Array order is paint order.
- Rects are **tiles**. The visible box is the tile inset by `gap / 2` on each side.

## Geometry

With container width `W`, design width `D`, gap `G`, padding `P`, the canvas of tiles is
`C = W + G − 2P` wide. For a `scale` brick:

```
left  = P + (x / D) · C
width = (w / D) · C − G
```

Both are affine in `W` (`a·W + b`), as is every other pin, so each compiles to `calc(a·100% + b px)`.
Vertical geometry is plain pixels: `top = P + y`, `height = h − G`. `toPixels` and `fromPixels` are
exact inverses, which is what lets gestures run in screen space and commit in design units.

A **variant** is one concrete arrangement: `base`, or one per breakpoint. A breakpoint variant uses
the breakpoint's `maxWidth` as its design width and always scales. Its rects come from
`doc.layouts[name]` when present; otherwise `flowLayout` derives them (reading order → rows of N
columns → ragged rows stretch their last brick → bricks in a row share its height). Bricks added
after a breakpoint was hand-arranged flow in below.

`compileCss` emits the base rules followed by one `@container vbx (max-width: …)` block per
breakpoint, largest first.

## Editing

`attachInteractions` installs delegated listeners on the canvas. A gesture:

1. activates after 3px of travel, snapshots the variant and frame;
2. each animation frame converts the pointer delta to design units, snaps, clamps, and writes
   `transform` (move) or `left/top/width/height` (resize) to the dragged elements, plus guide lines;
3. on release calls `store.setRects` once and clears the inline styles.

Siblings are expressed in the dragged brick's coordinate frame, so snapping compares like with like
across different pins. Edits apply to the variant on screen: in a breakpoint the first edit
materialises the derived layout into `doc.layouts`.

The store keeps previous documents for undo (documents are immutable and structurally shared).
Commits carrying the same `coalesce` key within ~1.2s merge into one step.

## Rendering

- `Surface` subscribes to the document and renders the stylesheet and the item list.
- Each `Item` subscribes to its own item, the edit flag and its selection state; brick content is
  memoized on `(item, definition, data, editing, messages)`.
- Charts split marks (memoized on data and size) from the hover layer (owns the hover state).
