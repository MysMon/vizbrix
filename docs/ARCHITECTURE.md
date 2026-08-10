# vizbrix v0.1 — Final Architecture Specification (BINDING)

Synthesized from 3 design proposals + 2 judge reports. Where this spec conflicts with a
proposal, THIS SPEC WINS. Proposals live at `proposal-dx-first.md`, `proposal-engine-first.md`,
`proposal-product-first.md` in this directory — consult them for algorithm rationale, but the
contracts below are the source of truth.

## 0. Product identity

**vizbrix — the free-placement layout engine for React dashboards. Pixel-precise placement
that actually reflows.**

- Free placement is the storage primitive; snapping is an interaction layer.
- Positions are *expressions* (affine `a·W + b`), not numbers. Resolution is pure, total,
  measurement-free — every placement maps to static CSS, so SSR first paint is correct with zero JS.
- Dragging one item never re-renders another (0 sibling renders; 1 imperative overlay write/frame).
- Versioned persistence contract from day one; load never throws.
- WCAG 2.2 SC 2.5.7 (single-pointer non-drag alternative = tap-to-place) + SC 2.1.1 (keyboard).
- Zero runtime dependencies. MIT.

Package: single npm package `vizbrix` with subpath entry points (deviation from the brief's
two-package shape — argued in README; enforced by a `no-react-in-core` check so the
framework-agnostic claim stays true).

```
vizbrix                → core: schema, load/migrate/serialize, resolve, css, store, ops,
                         history, snap, fractional index, importFromRGL. NO react imports. NO DOM
                         globals at module scope.
vizbrix/react          → full editor adapter ("use client" banner)
vizbrix/react/view     → read-only adapter, no sensors, no ResizeObserver ("use client" banner)
vizbrix/react/static   → RSC-safe static renderer, NO "use client", no hooks
vizbrix/schema         → types + validate + load + migrate + serialize only (server-side use)
vizbrix/locales/ja     → Japanese strings (en is built into core defaults)
```

## 1. Decisions record (judge rulings — all BINDING)

1. Coordinate encoding: per-axis discriminated union over affine `Len`. Bare `number` = px.
   Object form `{ pct?, px? }` (self-describing JSON; NOT tuple).
2. User data: namespaced `data` field (NOT flat intersection). Conditional requiredness (§2).
3. ALL placement CSS goes in the generated stylesheet — NEVER inline `style=` attributes
   (inline would beat `@container` overrides; this was a hard bug in 2 of 3 proposals).
4. `center` CSS: fold the half-size into the affine constant — `left: calc(P% + Xpx)` with
   `P = 50 + d.pct − s.pct/2`, `X = d.px − s.px/2`. Same algebra on y. NEVER `translate(-50%)`
   (transform belongs to the drag fast path), NEVER negative % margins (`margin-top:%` resolves
   against WIDTH — broken on y).
5. Responsive size keys: `maxWidth`, desktop-first, sorted descending; JS resolver and emitted
   `@container (max-width:)` MUST agree (engine-first had a minWidth/maxWidth contradiction — do
   not reproduce it).
6. Vertical anchors under `height:'auto'` are UNRESOLVABLE (scrolling container has no definite
   height): y modes `end|both|center|scale` are honored only under `container.height:'fill'`.
   Otherwise they are FROZEN at `base.height ?? 0` — y resolves against the base height for
   every mode and CSS emits the resulting fixed `top/height` px (never `bottom:` or `%` against
   auto height), so JS and CSS cannot drift. `validate()` raises the warning; `reencodeRect`
   writes plain-px `start` for a degraded y; `setAnchor(id,'y',<non-start>)` refuses with an
   `empty` result + dev-mode warning rather than silently rewriting the anchor.
7. z-order: persisted fractional key (base-62, ASCII-ordinal, C-collation-compatible); CSS
   z-index derived as SPARSE integer ranks (gap 1024, midpoint split on insert, windowed
   rebalance) so insert-between re-renders exactly 1 item. Dense ranks are forbidden.
8. Fractional key generator: generated key must sort strictly between bounds AFTER jitter;
   guard against prefix-of-upper-bound; property-test 1e5 interleaved inserts.
9. Snap: two-phase providers — `collect(snapshot)` once at gesture start (sorted line arrays,
   gap bands, dragged ids excluded), `query()` per frame (binary search, caller-owned
   accumulator, zero allocation). Re-collect if moving bounds exit the collected region.
