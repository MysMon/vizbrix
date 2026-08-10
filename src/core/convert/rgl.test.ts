import { describe, expect, it } from 'vitest';
import type { LayoutDoc } from '../schema/types';
import type { RGLLayoutItem } from './rgl';
import { RGL_DEFAULT_BREAKPOINTS, importFromRGL, inferAnchor } from './rgl';
import { isLoaded, load } from '../schema/load';
import { serialize } from '../schema/serialize';

const RGL_DEFAULT_COLS_FIXTURE = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };

function docOf(outcome: ReturnType<typeof importFromRGL>): LayoutDoc<undefined> {
  if (!isLoaded(outcome)) throw new Error(`expected a document, got ${outcome.status}`);
  return outcome.doc;
}

function byId(doc: LayoutDoc<undefined>, id: string) {
  const item = doc.items.find((i) => i.id === id);
  if (!item) throw new Error(`no item "${id}" in [${doc.items.map((i) => i.id).join(', ')}]`);
  return item;
}

const OPTS = { cols: 12, rowHeight: 30, margin: [10, 10] as [number, number], containerWidth: 1200 };

/* ------------------------------------------------------------------ */
/* anchor inference (spec §12)                                         */
/* ------------------------------------------------------------------ */

describe('inferAnchor()', () => {
  const cases: [string, number, number, number, string][] = [
    ['full-bleed row → both', 0, 12, 12, 'both'],
    ['right-docked → end', 6, 6, 12, 'end'],
    ['right-docked narrow → end', 11, 1, 12, 'end'],
    ['half the grid → scale', 0, 6, 12, 'scale'],
    ['more than half → scale', 2, 8, 12, 'scale'],
    ['a third → start', 0, 4, 12, 'start'],
    ['single column → start', 3, 1, 12, 'start'],
    ['single-column grid, full width → both', 0, 1, 1, 'both'],
    ['degenerate grid → start', 0, 1, 0, 'start'],
  ];

  for (const [name, x, w, cols, expected] of cases) {
    it(name, () => {
      expect(inferAnchor(x, w, cols)).toBe(expected);
    });
  }

  it('prefers both over end and end over scale', () => {
    // x=0,w=cols satisfies all three predicates; `both` must win.
    expect(inferAnchor(0, 12, 12)).toBe('both');
    // x+w===cols and w/cols>=0.5 both hold; `end` must win.
    expect(inferAnchor(6, 6, 12)).toBe('end');
  });
});

/* ------------------------------------------------------------------ */
/* single layout                                                       */
/* ------------------------------------------------------------------ */

