import { describe, expect, it } from 'vitest';
import type { Issue, LayoutInput } from './types';
import { DEFAULT_BASE_WIDTH, defineLayout, normalize } from './normalize';

const start = (offset: number, size: number) => ({ mode: 'start' as const, offset, size });

/* ------------------------------------------------------------------ */
/* normalize                                                           */
/* ------------------------------------------------------------------ */

describe('normalize()', () => {
  it('turns junk into an empty, usable document', () => {
    for (const junk of [undefined, null, 42, 'x', [], true, Symbol('s')]) {
      const doc = normalize(junk);
      expect(doc.version).toBe(1);
      expect(doc.container.base.width).toBe(DEFAULT_BASE_WIDTH);
      expect(doc.items).toEqual([]);
    }
  });

  it('reports every repair through the issue sink', () => {
    const issues: Issue[] = [];
    normalize({ version: 1, container: {}, items: [{ id: 'a' }] }, issues);
    expect(issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(['container.base.width', 'items[0].x', 'items[0].y']),
    );
    expect(issues.every((i) => i.severity === 'warn')).toBe(true);
  });

  it('canonicalizes Len values', () => {
    const doc = normalize({
      version: 1,
      container: { base: { width: 1000 } },
      items: [
        {
          id: 'a',
          z: 'a0',
          x: { mode: 'start', offset: { px: 12, pct: 0 }, size: { pct: 25, px: 0 } },
          y: { mode: 'start', offset: {}, size: { pct: 10, px: 4 } },
        },
      ],
    });
    expect(doc.items[0]!.x).toEqual({ mode: 'start', offset: 12, size: { pct: 25 } });
    expect(doc.items[0]!.y).toEqual({ mode: 'start', offset: 0, size: { pct: 10, px: 4 } });
  });

  it('strips fields the placement mode does not use', () => {
    const doc = normalize({
      version: 1,
      container: { base: { width: 100 } },
      items: [
        {
          id: 'a',
          z: 'a0',
          x: { mode: 'both', start: 1, end: 2, offset: 9, size: 9 },
          y: start(0, 1),
        },
      ],
    });
    expect(doc.items[0]!.x).toEqual({ mode: 'both', start: 1, end: 2 });
  });

  it('fills missing z keys and sorts items by z', () => {
    const doc = normalize({
      version: 1,
      container: { base: { width: 100 } },
      items: [
        { id: 'later', z: 'z9', x: start(0, 1), y: start(0, 1) },
        { id: 'gap1', x: start(0, 1), y: start(0, 1) },
        { id: 'gap2', x: start(0, 1), y: start(0, 1) },
        { id: 'earlier', z: 'a0', x: start(0, 1), y: start(0, 1) },
      ],
    });
    const keys = doc.items.map((i) => i.z);
    expect(keys.every((k) => typeof k === 'string' && k.length > 0)).toBe(true);
    expect([...keys].sort()).toEqual(keys);
    expect(doc.items.map((i) => i.id)).toContain('gap1');
    expect(doc.items).toHaveLength(4);
  });

  it('spreads keys across an entirely key-less document in array order', () => {
    const doc = normalize({
      version: 1,
      container: { base: { width: 100 } },
      items: ['a', 'b', 'c', 'd'].map((id) => ({ id, x: start(0, 1), y: start(0, 1) })),
    });
    expect(doc.items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
    const keys = doc.items.map((i) => i.z);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(4);
  });

  it('breaks duplicate-z ties by id so the order is total', () => {
    const doc = normalize({
      version: 1,
      container: { base: { width: 100 } },
      items: [
        { id: 'b', z: 'same', x: start(0, 1), y: start(0, 1) },
        { id: 'a', z: 'same', x: start(0, 1), y: start(0, 1) },
      ],
    });
    expect(doc.items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('de-duplicates ids with a suffix, never dropping an item', () => {
    const doc = normalize({
      version: 1,
      container: { base: { width: 100 } },
      items: [
        { id: 'x', z: 'a0', x: start(0, 1), y: start(0, 1) },
        { id: 'x', z: 'a1', x: start(0, 2), y: start(0, 1) },
        { id: 'x-2', z: 'a2', x: start(0, 3), y: start(0, 1) },
        { id: 'x', z: 'a3', x: start(0, 4), y: start(0, 1) },
      ],
    });
    expect(doc.items.map((i) => i.id)).toEqual(['x', 'x-2', 'x-2-2', 'x-3']);
    expect(new Set(doc.items.map((i) => i.id)).size).toBe(4);
  });

  it('keeps opaque data by reference', () => {
    const data = { chart: {} };
    const doc = normalize<{ chart: object }>({
      version: 1,
      container: { base: { width: 100 } },
      items: [{ id: 'a', z: 'a0', x: start(0, 1), y: start(0, 1), data }],
    });
    expect(doc.items[0]!.data).toBe(data);
  });

  it('drops container defaults it was not given and keeps the ones it was', () => {
    const doc = normalize({
      version: 1,
      container: { base: { width: 800, height: 600 }, height: 'fill', direction: 'rtl', stackBelow: 0, bogus: 1 },
      items: [],
    });
    expect(doc.container).toEqual({
      base: { width: 800, height: 600 },
      height: 'fill',
      direction: 'rtl',
      stackBelow: 0,
    });
  });

  it('drops compat when it equals the default floor of 1', () => {
    expect(normalize({ version: 1, compat: 1, container: { base: { width: 1 } }, items: [] }).compat).toBeUndefined();
    expect(normalize({ version: 4, compat: 3, container: { base: { width: 1 } }, items: [] }).compat).toBe(3);
  });

  it('is idempotent (law L3) even for damaged input', () => {
    const damaged = {
      version: 'one',
      compat: null,
      container: { base: { width: -5 }, sizes: { md: { maxWidth: 0 }, sm: { maxWidth: 400 } }, ghost: 1 },
      items: [
        null,
        { id: 'dup', x: { mode: 'nope' }, y: 7, minW: 'big', at: { sm: { z: 'x', hidden: 1 } } },
        { id: 'dup', x: start(0, 1), y: start(0, 1), tags: [1, 'ok'] },
        { x: start(0, 1), y: start(0, 1), stray: true },
      ],
    };
    const once = normalize(damaged);
    const twice = normalize(once as unknown);
    expect(twice).toEqual(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

/* ------------------------------------------------------------------ */
/* defineLayout                                                        */
/* ------------------------------------------------------------------ */

describe('defineLayout()', () => {
  const base = { base: { width: 1000 } };

  it('converts flat px sugar at the base extent', () => {
    const doc = defineLayout({
      container: base,
      items: [{ id: 'a', x: 10, y: 20, w: 100, h: 50 }],
    });
    expect(doc.items[0]!.x).toEqual({ mode: 'start', offset: 10, size: 100 });
    expect(doc.items[0]!.y).toEqual({ mode: 'start', offset: 20, size: 50 });
    expect(doc.items[0]!.z).toBeTypeOf('string');
  });

  it("maps anchor: 'scale' onto both axes when the height allows it", () => {
    const doc = defineLayout({
      container: { base: { width: 1000, height: 500 }, height: 'fill' },
      items: [{ id: 'a', x: 100, y: 50, w: 500, h: 250, anchor: 'scale' }],
    });
    expect(doc.items[0]!.x).toEqual({ mode: 'scale', offset: { pct: 10 }, size: { pct: 50 } });
    expect(doc.items[0]!.y).toEqual({ mode: 'scale', offset: { pct: 10 }, size: { pct: 50 } });
  });

  it('encodes an end anchor as an offset from the far edge', () => {
    const doc = defineLayout({
      container: base,
      items: [{ id: 'a', x: 10, y: 0, w: 100, h: 10, anchor: { x: 'end' } }],
    });
    expect(doc.items[0]!.x).toEqual({ mode: 'end', offset: 890, size: 100 });
  });

  it('encodes a both anchor as a pair of edge insets', () => {
    const doc = defineLayout({
      container: base,
      items: [{ id: 'a', x: 40, y: 0, w: 900, h: 10, anchor: { x: 'both' } }],
    });
    expect(doc.items[0]!.x).toEqual({ mode: 'both', start: 40, end: 60 });
  });

  it("degrades vertical anchors to 'start' unless height is 'fill' (spec §1.6)", () => {
    const issues: Issue[] = [];
    const doc = defineLayout(
      { container: base, items: [{ id: 'a', x: 0, y: 20, w: 10, h: 50, anchor: { y: 'center' } }] },
      issues,
    );
    expect(doc.items[0]!.y).toEqual({ mode: 'start', offset: 20, size: 50 });
    expect(issues.find((i) => i.path === 'items[0].anchor.y')?.message).toContain("height:'fill'");
  });

  it("honors vertical anchors under height:'fill'", () => {
    const doc = defineLayout({
      container: { base: { width: 1000, height: 600 }, height: 'fill' },
      items: [{ id: 'a', x: 0, y: 20, w: 10, h: 50, anchor: { y: 'end' } }],
    });
    expect(doc.items[0]!.y).toEqual({ mode: 'end', offset: 530, size: 50 });
  });

  it('accepts canonical items alongside flat sugar', () => {
    const doc = defineLayout({
      container: base,
      items: [
        { id: 'flat', x: 0, y: 0, w: 10, h: 10 },
        { id: 'canonical', z: 'zz', x: { mode: 'end', offset: 5, size: 10 }, y: start(0, 10) },
      ],
    });
    expect(doc.items).toHaveLength(2);
    expect(doc.items.find((i) => i.id === 'canonical')!.x).toEqual({ mode: 'end', offset: 5, size: 10 });
  });

  it('throws on duplicate ids — the only throwing entry in the module', () => {
    expect(() =>
      defineLayout({
        container: base,
        items: [
          { id: 'a', x: 0, y: 0, w: 1, h: 1 },
          { id: 'b', x: 0, y: 0, w: 1, h: 1 },
          { id: 'a', x: 0, y: 0, w: 1, h: 1 },
        ],
      }),
    ).toThrowError(/duplicate item id "a" at items\[2\]/);
  });

  it('sorts by z and produces strictly ascending keys', () => {
    const doc = defineLayout({
      container: base,
      items: Array.from({ length: 12 }, (_, i) => ({ id: `i${i}`, x: i, y: 0, w: 1, h: 1 })),
    });
    const keys = doc.items.map((i) => i.z);
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(12);
    expect(doc.items.map((i) => i.id)).toEqual(Array.from({ length: 12 }, (_, i) => `i${i}`));
  });

  it('defaults the base width and says so', () => {
    const issues: Issue[] = [];
    const doc = defineLayout({ items: [] } as LayoutInput, issues);
    expect(doc.container.base.width).toBe(DEFAULT_BASE_WIDTH);
    expect(issues.map((i) => i.path)).toContain('container.base.width');
  });

  it('drops the flat sugar keys from the produced item', () => {
    const doc = defineLayout({
      container: base,
      items: [{ id: 'a', x: 1, y: 2, w: 3, h: 4, anchor: 'scale', tags: ['keep'] }],
    });
    const raw = doc.items[0] as unknown as Record<string, unknown>;
    expect(raw.w).toBeUndefined();
    expect(raw.h).toBeUndefined();
    expect(raw.anchor).toBeUndefined();
    expect(raw.tags).toEqual(['keep']);
    expect(raw.$unknown).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* regressions                                                         */
/* ------------------------------------------------------------------ */

describe('damaged size overrides are dropped, not repaired to 0×0', () => {
  const withOverride = (override: unknown) => ({
    version: 1,
    container: { base: { width: 1000 }, sizes: { sm: { maxWidth: 500 } } },
    items: [{ id: 'a', z: 'a0', x: start(10, 100), y: start(20, 50), at: { sm: override } }],
  });

  const overrideOf = (doc: { items: readonly unknown[] }) =>
    (doc.items[0] as { at?: Record<string, Record<string, unknown>> }).at?.sm;

  it('keeps the base placement when an override placement is unreadable', () => {
    for (const damaged of [
      { x: { mode: 'bogus' } },
      { x: null },
      { x: { mode: 'start' } }, // required terms missing → would resolve to 0×0
      { x: { mode: 'start', offset: 5 } },
      { y: { mode: 'both', start: 1 } },
    ]) {
      const issues: Issue[] = [];
      const doc = normalize(withOverride(damaged), issues);
      const override = overrideOf(doc);
      expect(override).toBeDefined();
      expect(override!.x).toBeUndefined();
      expect(override!.y).toBeUndefined();
      // the base placement survives untouched
      expect(doc.items[0].x).toEqual(start(10, 100));
      expect(issues.some((i) => /dropped/.test(i.message))).toBe(true);
    }
  });

  it('still accepts a well-formed override', () => {
    const doc = normalize(withOverride({ x: { mode: 'start', offset: 1, size: 2 } }));
    expect(overrideOf(doc)!.x).toEqual(start(1, 2));
  });

  it('stays a fixpoint after dropping the damage (L3)', () => {
    const once = normalize(withOverride({ x: { mode: 'bogus' }, hidden: true }));
    const twice = normalize(once as unknown);
    expect(twice).toEqual(once);
  });
});

describe('a `__proto__` key never mutates a prototype and never disappears', () => {
  /** JSON.parse is the only way to build an OWN `__proto__` data property. */
  const parse = (text: string): unknown => JSON.parse(text) as unknown;

  it('parks an unknown `__proto__` document key in $unknown (law L2)', () => {
    const doc = normalize(
      parse('{"version":1,"container":{"base":{"width":100}},"items":[],"__proto__":{"evil":1}}'),
    ) as unknown as { $unknown?: Record<string, unknown> };
    expect(doc.$unknown).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(doc.$unknown!, '__proto__')).toBe(true);
    expect(Object.keys(doc.$unknown!)).toContain('__proto__');
    expect(Object.getPrototypeOf(doc.$unknown!)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).evil).toBeUndefined();
  });

  it('parks an unknown `__proto__` item key too', () => {
    const doc = normalize(
      parse(
        '{"version":1,"container":{"base":{"width":100}},"items":[{"id":"a","z":"a0","x":{"mode":"start","offset":0,"size":1},"y":{"mode":"start","offset":0,"size":1},"__proto__":{"evil":1}}]}',
      ),
    );
    const parked = (doc.items[0] as unknown as { $unknown?: Record<string, unknown> }).$unknown;
    expect(parked && Object.keys(parked)).toContain('__proto__');
  });

  it('keeps a `__proto__` size name and stays a fixpoint (L3)', () => {
    const once = normalize(
      parse(
        '{"version":1,"container":{"base":{"width":100},"sizes":{"__proto__":{"maxWidth":700}}},"items":[]}',
      ),
    );
    const sizes = once.container.sizes as unknown as Record<string, unknown>;
    expect(Object.keys(sizes)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(sizes)).toBe(Object.prototype);
    expect(normalize(once as unknown)).toEqual(once);
  });

  it('keeps a `__proto__` override name and stays a fixpoint (L3)', () => {
    const once = normalize(
      parse(
        '{"version":1,"container":{"base":{"width":100}},"items":[{"id":"a","z":"a0","x":{"mode":"start","offset":0,"size":1},"y":{"mode":"start","offset":0,"size":1},"at":{"__proto__":{"hidden":true}}}]}',
      ),
    );
    const at = (once.items[0] as unknown as { at: Record<string, unknown> }).at;
    expect(Object.keys(at)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(at)).toBe(Object.prototype);
    expect(normalize(once as unknown)).toEqual(once);
  });
});