10. Snap defaults: ON (sibling edges/centers, equal-gap, container edges). GRID OFF by default
    (`snap={{ grid: 8 }}` opt-in). Bypass modifier: **Cmd/Ctrl held** (configurable
    `bypassKey`); Alt is reserved (resize-from-center now, duplicate-drag later).
    `contextmenu` is prevented during an active gesture.
11. Threshold: 8 screen px ÷ canvas scale. Pointer deltas ÷ scale in `responsive:'scale'` mode;
    reencode in scale mode re-encodes against the design extent, not the scaled extent.
12. Collision policies: `allow | guide | forbid` per item + optional `with` tags. NO `push`
    (push = compaction = the O(n²) class we advertise not having). `forbid`: ghost tracks the
    pointer 1:1 all gesture; engine tracks `lastValidRect`; landing outline emitted as a guide;
    drop resolves to lastValidRect; if never valid → transaction discarded (no empty undo entry).
    Enforced for EVERY commit path (pointer, keyboard nudge, keyboard-grab drop, tap-to-place)
    at the single `commitRects` chokepoint, which may return `{status:'blocked'}`: a nudge into
    a collision is a no-op with a polite announcement; a grab drop into one keeps the item
    grabbed with an assertive announcement; a place onto one is rejected with placing still
    armed. `resolve()` itself stays collision-free.
13. Load: `load()` returns `LoadOutcome`, NEVER throws. Arms: `ok | migrated |
    forward-degraded | incompatible | invalid`. `compat` reader floor; `$unknown` parking at doc
    + item level, re-emitted verbatim on serialize.
14. Undo/redo: inverse-op transactions, one gesture = one entry, labels
    (`undoLabel`/`redoLabel`), rebase-before-invert with `onConflict:'skip'` default reporting
    `skipped`, view-mode undo blocked, canceled/no-op drags record nothing. `placeAt` with
    `before: undefined` DELETES the override (never writes null).
15. Controlled mode: commit internally first (parent lag cannot stutter the drag); rejection
    detection = "prop did not change at all after commit", NOT "prop ≠ my ops" (parent may
    legitimately transform). An incoming doc that is STRUCTURALLY equal to current state
    (`rebaseOk` on a replaceDoc op) is treated as an echo — no replaceDoc, history retained —
    so a parent that maps/normalizes the document does not wipe undo/redo. Transaction is the
    2nd arg of `onLayoutChange`; NEVER stamp metadata (`__txId` etc.) onto the doc.
16. `mode` default: `'view'`. View mode = no listeners attached at all (not no-op guards), no
    editing ARIA, history frozen, byte-identical geometry vs edit mode.
17. Bundle claims via real entry points only (`size-limit` gates). No prop-gated dynamic import
    of the interaction layer.
18. Touch: long-press activation default 450 ms (+8px slop cancel); `touch-action: pan-y` at
    rest; on activation, document-level `touchmove` listener `{passive:false}` +
    `preventDefault()` (setPointerCapture alone cannot stop an in-flight scroll; mutating
    touch-action mid-gesture is a no-op). `longPress:'off'` → 3px activation for
    toolbar-gated-edit apps.
19. Responsive commit target: when a size override is active (container within a declared size),
    drags/resizes commit into `at[activeSize]`, Webflow-style; announced in the undo label.
20. Tier-3 stack: ON by default below `stackBelow: 480`. Deterministic order:
    `item.order ??` stable sort by (resolved y at base.width, x, then id).
21. Server snapshot: frozen at store construction, resolved against `base.width`. `rect` in
    render context is the base-width rect until the client measures — documented.
22. StrictMode: store created via `useState(() => createStore(doc))`; symmetric
    subscribe/unsubscribe in effects; never assign stores to refs during render; no
    double-registered observers.
23. Per-size `z` override: FORBIDDEN. Overrides carry position/size/hidden/order only.
24. i18n: strings as context FUNCTIONS (translators reorder clauses); en built-in; `ja` shipped;
    `fromMessages(record)` adapter for TMS JSON pipelines.
25. Guides overlay: ONE `<svg>` mounted once; per-frame updates are imperative DOM writes via
    a ref'd handle — never React renders per frame. Claim precisely: "0 item renders during
    drag; 1 imperative overlay write per frame; 1 item render at commit."
26. RTL: `container.direction?: 'ltr' | 'rtl'` in the schema now (default 'ltr'); v0.1 emits
    physical left/right from logical start/end per direction. No auto-mirroring of content.
    Compass handle ids are PHYSICAL on the wire (adapter insets and cursors); the core mirrors
    them to logical x edges internally under rtl (`logicalHandle`). Third-party adapters keep
    rendering physical ids.