describe('importFromRGL() — single layout', () => {
  const layout: RGLLayoutItem[] = [
    { i: 'header', x: 0, y: 0, w: 12, h: 2 },
    { i: 'sidebar', x: 9, y: 2, w: 3, h: 6 },
    { i: 'main', x: 0, y: 2, w: 6, h: 6 },
    { i: 'small', x: 6, y: 2, w: 2, h: 3 },
  ];

  it('produces a loadable document at the requested width', () => {
    const outcome = importFromRGL(layout, OPTS);
    expect(outcome.status).toBe('ok');
    const doc = docOf(outcome);
    expect(doc.version).toBe(1);
    expect(doc.container.base.width).toBe(1200);
    expect(doc.container.height).toBe('auto');
    expect(doc.items).toHaveLength(4);
  });

  it('infers the anchor per the spec table', () => {
    const doc = docOf(importFromRGL(layout, OPTS));
    expect(byId(doc, 'header').x.mode).toBe('both');
    expect(byId(doc, 'sidebar').x.mode).toBe('end');
    expect(byId(doc, 'main').x.mode).toBe('scale');
    expect(byId(doc, 'small').x.mode).toBe('start');
  });

  it("reproduces RGL's pixel arithmetic exactly", () => {
    const doc = docOf(importFromRGL(layout, OPTS));
    // colWidth = (1200 − 10·11 − 10·2) / 12 = 89.1666…
    // header: left = 10, width = round(89.1666·12 + 11·10) = 1180
    expect(byId(doc, 'header').x).toEqual({ mode: 'both', start: 10, end: 10 });
    // header: top = 10, height = round(30·2 + 10) = 70
    expect(byId(doc, 'header').y).toEqual({ mode: 'start', offset: 10, size: 70 });
    // main spans 6 of 12 columns → half the container, written as fractions
    expect(byId(doc, 'main').x).toEqual({
      mode: 'scale',
      offset: { pct: 0.8333 },
      size: { pct: 48.75 },
    });
  });

  it('always writes a start-anchored y — a scrolling grid has no definite height', () => {
    const doc = docOf(importFromRGL(layout, OPTS));
    for (const item of doc.items) expect(item.y.mode).toBe('start');
  });

  it('orders items by grid reading order and assigns ascending z keys', () => {
    const doc = docOf(importFromRGL(layout, OPTS));
    expect(doc.items.map((i) => i.id)).toEqual(['header', 'main', 'small', 'sidebar']);
    const keys = doc.items.map((i) => i.z);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(4);
  });

  it('never infers a forbid collision policy', () => {
    const doc = docOf(
      importFromRGL(
        layout.map((c) => ({ ...c, static: true })),
        OPTS,
      ),
    );
    for (const item of doc.items) {
      expect(item.collision).toBeUndefined();
      expect(item.locked).toBe(true);
    }
  });

  it('maps grid-unit min/max bounds into px', () => {
    const doc = docOf(
      importFromRGL([{ i: 'a', x: 0, y: 0, w: 4, h: 2, minW: 2, maxW: 8, minH: 1, maxH: 4 }], OPTS),
    );
    const item = byId(doc, 'a');
    // minW = round(89.1666·2 + 10) = 188 ; maxW = round(89.1666·8 + 70) = 783
    expect(item.minW).toBe(188);
    expect(item.maxW).toBe(783);
    // minH = round(30·1) = 30 ; maxH = round(30·4 + 30) = 150
    expect(item.minH).toBe(30);
    expect(item.maxH).toBe(150);
  });

  it('ignores non-finite RGL bounds (RGL defaults maxW/maxH to Infinity)', () => {
    const doc = docOf(
      importFromRGL(
        [{ i: 'a', x: 0, y: 0, w: 4, h: 2, maxW: Infinity, maxH: Infinity, minW: 0 }],
        OPTS,
      ),
    );
    expect(byId(doc, 'a').maxW).toBeUndefined();
    expect(byId(doc, 'a').maxH).toBeUndefined();
    expect(byId(doc, 'a').minW).toBeUndefined();
  });

  it('generates a key for a cell that has none, and reports it', () => {
    const outcome = importFromRGL([{ x: 0, y: 0, w: 2, h: 2 } as RGLLayoutItem], OPTS);
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(docOf(outcome).items[0]!.id).toBe('rgl-0');
    expect(outcome.issues.some((i) => i.path === 'layouts[0].i')).toBe(true);
  });

  it('accepts `id` as an alias for RGL’s `i`', () => {
    const doc = docOf(importFromRGL([{ id: 'aliased', x: 0, y: 0, w: 2, h: 2 }], OPTS));
    expect(doc.items[0]!.id).toBe('aliased');
  });

  it('defaults the container width to RGL’s lg breakpoint', () => {
    const doc = docOf(importFromRGL([{ i: 'a', x: 0, y: 0, w: 2, h: 2 }], { cols: 12, rowHeight: 30 }));
    expect(doc.container.base.width).toBe(RGL_DEFAULT_BREAKPOINTS.lg);
  });

  it('round-trips through serialize/load like any other document', () => {
    const doc = docOf(importFromRGL(layout, OPTS));
    const text = serialize(doc);
    const back = load(text);
    expect(back.status).toBe('ok');
    if (back.status !== 'ok') return;
    expect(back.doc).toEqual(doc);
  });
});

/* ------------------------------------------------------------------ */
/* responsive layouts                                                  */
/* ------------------------------------------------------------------ */

