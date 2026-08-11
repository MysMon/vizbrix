# Responsive layout

Free placement that reflows, not free placement that shrinks. Three tiers, applied in this order.

| Tier | Mechanism | When it applies |
|---|---|---|
| 1 | **Constraint anchors** per item, per axis | always, continuously, at every width |
| 2 | **Named sizes** (`sizes` + per-item `at`), container-query cascade | where you authored an override |
| 3 | **Deterministic stack** below `stackBelow` | narrow containers (default: under 480px) |

All three compile to static CSS. Nothing here measures anything at first paint.

## Tier 1 — anchors

A position is stored as an *expression*, not a number: `pct% of the container extent + px`. Each
axis carries a mode that says which edge the offset is measured from.

| mode | stores | resolves to | use it for |
|---|---|---|---|
| `start` | `offset`, `size` | `pos = offset` | pinned to the left/top (the default) |
| `end` | `offset`, `size` | `pos = W − offset − size` | pinned to the right/bottom |
| `both` | `start`, `end` | `size = W − start − end` | stretch between both edges |
| `center` | `offset`, `size` | `pos = W/2 + offset − size/2` | stays centred |
| `scale` | `offset`, `size` | same as `start` | proportional — re-encodes as `%` |

`start` and `scale` resolve identically; they differ in what an *edit* writes back. Dragging an item
whose x mode is `start` writes pixels; dragging one whose x mode is `scale` writes percentages, so
it keeps its share of the width.

Authoring with `defineLayout` uses flat pixel sugar plus an `anchor`:

```ts
import { defineLayout } from 'vizbrix';

const layout = defineLayout({
  container: { base: { width: 1200 } },
  items: [
    { id: 'nav', x: 0, y: 0, w: 240, h: 600 },                              // start (default)
    { id: 'alerts', x: 936, y: 0, w: 240, h: 300, anchor: { x: 'end' } },   // 24px from the right
    { id: 'timeline', x: 264, y: 320, w: 912, h: 280, anchor: { x: 'both' } },
    { id: 'kpi', x: 264, y: 0, w: 648, h: 300, anchor: { x: 'scale' } },
  ],
});
```

The pixel rect you authored is what resolves at `base.width`; the anchor decides what happens
everywhere else. `anchor: 'scale'` is shorthand for both axes at once.

Anchors are per-axis and independent: `anchor: { x: 'both', y: 'start' }` is a full-bleed banner
that keeps its authored height, and `{ x: 'end', y: 'end' }` is a corner-docked widget.

To change an anchor later without moving the item, use `store.setAnchor(id, 'x', 'end')` — it
resolves at the current extent, re-encodes in the new mode, and commits one transaction.

### The `height: 'fill'` rule

Vertical `end`, `both`, `center` and `scale` all need to know where the container's bottom edge is.
A page-height container that grows with its content has no such edge, so:

```ts
container: { base: { width: 1200, height: 800 }, height: 'fill' }
```

- `height: 'auto'` (the default) — the container's height is content-determined. Vertical anchors
  other than `start` are unresolvable and **degrade to `start`** with a dev-mode warning. The y axis
  is emitted as fixed `top`/`height` pixels resolved against `base.height`, so JS and CSS agree.
- `height: 'fill'` **with a `base.height`** — the container fills its parent and every y mode is
  honoured.

`bottom:` is never emitted against an auto height. This is the one place where the model is
deliberately less expressive than CSS: percentages against an indefinite height are exactly the
category of bug that makes layouts pop after hydration.

## Tier 2 — named sizes and the `at` cascade

Anchors handle *degradation*. Named sizes handle *different intent*: "on a narrow container this
card belongs under the chart, not beside it".

```ts
const layout = defineLayout({
  container: {
    base: { width: 1200 },
    sizes: { md: { maxWidth: 900 }, sm: { maxWidth: 600 } },
  },
  items: [
    {
      id: 'alerts',
      x: 936, y: 0, w: 240, h: 300,
      anchor: { x: 'end' },
      at: {
        md: { x: { mode: 'both', start: 16, end: 16 } },
        sm: { hidden: true },
      },
    },
  ],
});
```