27. Docs must warn: `container-type: inline-size` makes the container a containing block for
    `position: fixed` descendants → portal your dropdowns/modals (or Popover API).
28. `data-*` hooks: root `data-vzb` (instance), items `data-vzb-item="<id>"`,
    state attrs `data-selected`, `data-dragging`, `data-resizing`, `data-locked` for consumer
    styling; `data-vzb-keys` on a subtree opts an editable-looking element back INTO the layout
    keyboard shortcuts (form controls/contenteditable/links/buttons are otherwise exempt —
    §10). Item ids are CSS-escaped in generated selectors (own tiny escape; CSS.escape is
    DOM-only), and the escaper additionally hex-escapes `<`, `>`, `&` in every position because
    the stylesheet's sink is HTML `<style>` text.

## 2. Schema (exact — this becomes `src/core/schema/types.ts`)

```ts
/** Affine length: bare number = px. {pct,px} = pct% of container extent + px. */
export type Len = number | { pct?: number; px?: number };

export type AxisMode = 'start' | 'end' | 'both' | 'center' | 'scale';

export type AxisPlacement =
  | { mode: 'start';  offset: Len; size: Len }   // offset from start edge
  | { mode: 'end';    offset: Len; size: Len }   // offset from END edge
  | { mode: 'both';   start: Len; end: Len }     // pinned both edges; size derived
  | { mode: 'center'; offset: Len; size: Len }   // offset of item CENTER from container center
  | { mode: 'scale';  offset: Len; size: Len };  // resolves like 'start'; reencode writes fractions

export type CollisionPolicy = 'allow' | 'guide' | 'forbid';

export interface ItemOverride {
  x?: AxisPlacement;          // placements replace WHOLESALE (modes have disjoint fields;
  y?: AxisPlacement;          //  partial placement merge is unsound)
  hidden?: boolean;
  order?: number;             // tier-3 stacking override
}

export interface LayoutItemBase {
  id: string;                  // unique within doc
  x: AxisPlacement;
  y: AxisPlacement;
  z: string;                   // fractional index key (base-62, ASCII-ordinal)
  minW?: number; minH?: number; maxW?: number; maxH?: number;   // px, in base space
  collision?: CollisionPolicy;         // default 'allow'
  collisionWith?: string[];            // tag scoping; absent = all items
  tags?: string[];
  locked?: boolean;            // not movable/resizable in edit mode
  hidden?: boolean;
  order?: number;              // tier-3 reading-order override
  at?: Record<string, ItemOverride>;   // key = declared size name; cascading desktop-first
  $unknown?: Record<string, unknown>;  // forward-compat parking (round-trips verbatim)
}

export type LayoutItem<TData = undefined> = LayoutItemBase &
  (undefined extends TData ? { data?: TData } : { data: TData });

export interface SizeDef { maxWidth: number }   // container width ≤ maxWidth activates it

export interface ContainerConfig {
  base: { width: number; height?: number };  // width REQUIRED (fixes px meaning, tier-3 order,
                                             // server rects). Changing it is a migration-class edit.
  height?: 'auto' | 'fill';                  // default 'auto'; y end/both/center/scale need 'fill'
  sizes?: Record<string, SizeDef>;           // named sizes for `at` cascade, e.g. {md:{maxWidth:900}}
  stackBelow?: number;                       // default 480; 0 disables tier-3
  responsive?: 'reflow' | 'scale';           // default 'reflow'
  direction?: 'ltr' | 'rtl';                 // default 'ltr'
}

export interface LayoutDoc<TData = undefined> {
  version: number;             // current writer version: 1
  compat?: number;             // reader floor, default 1
  container: ContainerConfig;
  items: LayoutItem<TData>[];
  $unknown?: Record<string, unknown>;
}

/** Authoring input: relaxed — z optional, flat sugar accepted via defineLayout(). */
export interface FlatItemInput<TData> {
  id: string;
  x: number; y: number; w: number; h: number;   // px in base space
  anchor?: AnchorSpec;      // sugar → AxisPlacement pair (see §3 reencode table)
  z?: string;
  // ...all other LayoutItemBase fields optional; data per conditional rule
}
export type AnchorSpec =
  | 'scale'                                       // both axes scale
  | { x?: AxisMode; y?: AxisMode };               // default x:'start', y:'start'
```

