# Persistence

A layout you can put in a database and still open in three years. The persisted document carries a
`version` and a `compat` reader floor from v0.1 — before anyone has saved anything — and `load()`
never throws for any input at all.

```jsonc
{
  "version": 1,
  "container": { "base": { "width": 1200 }, "sizes": { "md": { "maxWidth": 900 } } },
  "items": [
    { "id": "revenue", "z": "a1",
      "x": { "mode": "start", "offset": 0, "size": 580 },
      "y": { "mode": "start", "offset": 0, "size": 260 } }
  ]
}
```

## The server-side entry

```ts
import { load, serialize, validate, normalize, isLoaded, SCHEMA_VERSION } from 'vizbrix/schema';
```

`vizbrix/schema` is **~9 KB gzip** with no React, no DOM and no store — it is what a route handler,
a migration script or a database trigger imports. The same functions are re-exported from the
`vizbrix` core entry if you already depend on that.

## `load()` never throws

Every failure mode is an arm of `LoadOutcome`, so you write a `switch`, not a `try`. It accepts a
JSON string or an already-parsed value, and survives `null`, arrays, numbers, cyclic structures and
documents written by a future version.

```ts
type LoadOutcome<TData> =
  | { status: 'ok';               doc: LayoutDoc<TData>; issues: Issue[] }
  | { status: 'migrated';         doc: LayoutDoc<TData>; from: number; issues: Issue[] }
  | { status: 'forward-degraded'; doc: LayoutDoc<TData>; ignored: string[]; issues: Issue[] }
  | { status: 'incompatible';     reason: string; compat: number }
  | { status: 'invalid';          errors: Issue[] };
```

| arm | meaning | what to do |
|---|---|---|
| `ok` | current version, structurally sound | render it. `issues` may still list repairs — log them |
| `migrated` | upgraded from `from` to the current version | render it, and **write it back once** |
| `forward-degraded` | written by a newer version whose `compat` floor this reader satisfies | render it read-only-ish; `ignored` lists the paths this build did not understand |
| `incompatible` | the writer declared `compat` above this reader's version | show an upgrade prompt; do not render |
| `invalid` | not a layout document, or structurally broken | show a fallback; `errors` says where |

```ts
const outcome = load(row.layout);

switch (outcome.status) {
  case 'migrated':
    await db.update(id, { layout: serialize(outcome.doc) });
    return render(outcome.doc);
  case 'ok':
  case 'forward-degraded':
    return render(outcome.doc);
  case 'incompatible':
    return upgradePrompt(outcome.reason);
  case 'invalid':
    return brokenLayout(outcome.errors);
}
```

`isLoaded(outcome)` narrows to the three document-carrying arms when you don't need the detail:

```ts
if (isLoaded(outcome)) render(outcome.doc);
```

An `Issue` is `{ severity: 'warn' | 'error', path: string, message: string }`, with `path` in the
`items[3].x.offset` form. Warnings are repairs that already happened; errors only appear on the
`invalid` arm.

## Forward compatibility: `$unknown` parking

A v0.1 reader opening a document written by a later version must not silently delete the parts it
doesn't understand. Unknown keys — at the document level and per item — are parked in `$unknown`
and written back **verbatim** by `serialize()`.

```jsonc
{ "id": "revenue", "x": …, "y": …, "z": "a1",
  "$unknown": { "rotation": 12, "filters": ["region"] } }
```

Unknown keys injected by a newer writer survive a `load → serialize` round trip
byte-identically — that is law L2 of the round-trip guarantees below. A forward-degraded document also keeps its original
`version` and `compat`, so this reader writes the future document back rather than downgrading it.
One exception: `ContainerConfig` has no `$unknown` slot in the frozen schema, so unrecognized
*container* keys are reported and dropped rather than parked.

## `compat` — the reader floor

`version` says who wrote the document. `compat` (default `1`) says the lowest reader version that
can render it faithfully.

- Adding an optional field older readers can ignore → bump `version`, leave `compat`. They get
  `forward-degraded` and still show something correct.
- Changing what an existing field *means* → bump both. They get `incompatible` and show an upgrade
  prompt instead of a wrong dashboard.

## Migrations

