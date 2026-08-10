# SSR and React Server Components

"Does it break my Next app" is the question. The answer is no, and the reason is structural rather
than careful: a position in vizbrix is an affine expression in the container extent (`a·W + b`), and
every affine expression is a CSS `calc(P% + Xpx)`. So the whole layout — including responsive
behaviour — compiles to a stylesheet. The server never needs to know how wide the container is.

Grid engines cannot do this: choosing a breakpoint requires a measured width, which does not exist
until the browser has laid the page out. That is why they hydrate first and position second.

## The three surfaces

| Entry | Client JS | Use it for |
|---|---|---|
| `vizbrix/react/static` | **none** | RSC, static export, email/PDF pipelines, marketing pages |
| `vizbrix/react/view` | 13.5 KB | a saved dashboard the user reads but does not edit |
| `vizbrix/react` | 26.8 KB | the editor |

`vizbrix/react` and `vizbrix/react/view` carry a `"use client"` banner: they are client components
that still server-render and hydrate normally. `vizbrix/react/static` carries no banner, no hooks,
no state, no effects and no event handlers — a test greps its own source text to keep it that way.

## Zero-JavaScript rendering

```tsx
// app/dashboard/page.tsx — a React Server Component
import { load, isLoaded } from 'vizbrix/schema';
import { VizbrixStatic } from 'vizbrix/react/static';

export default async function Page() {
  const row = await db.dashboards.findFirst();
  const outcome = load(row.layout);
  if (!isLoaded(outcome)) return <LayoutBroken outcome={outcome} />;

  return (
    <VizbrixStatic layout={outcome.doc} instanceId="overview" className="board">
      {(item) => <Widget id={item.id} rect={item.rect} />}
    </VizbrixStatic>
  );
}
```

That renders positioned markup plus one `<style>` element and ships **no vizbrix JavaScript at
all**. Resizing the window still reflows the dashboard correctly, because the responsive rules are
`@container` blocks the browser already has.

`VizbrixStatic` assumes a valid document — run `load()` at your persistence boundary (it never
throws) and pass `outcome.doc`. The `ui` object handed to your callback is inert by construction:
`moveButtonProps` is `disabled`, and `remove()` / `select()` / `bringToFront()` are no-ops, because
there is no store on the server to mutate.

Set `instanceId` explicitly whenever two dashboards share a page — it scopes every generated
selector, so items with colliding ids in different dashboards never cross-talk. The default is
`'vzb0'`.

## Hydration

`<Vizbrix>` and `<VizbrixView>` server-render and hydrate without a mismatch. The mechanism is
`getServerItemView`: a snapshot frozen at store construction and resolved at `container.base.width`,
used as `useSyncExternalStore`'s server snapshot. The server and the first client render are the
same pure function of the same document, so they cannot disagree.

```tsx
'use client';
import { VizbrixView } from 'vizbrix/react/view';

export function Board({ doc }) {
  return <VizbrixView layout={doc}>{(item) => <Widget id={item.id} />}</VizbrixView>;
}
```

One consequence to design around: **`item.rect` is the base-width rect on the server and during the
first client render.** A `ResizeObserver` measures the container in an effect, and any item whose
resolved rect actually changed re-renders once with the real number. The CSS is already correct
before that happens — the measurement feeds interaction math and the active-size computation, not
the paint. So:

```tsx
// fine — CSS positions the shell; your content just fills it
{(item) => <div className="card">{item.id}</div>}

// think twice — this reads a rect that is base-width until the client measures
{(item) => <Chart width={item.rect.w} height={item.rect.h} />}
```

For the second case, size your content with CSS (`width: 100%`) or accept one re-render.

Do not pass `VizbrixStatic`'s markup to `hydrateRoot` with `<Vizbrix>` or `<VizbrixView>`: the
static surface writes `data-vzb-mode="static"` and omits editing attributes, so the trees differ.
If you want an interactive dashboard, server-render the interactive component itself — both are
SSR-safe.

## StrictMode

The store is created inside a `useState` initializer, every subscription and observer lives in a
symmetric effect, and no store is assigned to a ref during render. React 18/19 StrictMode
double-mounting leaves exactly one live store, one controller and one overlay — tested, including
the render-count claim.

## The `container-type` caveat

The dashboard root sets `container-type: inline-size` so the responsive `@container` rules work.
Per the CSS Containment spec, that makes the element a **containing block for `position: fixed`
descendants**. A dropdown, tooltip or modal rendered inside a widget with `position: fixed` will be
positioned relative to the dashboard rather than the viewport, and will be clipped by it.

The fix is the one you probably already use:

- render overlays in a **portal** to `document.body`, or
- use the native **Popover API** / `<dialog>`, which escape the containing block, or
- keep the popover inside the item and position it absolutely, if clipping is acceptable.

This is not a vizbrix bug and there is no way to avoid it while keeping container queries — every
library that uses container queries inherits it. It is documented here because it surfaces as
"my dropdown moved when I upgraded", which is a bad afternoon.

`responsive: 'scale'` mode does not set `container-type` (it emits no container queries at all), so
the caveat does not apply there.

## Non-React and build-time rendering

`emitStylesheet(doc, instanceId, zRanks)` is exported from the core entry and has no React or DOM
dependency. If you need HTML from a non-React pipeline — a static site generator, a PDF renderer, a
Go service that templates the shell — resolve and emit directly:

```ts
import { emitStylesheet, resolveItem, load, isLoaded } from 'vizbrix';

const outcome = load(json);
if (isLoaded(outcome)) {
  const css = emitStylesheet(outcome.doc, 'board', new Map());
  const rects = outcome.doc.items.map((item) =>
    resolveItem(item, outcome.doc.container, outcome.doc.container.base.width),
  );
}
```

Pass real z-ranks (from `createZRanker`) if you need stacking; an empty map simply omits `z-index`.

## See also

- [Responsive layout](./responsive.md) — what the emitted CSS actually contains
- [Persistence](./persistence.md) — `load()` at the boundary, which is what makes all of this safe