`defineLayout(input): LayoutDoc` normalizes: fills missing `z` (spread evenly), converts flat
sugar via reencode-at-base, canonicalizes `Len` (strip zero terms; collapse `{px:n}`→`n`),
sorts items by z, rejects duplicate ids (throws — authoring-time only; `load()` never throws).

Resolved output:

```ts
export interface Rect { x: number; y: number; w: number; h: number }
```

## 3. Geometry (`src/core/geometry/`)

`lenAt(len, extent): number` = `pct/100 * extent + px`.

`resolveAxis(p: AxisPlacement, extent: number): { pos: number; size: number }`:

| mode | pos | size |
|---|---|---|
| start / scale | `lenAt(offset, W)` | `lenAt(size, W)` |
| end | `W − lenAt(offset, W) − size` | `lenAt(size, W)` |
| both | `lenAt(start, W)` | `W − lenAt(start,W) − lenAt(end,W)` |
| center | `W/2 + lenAt(offset, W) − size/2` | `lenAt(size, W)` |

Clamping (applied in `resolveItem`, after both axes): size clamped to [minW/H, maxW/H] then to
≥ 0; for `both`, min-clamp grows toward the END edge (matches CSS over-constrained abspos).
`resolveItem(item, container: {width, height?}, activeSizes: string[]): Rect` applies the `at`
cascade first (§7), then resolves. Pure, total, no DOM.

`reencodeAxis(pos, size, extent, mode): AxisPlacement` — inverse of resolve at a given extent:

| mode | writes |
|---|---|
| start | `{offset: round(pos), size: round(size)}` (px) |
| end | `{offset: round(extent − pos − size), size: round(size)}` |
| both | `{start: round(pos), end: round(extent − pos − size)}` |
| center | `{offset: round(pos + size/2 − extent/2), size: round(size)}` |
| scale | `{offset: {pct: r4(pos/extent*100)}, size: {pct: r4(size/extent*100)}}` |

Rounding: px terms → 2 decimals (`round`), pct → 4 decimals (`r4`). Property law:
`resolveAxis(reencodeAxis(pos, size, W, m), W)` ≈ `(pos, size)` within 0.5 px for W ∈ [1, 10000].
`setAnchor` = resolve at current extent → reencode with new mode → item does not move.

## 4. CSS emission (`src/core/geometry/css.ts`)

`emitStylesheet(doc, instanceId, opts): string` — the WHOLE truth for static layout. Rules:

- Container rule: `[data-vzb="IID"] { position:relative; container-type:inline-size;
  container-name:vzb-IID; }` + `height:100%` under `'fill'`, else `min-height:<max resolved
  bottom at base>px`.
- Item rules keyed `[data-vzb="IID"] [data-vzb-item="ESCAPED_ID"]` — instance-scoped so two
  dashboards with colliding item ids never cross-talk. `position:absolute;` + placement + derived
  `z-index` (sparse rank).
- Per-axis emission (x shown; y symmetric with top/bottom/height, honoring rule §1.6):

| mode | x-axis CSS |
|---|---|
| start | `left: calc(P% + Xpx); width: calc(P'% + X'px)` |
| end | `right: …; width: …` |
| both | `left: …; right: …` (no width) |
| center | `left: calc((50+d.pct−s.pct/2)% + (d.px−s.px/2)px); width: …` |
| scale | same as start (pct-bearing Len emits naturally) |

  Emit `calc()` only when needed: pure px → `left: Xpx`; pure pct → `left: P%`.
- EVERY `at` override block re-emits the COMPLETE property set for both axes (left/right/width
  with explicit `auto`/`right:auto` resets as needed) — switching modes must reset what the
  previous mode set. Golden-file tested.
- Size overrides: `@container vzb-IID (max-width: <maxWidth>px) { … }` emitted in DESCENDING
  maxWidth order (later = smaller = wins; matches JS cascade §7).
- Tier-3 stack block: `@container vzb-IID (width < <stackBelow>px) { … }` (range syntax — the
  strict inequality matches the JS `width < stackBelow` exactly, unlike a `max-width: n−1`
  approximation) — container becomes flex column (gap 8px), items `position:static; width:auto;
  height:<resolved base h>px; order:<stack order>`. Size-override bounds are emitted at EXACT
  declared precision (no 2dp rounding on comparison bounds). Container `min-height` is the max
  resolved bottom edge over EVERY cascade level (base + each declared size), re-emitted per
  `@container` block where it differs; scale mode uses the base level only.
