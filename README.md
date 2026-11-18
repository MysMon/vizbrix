# vizbrix

**Dashboard bricks for React. A free-placement layout that actually reflows, the charts and figures to fill it, and an editor to arrange them.**

[![CI](https://github.com/MysMon/vizbrix/actions/workflows/ci.yml/badge.svg)](https://github.com/MysMon/vizbrix/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

*[日本語の README →](./README.ja.md)*

```tsx
import { createDashboard } from 'vizbrix';
import { Dashboard } from 'vizbrix/react';
import { builtinBricks } from 'vizbrix/bricks';
import 'vizbrix/styles.css';

const layout = createDashboard({
  items: [
    { id: 'mrr', type: 'stat', title: 'MRR', x: 0, y: 0, w: 300, h: 148,
      props: { data: 'mrr', format: 'currency:USD', deltaLabel: 'vs last month' } },
    { id: 'sales', type: 'line', title: 'Revenue', x: 300, y: 0, w: 900, h: 320,
      props: { data: 'sales', x: 'month', series: ['actual', 'plan'] } },
  ],
});

export function Page() {
  const [doc, setDoc] = useState(layout);
  return (
    <Dashboard
      value={doc}
      onChange={setDoc}          // once per finished drag, once per undo
      bricks={builtinBricks}
      data={{ mrr: { value: 62_380, delta: 0.057 }, sales: rows }}
      editable                   // adds Edit, Add and undo/redo
    />
  );
}
```

That is a dashboard with a KPI tile and a line chart that users can drag and resize, and that
rearranges itself into two columns on a tablet and one on a phone. It has no runtime dependencies.

---

## The idea

**A dashboard is a set of bricks.** A brick is JSON — a `type`, a position, and `props`. How a type
renders comes from a registry (`bricks`); what it shows comes from `data`. The layout can go straight
into a database, and the data can change underneath it.

**Free placement is the storage format.** A position is a rectangle `x, y, w, h` against a design width
(1200 by default), not a column index. The grid is not the model; it is one of the things a drag can
snap to.

**And it still reflows.** Free placement usually means "it just shrinks". Here:

- Rectangles are stored as **tiles**: neighbours share an edge, and the gutter (`gap`) is subtracted
  when rendering. Gutters therefore stay the same pixel size at every width.
- Each brick chooses how it follows the width (`pin`): `scale` (default, keeps its share), `left` /
  `right` (fixed width, pinned to an edge), `stretch` (pinned both sides), or `center`.
- Below a breakpoint the layout is **derived automatically** by flowing bricks, in reading order,
  into N columns. Move something at that width and the arrangement is saved for that width.
- Breakpoints respond to **the dashboard's own width** (container queries), not the viewport, so
  they behave inside sidebars and split panes.

**The layout is static CSS.** Every variant compiles to rules like `left: calc(25% + 4px)`. A server
can render a correct first paint without knowing the screen size, and no JavaScript runs to lay
anything out.

---

## Install

```sh
npm install vizbrix
```

Works with React 18 and 19. Load the theme with `import 'vizbrix/styles.css'`.

| Entry | Contents | gzip |
|---|---|---|
| `vizbrix` | Document model, load/save, geometry, store — framework-free | ~12 KB |
| `vizbrix/react` | `<Dashboard>` — viewer and editor | ~18 KB |
| `vizbrix/react/static` | `<DashboardStatic>` — a hook-free Server Component | ~3 KB |
| `vizbrix/charts` | Charts and figures; usable on their own | ~16 KB |
| `vizbrix/bricks` | The built-in brick registry | ~3 KB |
| `vizbrix/locales/ja` | Japanese strings and brick names | ~2 KB |
| `vizbrix/styles.css` | Theme, light and dark | ~7 KB |

---

## Built-in bricks

| type | For | Main props |
|---|---|---|
| `stat` | A headline number, its change, a sparkline | `value` `format` `delta` `deltaLabel` `upIsGood` `trend` |
| `line` / `area` | Change over time; multi-series, stacked, smoothed | `data` `x` `series` `stacked` `curve` `xType` `yFormat` |
| `bar` | Comparing categories; grouped/stacked, vertical/horizontal, line overlays (`lines`) | `data` `x` `series` `lines` `stacked` `horizontal` `labels` |
| `scatter` | How two measures relate; groups, bubbles | `data` `x` `y` `group` `label` `size` |
| `heatmap` | Magnitude across two categories (weekday × hour) | `data` `x` `y` `value` `labels` |
| `funnel` | Stages and the conversion between them | `data` `label` `value` |
| `donut` / `segmented` | Share of a whole | `data` `label` `value` `format` `centerLabel` |
| `barlist` | Rankings | `data` `label` `value` `limit` |
| `meter` | Progress toward a target | `value` `max` `status` `statusLabel` |
| `table` | Sortable, searchable, resizable; virtualized rows | `data` `columns` `searchable` |
| `text` | Headings and notes (no card) | `text` `variant` |

`data` is either inline rows or the **name** of a dataset passed to `<Dashboard data={…}>`. `stat` and
`meter` read `value`, `delta` and friends from the named object.

`format` is a storable value: `'auto'` (switches to compact notation from 10,000), `'number'`,
`'integer'`, `'compact'`, `'percent'`, `'currency:USD'`, or `Intl.NumberFormatOptions`.

Line and bar charts take `references: [{ value: 2300, label: 'Monthly target' }]` for threshold
lines; line charts take `zoom: true` for drag-to-zoom. Table columns choose a presentation with `kind`:

```ts
columns: [
  { key: 'name', kind: 'link', href: '/deals/{id}' },                      // {field} comes from the row
  { key: 'stage', kind: 'badge', tones: { Won: 'good', Quote: 'warning' } },
  { key: 'probability', kind: 'progress' },
]
```

### Your own bricks

```tsx
import { defineBrick, resolveData } from 'vizbrix/react';

const map = defineBrick<{ data?: string; zoom?: number }>({
  label: 'Map',                        // name in the Add menu
  defaults: { w: 600, h: 400, title: 'Stores', props: { zoom: 5 } },
  flush: true,                         // no body padding
  settings: [                          // fields for the settings panel (optional)
    { key: 'data', type: 'dataset' },
    { key: 'zoom', type: 'number', label: 'Zoom' },
  ],
  render: ({ props, data }) => <StoreMap points={resolveData(props.data, data)} zoom={props.zoom} />,
});

<Dashboard bricks={{ ...builtinBricks, map }} … />
```

Types missing from the registry go to `renderItem`; failing that, a placeholder. A brick that throws
while rendering shows an error in its own card and leaves the rest of the dashboard alone.

---

## Charts on their own

`vizbrix/charts` does not need a dashboard. Charts draw to the size of their parent, so place them in
an element with a height or pass `height`.

```tsx
import { LineChart, BarChart, StatTile, DataTable } from 'vizbrix/charts';

<LineChart data={rows} x="date" series={[{ key: 'pv', label: 'Page views' }, 'users']} height={280} />
<BarChart data={rows} x="region" series={['sales']} horizontal labels height={240} />
<StatTile label="Customers" value={1284} delta={0.042} deltaLabel="vs last month" />
<DataTable data={deals} columns={[{ key: 'name' }, { key: 'amount', format: 'currency:USD' }]} height={360} />
```

- One y-axis — bar charts with line overlays (`lines`) share it too. A series' colour follows its declared position, so hiding one never repaints the rest.
- Lines get a crosshair that snaps to the nearest x and a tooltip listing every series; on bars the
  whole category band is the hover target. Arrow keys read the same values.
- Line and bar charts switch to a table view; part-to-whole charts print every amount in the legend.
  Nothing is identified by colour alone.
- Points are downsampled to the pixels available (LTTB), so a 100k-point series costs about what a
  1k-point one does. `DataTable` mounts only the rows in view.
- The default palette's order is validated so adjacent series stay distinguishable under colour
  vision deficiency, in both light and dark.

---

## Editing

With `editable`, the toolbar gains an Edit button. In edit mode:

| Action | How |
|---|---|
| Move | Drag, or arrow keys (Alt for single units) |
| Resize | Eight handles, or Shift + arrow keys |
| Multi-select | Shift (or Ctrl/⌘) + click; the selection moves together |
| Snap | Sibling edges and centres, canvas edges, an 8px grid. Hold Ctrl/⌘ to bypass |
| Add, duplicate, remove | The Add menu, Ctrl+D, Delete |
| Stacking | `]` to front, `[` to back |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z (a run of key presses is one step) |
| Marquee select | Drag from empty canvas. Ctrl+A selects all |
| Align / distribute | Appears in the toolbar with two or more bricks selected |
| Copy / paste | Ctrl+C / Ctrl+V (also across dashboards on the same page) |
| Cancel | Esc while dragging |

Each brick's "⋯" menu offers renaming, **numeric position and size** (a way to place bricks without
dragging), the width behaviour, locking and removal.

**Settings panel.** "Edit…" in the menu (or a double-click on the brick) opens a panel for choosing
the dataset, axes, series, format and so on; changes apply to the brick as you make them. The panel
is generated from the brick definition's `settings`, so your own bricks get it too. To use your own
settings UI instead, pass `onEditItem`.

**Overlap.** Allowed by default. With `overlap="avoid"` a dropped brick lands in the nearest free
spot and a resize that would cover a neighbour is refused.

While dragging, styles are written straight to the dragged elements and React does not re-render.
The change commits once, on release, and only the bricks that changed render again. A dashboard
without `editable` registers no event listeners at all.

### Main props

| Prop | |
|---|---|
| `value` / `defaultValue` / `onChange(doc, meta)` | Controlled or uncontrolled; `meta.reason` is `move`, `resize`, `add`, `undo`, … |
| `bricks` / `data` / `renderItem` | Registry, datasets, fallback renderer |
| `editable` / `editing` / `defaultEditing` / `onEditingChange` | Whether editing is allowed, and edit mode |
| `toolbar` / `header` | Show the toolbar; content for its left side (title, filters) |
| `snap` | `{ grid, items, threshold }` or `false` |
| `locale` / `theme` | Strings (English by default); `'light' \| 'dark' \| 'auto'` |
| `status` / `onRetry` | Loading state per dataset (below) |
| `onSelect` | A point, bar, cell or row inside a brick was clicked |
| `exportable` | Offer CSV / image download in view mode |
| `overlap` | `'allow'` (default) or `'avoid'` |
| `onEditItem` | Called instead of the built-in settings panel |
| `ref` | `add` `remove` `update` `undo` `redo` `getValue` `reveal` `inspect` `toCsv` `exportCsv` `exportPng` `store` |

---

## Data states, clicks and export

```tsx
<Dashboard
  data={{ sales: salesQuery.data }}
  status={{ sales: salesQuery.isFetching ? 'loading' : salesQuery.isError ? 'error' : undefined }}
  onRetry={(dataset) => refetch(dataset)}
  onSelect={({ item, datum, index }) => router.push(`/deals?month=${datum.month}`)}
  exportable
/>
```

- **Loading**: a placeholder while there is no data yet; once there is, the previous render stays,
  dimmed (no layout jump, no skeleton flash). **Error**: a message and a retry button.
- **Clicks**: chart points, bars and cells, parts of a whole, and table rows report the source row
  (`datum`) and its position (`index`). Enter does the same from the keyboard. Nothing fires while editing.
- **Export**: `exportable` adds a hover menu to each brick for CSV (UTF-8 with a BOM, so spreadsheets
  open it correctly) and PNG. Both are on `ref` too. Editing chrome is hidden when printing.
  Image export draws through an SVG `foreignObject`, which Safari may refuse; CSV works everywhere.

## Saving and loading

```ts
import { parseDashboard, serializeDashboard } from 'vizbrix';

await save(serializeDashboard(doc));        // stable key order: same content, same bytes

const { doc, ok, issues } = parseDashboard(await load());
if (!ok) report(issues);                     // e.g. [{ path: 'items[3].w', message: '…', severity: 'error' }]
```

`parseDashboard` **never throws**. Even for corrupt JSON it returns a renderable document and the list
of what it repaired. Documents carry a `version`, and unknown keys survive a round trip, so data
written by a newer release is not damaged by an older one.

Cell-based grid layouts (`{ i, x, y, w, h }`) convert with `importFromGrid(cells, { cols, rowHeight })`.

## Server rendering

```tsx
import { DashboardStatic } from 'vizbrix/react/static';   // no "use client"
import { builtinBricks } from 'vizbrix/bricks';

export default async function Page() {
  return <DashboardStatic id="sales" value={await loadLayout()} bricks={builtinBricks} data={await loadData()} />;
}
```

`<DashboardStatic>` is a Server Component with no hooks or handlers, and emits the same markup as
`<Dashboard>`. Because the layout is CSS, the only code that runs on the client is the charts' own.

## Theming

Every colour, radius and font is a CSS custom property.

```css
:root {
  --vbx-accent: #0f766e;
  --vbx-radius: 8px;
  --vbx-series-1: #0f766e;   /* replace the series colours as an ordered set */
}
```

`theme="dark"` (or `data-vbx-theme="dark"` on an ancestor) selects dark; `"auto"` follows the OS.

## Accessibility

- Editing works from the keyboard alone; moves, resizes, additions and removals are announced.
- Everything that needs a drag has a single-pointer, non-drag alternative: the numeric fields in the
  brick menu (WCAG 2.2 SC 2.5.7).
- Line and bar charts are readable with arrow keys and have a table view. Status colours always come
  with a label.
- `prefers-reduced-motion` is respected.

## Non-goals

- **Compaction or pushing.** Bricks stay where they are put; moving one never moves another.
- **Data fetching.** Getting data into `data` is the app's job.
- **Dual-axis charts, an infinite canvas, real-time collaboration.**

## Development

```sh
pnpm install
pnpm check          # typecheck + lint + tests
pnpm build && pnpm size && pnpm smoke
pnpm e2e --project=chromium   # real-browser tests (CI also runs Firefox, WebKit and touch)

cd examples/playground && pnpm install && pnpm dev
```

Design notes live in [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## License

[MIT](./LICENSE) © MysMon