The migration registry is a list of contiguous single-step upgrades. It ships **empty**, because v1
is current — the machinery exists from day one so that adding v2 is a data change rather than a
redesign.

```ts
import type { Migration } from 'vizbrix/schema';

const v1ToV2: Migration = {
  from: 1,
  to: 2,
  describe: 'fold legacy `pinned` into a real end anchor',
  up(doc, ctx) {
    const items = (doc.items as Array<Record<string, unknown>>).map((item) => {
      if (item.pinned !== true) return item;
      ctx.report({ severity: 'warn', path: `items.${item.id}.pinned`, message: 'became x.mode = "end"' });
      const { pinned, ...rest } = item;
      return { ...rest, x: { mode: 'end', offset: 0, size: 200 } };
    });
    return { ...doc, items };
  },
};

const outcome = load(raw, [v1ToV2]);   // migrate(raw, [v1ToV2]) does the same, standalone
```

Two properties are enforced by the runner rather than by each migration's diligence:

- **Contiguity.** Steps must advance exactly one version and form an unbroken chain up to the
  current schema version. A gap is rejected up front, before any document is touched.
- **Drop reporting (law L5).** After each step the runner diffs the key sets and reports every field
  that disappeared without the migration reporting it itself, with a path. You cannot lose a field
  silently.

Documents older than the lowest available step load as `invalid` with an explicit "no migration path
from version N" error — never as a half-converted layout.

## `serialize()` — stable bytes

```ts
serialize(doc);              // 2-space indent
serialize(doc, { indent: 0 });  // one compact line
```

Known schema keys are written in a fixed semantic order (`version, compat, container, items,
$unknown`; items lead with `id, x, y, z`); everything else — including `$unknown` payloads and your
opaque `data` — is written with keys sorted alphabetically. **Two deeply equal documents serialize
to identical bytes** regardless of how the objects were built, which is what makes a layout change
reviewable in a pull request.

It honours `toJSON()` the way `JSON.stringify` does, and throws `TypeError` in exactly two cases
your own payload can cause: a cyclic `data`/`$unknown` value, or a `BigInt`. Everything the schema
itself owns is always serializable.

## `validate()` and `normalize()`

Two lower-level tools for when `load()` is the wrong granularity:

- `validate(input): Issue[]` — structural check, no repair, no throw. Errors mean the document is
  not renderable; warnings mean it will be repaired.
- `normalize(docLike, issues?): LayoutDoc` — total repair. Accepts *anything* and returns a document
  the engine can consume without defensive checks: base width filled, duplicate ids renamed, missing
  or non-canonical `z` keys regenerated order-preservingly, invalid fields dropped, lengths
  canonicalized, items sorted by `z`. A damaged placement inside an `at.<size>` override is
  dropped (the base placement cascades through) rather than repaired to a zero-size rect. It is
  idempotent (law L3) and appends every repair to the optional `issues` sink.

`defineLayout()` is the only function in the schema module that throws, and only on duplicate ids —
at authoring time a duplicate id is a typo you want to see immediately, whereas at load time it is
damaged data you want repaired.

## The round-trip laws

These hold for every document, however it was built:

| law | statement |
|---|---|
| L1 | `load(serialize(doc)).doc` deep-equals `doc` |
| L2 | unknown keys injected by a "newer writer" survive byte-identically |
| L3 | `normalize` is idempotent |
| L5 | every field a migration drops is reported with a path |

Resolution carries the same kind of guarantee: resolving a re-encoded placement lands within
0.5 px of the original for widths from 1 to 10000, in every mode — which is what makes a saved
layout mean the same thing after an edit as before it.

## Storing widget data

`data` is opaque to vizbrix: passed by reference, never inspected, replaced wholesale by `setData`,
and serialized with sorted keys. Keep it small and JSON-shaped — the layout document is a layout
document, and a 40 KB blob of chart config per item will make your diffs unreadable long before it
makes anything slow. Prefer storing an id here and joining the payload from your own table.

## See also

[Getting started](./getting-started.md) — the save/load flow in an app ·
[Importing a column-grid layout](./import-from-grid.md) — `importFromGrid` returns a
`LoadOutcome` like everything else.