- `responsive:'scale'`: no @container blocks; consumer wraps a fixed base-size canvas that the
  adapter scales via `transform: scale()` on a wrapper (NOT on items).
- RTL: `direction:'rtl'` swaps left/right in emission.
- Escape item ids with an own `cssEscape` (no DOM dependency).
- `transform` is NEVER written by static CSS — reserved for the drag fast path.

## 5. Ordering (`src/core/order/`)

`fractional.ts`: `keyBetween(a: string | null, b: string | null): string` over base-62 alphabet
`0-9A-Za-z` (ASCII order). Invariants: result strictly between bounds; never a prefix
of `b`; jitter (2 random tail digits) applied INSIDE the safety bound (i.e. jitter first, then
verify `a < k < b`, retry deterministic fallback without jitter on failure). Also
`keysBetween(a, b, n)` for bulk normalize. Property test: 1e5 interleaved inserts, strict order
after jitter, key length growth bounded (< 40 chars over 1e4 sequential front-inserts →
`onKeyGrowth` signal at 40).

`zrank.ts`: derived map fractional key → sparse integer (start gaps 1024; insert = midpoint of
neighbors; on gap exhaustion rebalance only the local window). Persisted state never touched by
rebalance. `bringToFront`/`sendToBack`/`moveAbove(id)` produce ONE item's key change.

## 6. Store (`src/core/store/`)

```ts
createStore<TData>(doc: LayoutDoc<TData>, opts?): VizbrixStore<TData>
```

- Canonical state: normalized `LayoutDoc` + derived indexes (id→item, z-sorted list, zRank map).
- Channels (each independently subscribable,版数付き):
  - per-item: `subscribeItem(id, cb)` — fires ONLY on that item's committed change. Container
    resize bumps an item only if its resolved rect actually changed.
  - `subscribeSelection`, `subscribeOrder` (z/add/remove), `subscribeDoc` (any commit),
    `subscribeContainer` (measured size), `subscribeInteraction` (transient gesture state — the
    overlay + a11y announcer listen here; item components DO NOT).
- Snapshots memoized per version counter (fresh-object-per-get melts `useSyncExternalStore`).
- `getServerItemView(id)`: frozen at construction, resolved at `base.width` (+ base.height/
  degradation rules) — hydration-safe.
- Transient layer: during a gesture, per-item `transform: translate(dx,dy)` / width/height for
  resize written imperatively by the interaction layer to registered DOM nodes; store holds the
  transient rects for snap/collision math only. Commit = reencode → ops → notify.
- Container measurement: editor/view adapters attach one ResizeObserver; measured width feeds
  interaction math + active-size computation ONLY (never rewrites static CSS at rest).
- `applyOps(ops, opts): TxResult` — validates, rebases, mutates, notifies, pushes history entry.
- Framework-agnostic: no `react`, no DOM globals at module scope (`typeof window` guards where
  unavoidable). CI check greps `from 'react'` in `src/core` → fail.

## 7. Responsive cascade + tiers (`src/core/geometry/cascade.ts`)

- Active sizes at width W: all declared sizes with `W ≤ maxWidth`, ordered descending maxWidth;
  overrides fold field-level in that order (smaller sizes win). Placements replace wholesale.
- `resolveItem` takes the folded item. JS fold MUST equal CSS cascade (differential-tested).
- Tier-3 active when `W < stackBelow`: resolve → stack order (§1.20); adapter renders same DOM,
  CSS does the stacking.
- Commit targeting: when any size is active, interaction commits write `placeAt(id, size,
  override)` into the INNERMOST active size; base fields untouched. Undo label carries the size.

## 8. Ops + history (`src/core/ops/`)

Op set (each with a pure `invert(opBefore)` and `apply`):
`add(item)`, `remove(id)`, `move(id, x: AxisPlacement, y: AxisPlacement)` (whole placements —
carries before/after), `resize(id, x, y)` (same shape as move; semantic label differs),
`setZ(id, z)`, `setAnchor(id, axis, mode)` (stored as move with before/after), `placeAt(id,
size, override | undefined)` (undefined = delete override; before captured; `before: undefined`
on invert DELETES), `setHidden(id, bool)`, `setLocked(id, bool)`, `setOrder(id, n)`,
`setData(id, data)` (opaque; replace-wholesale), `replaceDoc(doc)` (import/load boundary — clears
history).