describe('importFromRGL() — responsive layouts', () => {
  const layouts = {
    lg: [
      { i: 'a', x: 0, y: 0, w: 6, h: 2 },
      { i: 'b', x: 6, y: 0, w: 6, h: 2 },
    ],
    md: [
      { i: 'a', x: 0, y: 0, w: 10, h: 2 },
      { i: 'b', x: 0, y: 2, w: 10, h: 2 },
    ],
    sm: [
      { i: 'a', x: 0, y: 0, w: 6, h: 3 },
      { i: 'b', x: 0, y: 3, w: 6, h: 3 },
    ],
  };

  it('maps RGL min-width breakpoints onto vizbrix max-width sizes', () => {
    const doc = docOf(importFromRGL(layouts, { cols: RGL_DEFAULT_COLS_FIXTURE, rowHeight: 30 }));
    // lg is the base; md is active up to lg's threshold, sm up to md's.
    expect(doc.container.sizes).toEqual({ md: { maxWidth: 1200 }, sm: { maxWidth: 996 } });
    expect(doc.container.base.width).toBe(1200);
  });

  it('writes smaller breakpoints as `at` overrides on the base items', () => {
    const doc = docOf(importFromRGL(layouts, { cols: RGL_DEFAULT_COLS_FIXTURE, rowHeight: 30 }));
    const a = byId(doc, 'a');
    expect(Object.keys(a.at ?? {}).sort()).toEqual(['md', 'sm']);
    expect(a.at!.md!.x).toBeDefined();
    expect(a.at!.md!.y).toBeDefined();
    // Overrides never carry z (spec §1.23).
    expect((a.at!.md as unknown as Record<string, unknown>).z).toBeUndefined();
  });

  it('omits an override that is identical to the base placement', () => {
    const identical = {
      lg: [{ i: 'a', x: 0, y: 0, w: 12, h: 2 }],
      md: [{ i: 'a', x: 0, y: 0, w: 10, h: 2 }],
    };
    // Both are full-bleed rows resolved at 1200 → identical `both` placements.
    const doc = docOf(importFromRGL(identical, { cols: { lg: 12, md: 10 }, rowHeight: 30 }));
    expect(byId(doc, 'a').at).toBeUndefined();
  });

  it('promotes an item that exists only at a smaller breakpoint', () => {
    const outcome = importFromRGL(
      {
        lg: [{ i: 'a', x: 0, y: 0, w: 6, h: 2 }],
        sm: [
          { i: 'a', x: 0, y: 0, w: 6, h: 2 },
          { i: 'phone-only', x: 0, y: 2, w: 6, h: 2 },
        ],
      },
      { cols: { lg: 12, sm: 6 }, rowHeight: 30 },
    );
    const doc = docOf(outcome);
    expect(doc.items.map((i) => i.id).sort()).toEqual(['a', 'phone-only']);
    if (outcome.status !== 'ok') return;
    expect(outcome.issues.some((i) => i.message.includes('promoted'))).toBe(true);
  });

  it('uses RGL’s default column counts when a breakpoint has none', () => {
    const outcome = importFromRGL(layouts, { cols: {}, rowHeight: 30 });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.issues.some((i) => i.message.includes("RGL's default"))).toBe(true);
  });

  it('applies a scalar cols to every breakpoint', () => {
    const doc = docOf(importFromRGL(layouts, { cols: 12, rowHeight: 30 }));
    expect(doc.container.sizes).toEqual({ md: { maxWidth: 1200 }, sm: { maxWidth: 996 } });
  });

  it('honors custom breakpoints', () => {
    const doc = docOf(
      importFromRGL(layouts, {
        cols: 12,
        rowHeight: 30,
        breakpoints: { lg: 1400, md: 1000, sm: 600 },
      }),
    );
    expect(doc.container.sizes).toEqual({ md: { maxWidth: 1400 }, sm: { maxWidth: 1000 } });
    expect(doc.container.base.width).toBe(1400);
  });

  it('agrees with RGL’s breakpoint selection at every width', () => {
    const breakpoints = RGL_DEFAULT_BREAKPOINTS;
    const doc = docOf(importFromRGL(layouts, { cols: RGL_DEFAULT_COLS_FIXTURE, rowHeight: 30 }));
    const sizes = doc.container.sizes!;

    for (const width of [2000, 1201, 1200, 1100, 997, 996, 800, 769, 768, 400, 1]) {
      // RGL: largest breakpoint whose min-width is below the measured width.
      const rglPick =
        Object.keys(breakpoints)
          .filter((name) => name in layouts && width > breakpoints[name]!)
          .sort((a, b) => breakpoints[b]! - breakpoints[a]!)[0] ?? 'sm';
      // vizbrix: innermost active size (descending maxWidth), else the base.
      const vizPick =
        Object.keys(sizes)
          .filter((name) => width <= sizes[name]!.maxWidth)
          .sort((a, b) => sizes[b]!.maxWidth - sizes[a]!.maxWidth)
          .pop() ?? 'lg';
      expect(vizPick, `width ${width}`).toBe(rglPick);
    }
  });
});

