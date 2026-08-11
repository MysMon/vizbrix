# Importing a column-grid layout

Most cell-based dashboard tools persist layouts in the same de-facto shape: an array of
`{ i, x, y, w, h }` items measured in *columns and rows*, optionally one array per breakpoint.
`importFromGrid` converts that shape into a vizbrix document.

It is a **one-way converter**, not a compatibility shim. A grid stores cells; vizbrix stores
expressions. A shim would have to leak the cell model back into the core, which is the one thing
this library exists not to do — so the conversion happens once, at the boundary, and afterwards you
have a vizbrix document.

## The one-shot conversion

```ts
import { importFromGrid, isLoaded } from 'vizbrix';
import { serialize } from 'vizbrix/schema';

const outcome = importFromGrid(savedLayout, { cols: 12, rowHeight: 30, margin: [10, 10] });

if (isLoaded(outcome)) {
  await db.dashboards.update(id, { layout: serialize(outcome.doc), engine: 'vizbrix' });
} else {
  report(outcome);   // 'invalid' — malformed input, never a throw
}
```

`importFromGrid` returns the same `LoadOutcome` as `load()` and never throws. Run it in a migration
script and write the result back once — not at runtime on every page load.

### Options

| option | default | meaning |
|---|---|---|
| `cols` | required | column count. A number, or `{ lg: 12, md: 10, … }` for the responsive form |
| `rowHeight` | required | row height in px |
| `margin` | `[10, 10]` | `[horizontal, vertical]` gap between cells in px |
| `containerPadding` | `margin` | padding between the grid and the container edge |
| `containerWidth` | `1200` | the width cells are resolved at, and the produced `base.width` |
| `breakpoints` | see below | min-width thresholds; responsive form only |

Cells are resolved to pixels with the standard column-grid arithmetic
(`colWidth = (W − margin·(cols−1) − padding·2) / cols`), so the imported dashboard is
pixel-identical to what the grid painted at `containerWidth`.

## Anchor inference

The interesting part of the conversion is deciding what each cell *meant*. A cell that ends at the
last column was pinned to the right edge; a cell spanning half the grid was proportional. That
intent is recoverable, and it is what makes the imported layout reflow instead of freezing:

| condition (x axis) | inferred anchor | why |
|---|---|---|
| `x === 0 && x + w === cols` | `both` | full-bleed row — stretch between both edges |
| `x + w === cols` | `end` | right-docked — keep it against the right edge |
| `w / cols >= 0.5` | `scale` | a major column — keep its share of the width |
| otherwise | `start` | ordinary cell — fixed px from the left |

Order matters: full-bleed beats right-docked beats proportional.

**The y axis is always `start`.** A column grid scrolls, so the container has no definite height and
vertical anchors are unresolvable. See the `height: 'fill'` rule in
[responsive layout](./responsive.md) — if the imported dashboard should fill a fixed-height frame,
set `container.height = 'fill'` with a `base.height` afterwards and re-anchor the items you want
pinned to the bottom (`store.setAnchor(id, 'y', 'end')` moves nothing).

Inference is a heuristic. Open the imported dashboard, resize the window, and fix the handful of
items it guessed wrong — that is a five-minute job and the only part of this migration that needs a
human.

## Responsive layouts

Grid breakpoints are conventionally **min-widths, desktop-last**; vizbrix sizes are **max-widths,
desktop-first**. The converter maps them so the two selection rules agree exactly at every width:
the largest breakpoint becomes the document base, and every smaller breakpoint becomes a declared
size whose `maxWidth` is the min-width of the next larger breakpoint.

```ts
importFromGrid({ lg: [...], md: [...], sm: [...] }, { cols: { lg: 12, md: 10, sm: 6 }, rowHeight: 30 });
```

With the converter's default breakpoints:

| breakpoint | min-width | becomes |
|---|---|---|
| `lg` | 1200 | the document base (no size entry) |
| `md` | 996 | `sizes.md = { maxWidth: 1200 }` |
| `sm` | 768 | `sizes.sm = { maxWidth: 996 }` |
| `xs` | 480 | `sizes.xs = { maxWidth: 768 }` |
| `xxs` | 0 | `sizes.xxs = { maxWidth: 480 }` |