History: transaction = `{ label, ops, actor? }`. One gesture/keyboard-grab-session/multi-drag =
ONE transaction. Multi-select drag = one transaction with n move ops. Rebase-before-invert:
current value must equal op's `after`, else per `onConflict` ('skip' default → `TxResult.skipped`
list). Undo restores selection to affected ids. View mode: undo/redo return
`{ status:'blocked' }`. No-op transactions (drop at origin, canceled) are never pushed. Depth
default 100. Labels: `strings.undoLabel(tx)` — e.g. "move Revenue chart", "move Revenue chart
(md)".

## 9. Snap engine (`src/core/snap/`)

```ts
interface SnapProvider {
  collect(snap: GestureSnapshot): ProviderState;         // once per gesture (+re-collect §1.9)
  query(state, rect: Rect, kind: 'move' | 'resize', handle: HandleId | null,
        acc: SnapAccumulator): void;                     // per frame, zero-alloc
}
```

- `GestureSnapshot` frozen at pointerdown: container rect + scale, all item rects (resolved,
  current), union bounds, selection ids, sorted candidate arrays per axis with dragged ids
  excluded. ZERO getBoundingClientRect during a gesture.
- Providers (default order): containerEdge (edges + center), siblingEdge, siblingCenter,
  equalGap (≥50% perpendicular-overlap band heuristic), grid (opt-in), sizeMatch (resize only —
  match sibling w/h).
- Query: binary search into sorted arrays within `[v − t, v + t]`, `t = 8 / scale` (px). Best
  candidate per axis wins (priority then distance). Accumulator caller-owned; guides written into
  a reusable buffer: `{ axis, at, from, to, kind: 'edge'|'center'|'gap'|'grid'|'forbid' }` with
  collinear merging.
- Cap: 512 candidates per axis per collect, collected over the FULL doc (no viewport cull);
  re-collect if moving bounds exit collected coverage.
- Modifier: `bypassKey` (default Cmd/Ctrl) checked live per frame. Alt+resize = from center.
  Shift+resize = preserve aspect. Shift+drag = axis lock (larger delta axis).

## 10. Interaction layer (`src/core/interact/`)

FSM: `idle → pressed(px,py,item,handle?) → { dragging | resizing | marquee } → idle` with
cancel (Escape / pointercancel / doc detach). Activation: mouse/pen 3 px; touch long-press
450 ms + 8 px slop (§1.18 mechanism), `longPress:'off'` → 3 px. `setPointerCapture` always.
`composedPath()` for target resolution (shadow DOM); hit-testing via store rects, never
`elementFromPoint`.

- Drag: multi-select aware (union rect snaps as one); per-frame: transform writes + snap query +
  transient store update + imperative guide write. rAF-throttled.
- Resize: 8 handles; anchor-edge math; min/max clamp live; sizeMatch snapping; center/aspect
  modifiers.
- Marquee: from container background in edit mode; intersect = select; Shift additive. The
  marquee (alone among gestures — it converts an absolute client point) re-measures the
  container on scroll; drag/resize stay one-measurement-per-gesture.
- Click selection: click = select (Shift toggles); click background = clear.
- Keyboard sensor (edit mode, item focused): Arrow 1 px; Shift+Arrow 10 px; Cmd/Ctrl+Arrow =
  jump to next snap candidate in that direction; Enter/Space = grab ↔ drop (grab session = one
  transaction); Escape = cancel-revert; Delete/Backspace = remove; `[`/`]` +Cmd/Ctrl = z-order.
  Tab order follows z-sorted DOM order. Keystrokes originating in form controls,
  contenteditable, links, or buttons inside an item are NOT layout commands (the browser keeps
  them) unless the element carries `data-vzb-keys`; a live grab is the one exception and owns
  the keyboard until it ends. Arming a keyboard grab cancels tap-to-place and vice versa —
  the two can never be live together.
- Tap-to-place (SC 2.5.7): `beginPlace(id) → completePlace(pointOrCell) | cancelPlace()`.
  Adapter exposes a focusable per-item move affordance (`ui.moveButtonProps`) + container click
  target while placing; placing state announced assertively.

## 11. React adapter (`src/react/`)