/* ------------------------------------------------------------------ */
/* hostile input                                                       */
/* ------------------------------------------------------------------ */

describe('importFromRGL() — hostile input', () => {
  it('never throws', () => {
    const hostile: unknown[] = [null, undefined, 0, 'x', {}, { lg: 'nope' }, [null, 1, 'x'], [{}]];
    for (const input of hostile) {
      const outcome = importFromRGL(
        input as RGLLayoutItem[],
        { cols: 12, rowHeight: 30 },
      );
      expect(typeof outcome.status).toBe('string');
    }
  });

  it('reports an object with no layout arrays as invalid', () => {
    const outcome = importFromRGL({ lg: 'nope' } as unknown as Record<string, RGLLayoutItem[]>, {
      cols: 12,
      rowHeight: 30,
    });
    expect(outcome.status).toBe('invalid');
  });

  it('skips malformed cells but keeps the rest', () => {
    const outcome = importFromRGL(
      [null, { i: 'ok', x: 0, y: 0, w: 2, h: 2 }, 'junk'] as unknown as RGLLayoutItem[],
      OPTS,
    );
    expect(outcome.status).toBe('ok');
    expect(docOf(outcome).items.map((i) => i.id)).toEqual(['ok']);
  });

  it('skips a duplicate grid key rather than producing a renamed twin', () => {
    const outcome = importFromRGL(
      [
        { i: 'a', x: 0, y: 0, w: 2, h: 2 },
        { i: 'a', x: 4, y: 0, w: 2, h: 2 },
      ],
      OPTS,
    );
    expect(docOf(outcome).items).toHaveLength(1);
    if (outcome.status !== 'ok') return;
    expect(outcome.issues.some((i) => i.message.includes('duplicate'))).toBe(true);
  });

  it('repairs non-finite or missing cell coordinates', () => {
    const outcome = importFromRGL(
      [{ i: 'a', x: NaN, y: undefined, w: 0, h: -3 } as unknown as RGLLayoutItem],
      OPTS,
    );
    expect(outcome.status).toBe('ok');
    const item = docOf(outcome).items[0]!;
    expect(item.x.mode).toBe('start');
    expect(Number.isFinite((item.y as { offset: number }).offset)).toBe(true);
  });

  it('defaults an unusable rowHeight and says so', () => {
    const outcome = importFromRGL([{ i: 'a', x: 0, y: 0, w: 2, h: 2 }], {
      cols: 12,
      rowHeight: 0,
    });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.issues.some((i) => i.message.includes('rowHeight'))).toBe(true);
  });

  it('falls back to RGL’s default margin', () => {
    const withMargin = docOf(importFromRGL([{ i: 'a', x: 1, y: 1, w: 2, h: 2 }], OPTS));
    const withoutMargin = docOf(
      importFromRGL([{ i: 'a', x: 1, y: 1, w: 2, h: 2 }], {
        cols: 12,
        rowHeight: 30,
        containerWidth: 1200,
      }),
    );
    expect(withoutMargin.items[0]!.x).toEqual(withMargin.items[0]!.x);
  });
});