Each breakpoint's cells are resolved at that size's `maxWidth` — the widest container the override
is active in — and written into the item's `at` map. **Overrides identical to the base placement are
omitted**, so an item you never moved between breakpoints imports as one placement instead of five,
and the anchors take over from there. That is usually most of them.

An item that appears only at a smaller breakpoint is promoted into the base layout with a warning in
`issues`.

## What carries over

| grid layout | vizbrix |
|---|---|
| `x, y, w, h` (cells) | pixel rect at `containerWidth`, re-encoded with an inferred anchor |
| `i` (or `id`) | `item.id`. Missing keys get a generated `cell-N`; duplicates are skipped with a warning |
| `minW`, `maxW`, `minH`, `maxH` (spans) | `minW`/`maxW`/`minH`/`maxH` in px |
| `static: true`, `isDraggable: false` | `locked: true` |
| breakpoint layouts | `container.sizes` + per-item `at` overrides |
| visual order (row, then column) | stacking order — evenly spread fractional `z` keys |

## What does not carry over

- **Compaction.** `verticalCompact`, `compactType`, and the whole "items fall upward" behaviour have
  no analogue: free placement means an item stays where it was put. This is the point, but it is
  also the biggest behavioural difference your users will notice on day one.
- **Collision configuration.** `preventCollision`, `allowOverlap` and `isBounded` are not translated.
  vizbrix has a per-item `collision` policy (`allow` | `guide` | `forbid`, default `allow`) — set it
  where you actually want it. There is deliberately no `push` policy: pushing is compaction under
  another name.
- **`static` as an algorithm flag.** In a compacting grid, `static` means "the compactor may not
  move this". The closest honest mapping is "the user may not move this", so it becomes
  `locked: true`. Nothing maps to `collision: 'forbid'` — that would be inventing intent the source
  document never expressed.
- **`isResizable`.** Accepted and ignored; use `locked` or your own chrome.
- **`rowHeight`, `margin`, `cols`.** Baked into the pixel geometry at import time. There is no grid
  afterwards — if you want one back as a *snapping* behaviour, that is `snap={{ grid: 8 }}`, which
  never touches what is stored.
- **Drag-in from outside, width-measuring wrappers, responsive wrapper components.** Different
  component surface entirely; see [getting started](./getting-started.md).

## Component-level changes

```diff
-<GridDashboard layout={layout} cols={12} rowHeight={30} width={1200} onLayoutChange={save}>
-  {items.map((item) => <div key={item.i}>{item.i}</div>)}
-</GridDashboard>
+<Vizbrix defaultLayout={doc} mode="edit" onLayoutChange={(next) => save(next)}>
+  {(item, ui) => <div {...ui.handleProps}>{item.id}</div>}
+</Vizbrix>
```

Four differences to plan for:

1. **Children are a render callback, not an array.** vizbrix owns the item shells (that is what makes
   per-item subscriptions possible); you render the contents.
2. **No `width` prop.** The container measures itself, and the first paint is correct before it does
   — see [SSR](./ssr.md).
3. **`onLayoutChange(doc, tx)` hands you the whole document plus the transaction.** Persist the
   document with `serialize()`; there is no layout array.
4. **`mode` defaults to `'view'`.** Pass `mode="edit"` or nothing is draggable. Read-only surfaces
   should import `vizbrix/react/view` instead and drop the interaction layer entirely.

## What you get for it

- Widgets stay where they are put, at pixel precision, overlapping if that is the design.
- The dashboard reflows continuously instead of jumping between a handful of authored layouts.
- Correct first paint under SSR with no measured width.
- Zero sibling re-renders during a drag, and no compaction pass to be quadratic in.
- Undo/redo, keyboard placement, WCAG 2.2 SC 2.5.7 tap-to-place, and a versioned layout format —
  all of which were previously your application's problem.