```tsx
// vizbrix/react
export function Vizbrix<TData>(props: VizbrixProps<TData>): JSX.Element;
interface VizbrixProps<TData> {
  layout?: LayoutDoc<TData>;              // controlled
  defaultLayout?: LayoutDoc<TData>;       // uncontrolled
  onLayoutChange?: (doc: LayoutDoc<NoInfer<TData>>, tx: Transaction) => void;
  mode?: 'view' | 'edit';                 // default 'view'
  snap?: SnapConfig | false;
  strings?: VizbrixStrings;               // default en
  size?: string;                          // force a named size (tests/storybook)
  instanceId?: string;                    // else useId()
  className?: string; style?: CSSProperties;   // root passthrough (never positional styles)
  children: (item: ItemView<TData>, ui: ItemUI) => ReactNode;
  renderIncompatible?: (outcome: LoadOutcome) => ReactNode;
}
interface ItemView<TData> { id: string; data: TData /* conditional */; rect: Rect;
  hidden: boolean; locked: boolean }
interface ItemUI {
  isSelected: boolean; isDragging: boolean; isResizing: boolean;
  handleProps: HTMLAttributes<HTMLElement>;   // spread to make a sub-element the drag handle;
                                              // if never spread, whole item is the handle
  moveButtonProps: ButtonHTMLAttributes<HTMLButtonElement>;  // tap-to-place affordance
  attributes: HTMLAttributes<HTMLElement>;    // role, aria, data-* (spread on item root by lib)
  remove(): void; bringToFront(): void; select(): void;
}
export function useVizbrix<TData>(): VizbrixApi<TData>;   // context; throws outside provider
export function useHistory(): { canUndo; canRedo; undo(); redo(); undoLabel?; redoLabel? };
export function useSelection(): { ids: string[]; set(ids): void; clear(): void };
```