Rules:

- A size is **active when the measured container width is ≤ its `maxWidth`**. Sizes are
  desktop-first and cascade: at 500px both `md` and `sm` are active, and the smaller one wins.
- Overrides fold **field by field**, in descending `maxWidth` order. Anything you don't override
  keeps cascading down from the larger size — not "one complete layout per breakpoint".
- A **placement replaces wholesale**. `x` and `y` are discriminated unions whose modes have disjoint
  fields, so merging half of a `center` into a `both` is unsound and is not attempted. Write the
  whole axis.
- Only `x`, `y`, `hidden` and `order` may be overridden. **Per-size `z` is forbidden** — an item
  that changes stacking order by width is a different item.
- These are **container queries** (`@container vzb-… (max-width: …)`), not viewport media queries.
  Dashboards get embedded in sidebars, split panes and modals, where the viewport width is simply
  the wrong number.

The JS resolver and the emitted CSS run the same cascade and are held together by differential
tests, so `item.rect` in your render callback always matches what the browser painted.

### Where an edit lands

When a named size is active and the user drags something, the commit writes into the **innermost
active size**, not the base:

```
container is 800px wide → md is active → the drag writes item.at.md.x / .y
```

The base layout is untouched, and the undo label says so: *"Undo move: alerts (md)"*. This is what
lets someone tidy up the tablet layout without wrecking the desktop one.

To edit a specific size on a desktop screen, force it:

```tsx
<Vizbrix defaultLayout={layout} mode="edit" size="md">{render}</Vizbrix>
```

`size` pins the measured width to that size's `maxWidth`. It is also how you render a breakpoint in
a visual test or a component preview without resizing anything.

## Tier 3 — the deterministic stack

Below `stackBelow` (default **480px**, `0` disables it) the container becomes a flex column and
every item goes `position: static; width: auto` with its resolved base height and an explicit
`order`. Free placement does not degrade gracefully at phone widths; rather than pretend otherwise,
vizbrix gives a predictable, overridable answer.

Order is:

1. `item.order`, when set — an explicit intent, applied at any size (and overridable per size via
   `at.<size>.order`).
2. Otherwise the **geometric reading order**: resolved `y` at `base.width`, then `x`, then `id`.
   Computing it at the base width rather than the current one keeps the order stable across
   resizes and identical on the server.

```ts
{ id: 'summary', x: 900, y: 400, w: 280, h: 200, order: 0 }   // first in the stack, wherever it sits
```

Items without an `order` keep their geometric rank, so `order: 0` promotes one card without
disturbing the rest.

## Escape hatch — `responsive: 'scale'`

For kiosks, TV walls and pixel-perfect print, uniform scaling really is the right answer:

```ts
container: { base: { width: 1600, height: 900 }, responsive: 'scale' }
```

The adapter wraps a fixed base-size canvas and applies `transform: scale()` to the **wrapper**,
never to items — so hit-testing, snapping and the stored geometry all stay in design space, and
pointer deltas are divided by the scale factor. No `@container` blocks are emitted in this mode,
and tier 2/3 do not apply. It is deliberately the non-default: it is what makes commercial BI tools
unreadable on a phone.

## Debugging a layout

- `resolveItem(item, container, width, height?)` — the pure resolver. Same function the adapter and
  the CSS emitter agree with; call it in a test.
- `activeSizesAt(container, width)` — which named sizes are active, outermost first.
- `foldItem(item, activeSizes)` — the item after the `at` cascade.
- `emitStylesheet(doc, instanceId, zRanks)` — the exact CSS that ships. Reading it is the fastest
  way to see what a mode compiled to.

## See also

- [Getting started](./getting-started.md)
- [SSR & RSC](./ssr.md) — why all of this is expressible without measuring
- [Persistence](./persistence.md) — `sizes` and `at` are part of the versioned contract
