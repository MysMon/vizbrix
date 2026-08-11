# vizbrix

**Free-placement dashboard layout for React. Pixel-precise placement that actually reflows.**

[![CI](https://github.com/MysMon/vizbrix/actions/workflows/ci.yml/badge.svg)](https://github.com/MysMon/vizbrix/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen)](#size)
[![types: included](https://img.shields.io/badge/types-included-blue)](#typescript)
[![React 18 | 19](https://img.shields.io/badge/react-18%20%7C%2019-61dafb)](#install)

Widgets go exactly where you drop them — arbitrary x/y, any size, overlapping if you want — and
stay sensible when the container resizes.

*[日本語版 README →](./README.ja.md)*

---

## Why

Dashboard layout tools usually come in one of two shapes, and both make free placement a
second-class citizen.

**Column-grid engines** store position as integer cell coordinates: `x, y, w, h` mean *columns and
rows*. That is not a styling default — it is the storage model, the collision model and the
persistence format at once, so free placement is not reachable by configuration. The "free" modes
such engines offer are flags that *switch off* core behaviour (skip compaction, give up collision
handling) rather than express a different model.

**Freeform transform layers** do arbitrary pixel placement beautifully — and ship no dashboard
semantics: no collision policy, no persistence schema, no responsive strategy, no accessibility.
Teams hand-assemble them into canvas editors.

**vizbrix is the middle.** Positions persist as continuous, resolution-independent *expressions*;
a 12-column grid is one snap provider among several, toggled at interaction time and never baked
into the model; responsiveness is a computed property of each item rather than a hand-authored
layout array per breakpoint; and the serialized document is a versioned contract you can put in a
database.

The one-line version: **free placement that reflows, not free placement that shrinks.**

---

## Install

```sh
npm install vizbrix      # pnpm add vizbrix · yarn add vizbrix
```

React 18 or 19 is an **optional** peer dependency — the core engine has no React dependency at
all, so a Vue/Svelte/vanilla adapter needs nothing but the public core surface.

## 60 seconds

```tsx
import { defineLayout } from 'vizbrix';
import { Vizbrix } from 'vizbrix/react';

const layout = defineLayout({
  container: { base: { width: 1200 }, sizes: { md: { maxWidth: 900 } } },
  items: [
    { id: 'revenue', x: 0, y: 0, w: 580, h: 260 },
    { id: 'signups', x: 620, y: 0, w: 580, h: 260, anchor: { x: 'end' } },
    { id: 'funnel', x: 0, y: 300, w: 1200, h: 320, anchor: { x: 'both' } },
  ],
});

export function Dashboard() {
  return (
    <Vizbrix defaultLayout={layout} mode="edit" onLayoutChange={(doc) => save(doc)}>
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

`defineLayout` accepts flat pixel sugar (`x, y, w, h` in base-design space) and normalizes it into
the canonical document: anchors re-encoded at the base width, fractional z-keys generated, lengths
canonicalized, items sorted. Drag a card and `onLayoutChange(doc, tx)` fires once per gesture with
the new document and the transaction that produced it.

Read-only is a different entry point, not a prop:

```tsx
import { VizbrixView } from 'vizbrix/react/view';   // no sensors, no history
<VizbrixView layout={doc}>{(item) => <Widget id={item.id} />}</VizbrixView>
```

```tsx
import { VizbrixStatic } from 'vizbrix/react/static'; // RSC-safe, no "use client"
<VizbrixStatic layout={doc}>{(item) => <Widget id={item.id} />}</VizbrixStatic>
```

**[Getting started →](./docs/getting-started.md)**

---

## What you get

- **Free placement as the storage primitive.** Positions are affine expressions in the container
  extent (`a·W + b`), not column indices. Snap to sibling edges and centres, to equal gaps, to
  container edges — or to a grid (`snap={{ grid: 8 }}`, off by default). Hold **Cmd/Ctrl** to
  bypass snapping mid-gesture; the modifier is configurable via `snap={{ bypassKey: 'alt' }}`.
  Snapping is an interaction, so turning it off never changes what is stored.

- **Constraint anchors that reflow.** Each axis carries one of `start | end | both | center | scale`
  — pin to a side, stretch between both, stay centred, or scale proportionally. Resolution is a
  pure, total, measurement-free function, so the same layout is correct at 1440px and 380px without
  a second authored layout. [Responsive guide →](./docs/responsive.md)

- **SSR-correct by construction.** Every placement compiles to static CSS (`left: calc(50% + 12px)`,
  `inset`, `@container (max-width: …)`), so the first paint is right with **zero JavaScript** and no
  measured width. `vizbrix/react/static` is a real React Server Component entry — no `"use client"`
  banner, no hooks, no effects, no event handlers. [SSR guide →](./docs/ssr.md)

- **Dragging one widget never re-renders another.** Layout lives in an external store with per-item
  channels; a drag frame touches the dragged node's `transform` and the overlay's guide lines, both
  imperatively — zero sibling re-renders during a drag, exactly one item render at commit, under
  StrictMode too. There is no compaction pass, so the O(n²) class of layout bug does not exist here.

- **Accessible, not "accessible later".** Full keyboard placement (grab/nudge/resize/snap-jump/
  cancel/z-order), `role="button"` + `aria-roledescription` + off-screen instructions, two live regions
  (assertive for gesture transitions, polite for position status), and a **tap-to-place** affordance
  that satisfies **WCAG 2.2 SC 2.5.7 (Dragging Movements, AA)** — every drag has a single-pointer,
  non-drag alternative. English is built in, Japanese ships as `vizbrix/locales/ja`, and strings are
  *functions*, so translators can reorder clauses rather than fill in a fixed template.
  [Accessibility guide →](./docs/accessibility.md)

- **A persistence contract you can bet a product on.** `{ version, compat, container, items }` with
  `load()` that **never throws** for any input — it returns a `LoadOutcome` with arms
  `ok | migrated | forward-degraded | incompatible | invalid`. Unknown keys from a newer writer are
  parked in `$unknown` and re-emitted verbatim, `serialize()` has stable key order so layout diffs
  are reviewable, and the migration runner reports every dropped field with a path.
  [Persistence guide →](./docs/persistence.md)

- **Undo/redo from v0.1.** Inverse-op transactions, one gesture = one entry, human-readable labels
  ("Undo move: revenue (md)"), rebase-before-invert, blocked in view mode, and no entry at all for a
  cancelled or no-op drag. The ops are CRDT-shaped (fractional z-index keys, per-actor
  transactions), which is why multiplayer will be an integration guide rather than a rewrite.

- **An import path from column grids.** `importFromGrid(layouts, { cols, rowHeight })` converts
  the common cell-based dashboard format — a single layout or a whole `{ lg, md, sm, … }`
  responsive set — inferring an anchor per item from its relationship to the grid. It is a one-way
  converter, deliberately not a compatibility shim.
  [Import guide →](./docs/import-from-grid.md)

- **Zero runtime dependencies. MIT. TypeScript source, bundled types.**

---

## Anchors in 20 lines

An anchor answers "what does this coordinate mean when the container is a different width?".

```tsx
const layout = defineLayout({
  container: { base: { width: 1200 }, sizes: { md: { maxWidth: 900 } } },
  items: [
    // pinned to the left edge, fixed width (the default)
    { id: 'nav', x: 0, y: 0, w: 240, h: 600 },
    // pinned to the RIGHT edge — 24px from it at every width
    { id: 'alerts', x: 936, y: 0, w: 240, h: 300, anchor: { x: 'end' } },
    // stretches: pinned to both edges, width derived
    { id: 'timeline', x: 264, y: 320, w: 912, h: 280, anchor: { x: 'both' } },
    // proportional: keeps its share of the width
    { id: 'kpi', x: 264, y: 0, w: 648, h: 300, anchor: { x: 'scale' } },
    // and one hand-authored override, applied only when the container is ≤ 900px
    {
      id: 'alerts-md', x: 0, y: 620, w: 240, h: 300,
      at: { md: { x: { mode: 'both', start: 16, end: 16 } } },
    },
  ],
});
```

Three tiers, in this order: **anchors** reflow continuously at every width; **named sizes**
(`sizes` + per-item `at`) cascade desktop-first for the places where you want different *intent*,
using container queries rather than viewport media queries, because dashboards get embedded in
sidebars; and below `stackBelow` (default 480px) the layout collapses to a deterministic
single-column stack ordered by reading order. `responsive: 'scale'` is the escape hatch for
kiosk/TV-wall cases where uniform scaling really is what you want.

Vertical anchors other than `start` need a container with a definite height —
`container: { base: { width, height }, height: 'fill' }`. Without it they degrade to `start` with a
dev warning, because a scrolling container has no bottom edge to anchor against.
[Full model →](./docs/responsive.md)

## Modes and control

`mode` defaults to `'view'`, and view mode attaches **no listeners at all** — not no-op guarded
ones. Geometry is byte-identical between modes, so toggling `mode="edit"` cannot shift a pixel.

```tsx
// uncontrolled: vizbrix owns the document, you observe commits
<Vizbrix defaultLayout={doc} mode={editing ? 'edit' : 'view'} onLayoutChange={save}>…</Vizbrix>

// controlled: you own the document
<Vizbrix layout={doc} mode="edit" onLayoutChange={(next) => setDoc(next)}>…</Vizbrix>
```

In controlled mode the commit lands in the store **first** and is reported afterwards, so a slow
parent can never stutter a drag. Whatever you pass next is honoured: pass the document you received
(or any transform of it) to accept — undo history survives, and a structural echo does not touch
the store — or pass a copy of the *previous* document to reject and roll the commit back. Adopting
asynchronously (after an , inside a transition) is fine: the store keeps the committed
document until the prop changes.

---

## Where vizbrix fits

| | **vizbrix** | column-grid engines | freeform transform layers |
|---|---|---|---|
| Storage model | affine expressions (`a·W + b`) per axis | integer grid cells (`x,y,w,h`) | none — you own it |
| Free placement | native model | a flag that disables core behaviour | native |
| Snapping | interaction layer: siblings, centres, equal gaps, container edges, optional grid | the grid itself | bring your own |
| Responsive strategy | per-item anchors + container-query cascade + deterministic stack | one authored layout per breakpoint / column count | none |
| SSR / first paint | static CSS, correct with zero JS; RSC entry | needs a measured width before a breakpoint can be chosen | n/a |
| Accessibility | keyboard placement, live regions, WCAG 2.2 SC 2.5.7 tap-to-place, en + ja | typically not part of the API | typically not part of the API |
| Undo / redo | built in, inverse ops, one gesture = one entry | app's job | app's job |
| Persistence versioning | `{version, compat}`, migration chain, `$unknown` parking, `load()` never throws | usually an unversioned array | n/a |

Column grids and transform layers are both good answers to different questions. If you want a
12-column dashboard with compaction, use a column-grid engine. Reach for vizbrix when the grid is
the thing that keeps getting in the way.

## Size

Measured per real entry point — bundled, minified, gzipped, React externalized. Nothing here is a
prop-gated dynamic import: what you import is what you ship. CI reports these numbers on every run.

| Entry | gzip | What it is |
|---|---|---|
| `vizbrix/react/static` | **~4 KB** | RSC-safe renderer; no client JS at all |
| `vizbrix/schema` | **~9 KB** | types + validate/load/migrate/serialize, for servers |
| `vizbrix/react/view` | **~18 KB** | read-only dashboard, no sensors or history |
| `vizbrix/react` | **~33 KB** | the full editor: snapping, undo/redo, a11y, responsive |
| `vizbrix` | **~32 KB** | the whole framework-agnostic core |

The editor entry carries the snap engine, undo/redo, the accessibility layer, the responsive
cascade and versioned persistence. For the case most people actually deploy — a saved dashboard
rendered read-only in a customer-facing app — the cost is the view entry, or the static entry with
no client JavaScript on the page.

## TypeScript

TypeScript source, bundled `.d.ts` for every entry, ESM + CJS, `sideEffects: false`. Widget data
flows from the layout definition through the render callback without an annotation:

```tsx
type Widget = { kind: 'chart' | 'table'; title: string };

const layout = defineLayout<Widget>({
  container: { base: { width: 1200 } },
  items: [{ id: 'a', x: 0, y: 0, w: 400, h: 240, data: { kind: 'chart', title: 'Revenue' } }],
});

<Vizbrix defaultLayout={layout} mode="edit">
  {(item) => <Card title={item.data.title} />}   {/* item.data is Widget, not Widget | undefined */}
</Vizbrix>
```

`data` is required exactly when you supply a `TData` that cannot be `undefined`, and optional when
you don't — so data-less dashboards need no generics and typed ones need no null checks.

## Playground

An interactive playground lives in `examples/playground`:

```sh
cd examples/playground
pnpm install
pnpm dev
```

## Non-goals

Said in writing, so you can plan around them. vizbrix v0.1 does **not** ship:

1. **Charts or data-viz components.** Widget *contents* are yours — bring whatever charting stack
   you already use. Shipping charts would make this a chart kit with a layout feature.
2. **Infinite canvas / zoom + pan camera.** Dashboards live in a bounded container. The coordinate
   space stays camera-ready; no camera is shipped.
3. **Realtime multiplayer or a sync server.** Ops and z-keys are CRDT-shaped; multiplayer will be an
   integration guide for the CRDT library of your choice, not a hosted feature.
4. **Non-React adapters.** The core is framework-agnostic and stays that way, but only the React
   adapter is shipped today.
5. **Docking, tabs, nested split workspaces.** IDE-style tiling is a different product.
6. **Page-builder / component-tree editing.** Also a different product.
7. **A theming or styling system.** Headless plus minimal structural CSS. Style the `data-vzb-item`,
   `data-selected`, `data-dragging`, `data-locked` hooks with your own CSS.
8. **A column-grid drop-in shim.** `importFromGrid` is a one-way converter; a shim would leak
   the cell model back into the core.
9. **A constraint solver, editor chrome/toolbars, widget virtualization, and `push` collision.**
   `push` is compaction under another name — the O(n²) class this library exists to avoid. The
   schema is deliberately a strict subset of a linear-constraint system so a solver can arrive
   later as an additive escape hatch without changing the persisted format.

## Roadmap

- Vue and Svelte adapters over the same core (the core has no React dependency; this is additive).
- A CRDT multiplayer integration guide built on the existing per-actor op log.
- An optional linear-constraint solver behind a `constraints:` escape hatch, at the seam the schema
  already leaves open.
- Browser-driven CSS differential testing in CI (the unit-level differential ships today).

## Stability

Two promises, from v0.1:

- **Semver.** Breaking changes to the public API get a major.
- **A versioned schema.** The persisted document carries `version` and a `compat` reader floor from
  day one, before anyone has saved a layout. `load()` never throws, forward-unknown fields survive a
  round trip, and every schema change ships with a migration step whose dropped fields are reported
  with a path. Your stored dashboards are not hostages to our refactors.

## Documentation

| Guide | |
|---|---|
| [Getting started](./docs/getting-started.md) | install, first dashboard, edit/view, save & load |
| [Responsive layout](./docs/responsive.md) | anchors, the `at` cascade, stacking, scale mode |
| [Persistence](./docs/persistence.md) | `LoadOutcome`, `$unknown`, migrations, serialization |
| [Accessibility](./docs/accessibility.md) | keyboard map, tap-to-place, live regions, i18n |
| [SSR & RSC](./docs/ssr.md) | static rendering, hydration, the `position: fixed` caveat |
| [Importing a column-grid layout](./docs/import-from-grid.md) | `importFromGrid`, anchor inference, what does not carry over |
| [Architecture](./docs/ARCHITECTURE.md) | module map and core contracts |

## License

[MIT](./LICENSE) © MysMon