- Item component: memoized; subscribes via `useSyncExternalStore(subscribeItem(id), getSnap,
  getServerItemView)`. Render callback stored in ref-backed context and updated SILENTLY on
  identity change (a new inline arrow per parent render must NOT re-render N items — that was
  the original `renderVersion` design's own failure mode). Widgets that close over parent state
  re-render via their item channel on commits; a `renderKey?: unknown` prop on
  Vizbrix/VizbrixView forces all items to re-render when it changes (the documented escape
  hatch for parent-state-dependent widget content). Container measurement uses the fractional
  content box (ResizeObserver `contentRect`), matching `container-type: inline-size`.
- Structural + positional CSS in a `<style>` element rendered in-tree (dedupe by instanceId),
  content via `dangerouslySetInnerHTML` (child-combinator `>` must not be escaped).
- Overlay: single `<svg>` (guides) + selection outlines + marquee rect; subscribed to the
  interaction channel; per-frame writes imperative through a handle ref.
- A11y: items get `role="button"`, `tabIndex=0` (edit mode only), `aria-roledescription:
  strings.itemRole()`, `aria-describedby` off-screen instructions; two live regions (assertive:
  gesture transitions; polite: position status); announcements via strings functions with
  position phrasing ("Revenue chart, moved to 240, 300").
- `vizbrix/react/view`: same render contract, no sensors/observer/history; `<VizbrixView>`.
- `vizbrix/react/static`: `<VizbrixStatic layout instanceId? children>` — pure function of doc:
  emits stylesheet + item shells; NO hooks, NO "use client", RSC-safe.
- Keyboard shortcuts scoped to focus-within; Cmd/Ctrl+Z/Shift+Z on the container in edit mode.

## 12. Persistence (`src/core/schema/`)

```ts
load(input: unknown): LoadOutcome<TData>
type LoadOutcome<TData> =
  | { status: 'ok';               doc: LayoutDoc<TData>; issues: Issue[] }
  | { status: 'migrated';         doc: LayoutDoc<TData>; from: number; issues: Issue[] }
  | { status: 'forward-degraded'; doc: LayoutDoc<TData>; ignored: string[]; issues: Issue[] }
  | { status: 'incompatible';     reason: string; compat: number }
  | { status: 'invalid';          errors: Issue[] };
interface Issue { severity: 'warn' | 'error'; path: string; message: string }
serialize(doc): string          // stable key order → clean diffs
validate(input): Issue[]
migrate(input): LoadOutcome     // standalone, React-free (vizbrix/schema entry)
normalize(docLike): LayoutDoc   // fill z, sort, canonicalize Len, dedupe ids (suffix + warn)
importFromRGL(layouts, opts: { cols: number; rowHeight: number; margin?: [number, number];
  containerWidth?: number }): LoadOutcome
```

- Migration registry: contiguous chain 1→2→… asserted in CI; law L5: every dropped field
  appears in `issues` with a path (key-set-diff test helper).
- Round-trip laws (property tests): L1 `load(serialize(doc))` deep-equals; L2 injected unknown
  keys survive byte-identical; L3 normalize idempotent; L4 resolve total on any valid doc;
  L5 migration drop-reporting.
- RGL import anchors: `x===0 && x+w===cols → both`; `x+w===cols → end`; `w/cols ≥ 0.5 → scale`;
  else start px. Never infer `forbid` from RGL static/compaction.

## 13. Repo layout + file ownership

```
package.json tsconfig.json tsup.config.ts vitest.config.ts eslint.config.js
src/core/schema/types.ts            [FABLE — written first, frozen contract]
src/core/schema/{normalize,validate,load,migrate,serialize}.ts   [agent: schema]
src/core/convert/rgl.ts             [agent: schema]
src/core/geometry/{len,resolve,reencode,cascade,css}.ts          [agent: geometry]
src/core/order/{fractional,zrank}.ts                             [agent: order]
src/core/store/{store,transients,server-view}.ts                 [agent: store]
src/core/ops/{ops,history}.ts                                    [agent: ops]
src/core/snap/{engine,types,providers/*}.ts                      [agent: snap]
src/core/interact/{machine,pointer,keyboard,place,hit}.ts        [agent: interact]
src/core/a11y/announce.ts  src/core/locales/{en,ja}.ts           [agent: a11y]
src/core/index.ts                   [FABLE integration]
src/react/{Vizbrix,View,Static,Overlay,Item,context,hooks,style}.tsx  [agent: react]
src/react/{index,view,static}.ts    [agent: react]
src/schema.ts (entry re-export)     [FABLE]
tests colocated: <module>.test.ts owned by the module's agent
examples/playground/                [agent: playground — vite app]
README.md docs/*.md                 [agent: docs]
```

Every agent owns EXACTLY its listed files. Shared imports allowed from `schema/types.ts`,
`geometry` public fns, and other modules' PUBLIC exports as declared in this spec — if a needed
export is missing, define the import per this spec and note it in the final report; Fable wires
integration.

## 14. Toolchain

- `tsup`: entries `src/core/index.ts` (→ `vizbrix`), `src/schema.ts`, `src/react/index.ts`,
  `src/react/view.ts`, `src/react/static.ts`, `src/core/locales/ja.ts`; ESM + CJS + dts;
  banner `"use client"` ONLY on react/index and react/view outputs.
- exports map with `types` conditions per entry; `sideEffects: false`.
- vitest + jsdom for adapter tests; node env for core; @testing-library/react.
- eslint flat config; rule: no `react` import under `src/core` (custom no-restricted-imports).
- Size budgets (CI reports; measured 2026-08 at v0.1, bundled+minified+gzip): core 28.9 KB,
  react 26.8 KB, react/view 13.5 KB, react/static 4.2 KB, schema 8.5 KB. Budget = measured
  +10%; any increase beyond that must be argued in the PR, never silent. (Original pre-
  implementation targets were core ≤12/react ≤20/view ≤8 — superseded by measurement per
  this section's own rule; the delta bought snapping, undo/redo, migrations, and a11y.)
- peerDeps: react ^18 || ^19 (optional peers — core usable without).

## 15. Marketing-asset tests (must exist, cited in README)

1. `render-count.test.tsx` — 200 items, drag one 500 frames: sibling renders === 0, dragged
   ≤ 1, commit renders === 1. Header cites RGL #2228.
2. `css-differential.test.ts` — seeded random docs × widths: `resolveItem()` vs CSS-emitted
   values recomputed symbolically (unit-level), + a Playwright-driven browser differential
   script (`scripts/css-differential-browser.mjs`, best-effort in CI) asserting
   getBoundingClientRect within 0.5 px.
3. `fractional.property.test.ts` — 1e5 interleaved inserts strict ordering after jitter.
4. `roundtrip.property.test.ts` — laws L1–L5.
5. `undo-matrix.test.ts` — table-driven from §8 semantics.
6. `reencode.property.test.ts` — resolve∘reencode identity ≤ 0.5 px.

## 16. Out of scope for v0.1 (README non-goals)

Charts; infinite canvas/zoom camera; multiplayer server (CRDT-*ready* state only); non-React
adapters (core is agnostic; adapters later); docking/tabs; page-builder trees; theming systems;
`push` collision; Cassowary solver (schema is a strict subset of `a·W+b` linear constraints —
solver seam documented, not built).
