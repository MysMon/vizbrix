import { describe, expect, it } from 'vitest';
import type { LayoutDoc } from './types';
import { serialize } from './serialize';
import { normalize } from './normalize';

function doc(items: unknown[], extra: Record<string, unknown> = {}): LayoutDoc<unknown> {
  return normalize<unknown>({
    version: 1,
    container: { base: { width: 1000 } },
    items,
    ...extra,
  });
}

const startPlacement = { mode: 'start' as const, offset: 0, size: 10 };

describe('serialize()', () => {
  it('emits schema keys in semantic order, not insertion order', () => {
    const text = serialize(
      doc([{ z: 'a0', y: startPlacement, id: 'a', locked: true, x: startPlacement }]),
    );
    const item = text.slice(text.indexOf('{', text.indexOf('"items"')));
    expect(item.indexOf('"id"')).toBeLessThan(item.indexOf('"x"'));
    expect(item.indexOf('"x"')).toBeLessThan(item.indexOf('"y"'));
    expect(item.indexOf('"y"')).toBeLessThan(item.indexOf('"z"'));
    expect(item.indexOf('"z"')).toBeLessThan(item.indexOf('"locked"'));
    expect(text.indexOf('"version"')).toBeLessThan(text.indexOf('"container"'));
    expect(text.indexOf('"container"')).toBeLessThan(text.indexOf('"items"'));
  });

  it('is insensitive to how the object was built', () => {
    const a = serialize({
      version: 1,
      items: [],
      container: { base: { width: 10 }, height: 'auto', direction: 'ltr' },
    } as unknown as LayoutDoc);
    const b = serialize({
      container: { direction: 'ltr', height: 'auto', base: { width: 10 } },
      items: [],
      version: 1,
    } as unknown as LayoutDoc);
    expect(a).toBe(b);
  });

  it('sorts unknown payload keys so $unknown diffs stay clean', () => {
    const text = serialize(
      doc([], { zeta: 1, alpha: { nested: { b: 2, a: 1 } } }),
    );
    const parsed = JSON.parse(text) as { $unknown: Record<string, unknown> };
    expect(Object.keys(parsed.$unknown)).toEqual(['alpha', 'zeta']);
    expect(text.indexOf('"a"')).toBeLessThan(text.indexOf('"b"'));
  });

  it('re-emits $unknown values verbatim', () => {
    const payload = { list: [3, 1, 2], flag: false, text: 'ünïcødé "quoted"', nil: null };
    const text = serialize(doc([], { future: payload }));
    expect((JSON.parse(text) as { $unknown: { future: unknown } }).$unknown.future).toEqual(payload);
  });

  it('omits undefined-valued keys, matching JSON semantics', () => {
    const text = serialize({
      version: 1,
      compat: undefined,
      container: { base: { width: 10, height: undefined } },
      items: [],
    } as unknown as LayoutDoc);
    expect(text).not.toContain('compat');
    expect(text).not.toContain('height');
  });

  it('emits a single line at indent 0 and parses identically', () => {
    const d = doc([{ id: 'a', z: 'a0', x: startPlacement, y: startPlacement }]);
    const compact = serialize(d, { indent: 0 });
    expect(compact).not.toContain('\n');
    expect(JSON.parse(compact)).toEqual(JSON.parse(serialize(d)));
  });

  it('produces valid JSON for empty collections', () => {
    const text = serialize(doc([]));
    expect(() => JSON.parse(text) as unknown).not.toThrow();
    expect(text).toContain('"items": []');
  });

  it('is stable across repeated calls', () => {
    const d = doc([
      { id: 'b', z: 'a1', x: { mode: 'both', start: { pct: 10 }, end: 4 }, y: startPlacement },
      { id: 'a', z: 'a0', x: startPlacement, y: startPlacement, at: { md: { hidden: true } } },
    ]);
    expect(serialize(d)).toBe(serialize(d));
  });

  it('writes Len objects with pct before px', () => {
    const text = serialize(
      doc([{ id: 'a', z: 'a0', x: { mode: 'start', offset: { px: 4, pct: 10 }, size: 10 }, y: startPlacement }]),
    );
    expect(text.indexOf('"pct"')).toBeLessThan(text.indexOf('"px"'));
  });

  it('honors toJSON on opaque data', () => {
    const text = serialize(
      doc([{ id: 'a', z: 'a0', x: startPlacement, y: startPlacement, data: { at: new Date(0) } }]),
    );
    expect(text).toContain('1970-01-01T00:00:00.000Z');
  });

  it('rejects a cyclic payload the way JSON.stringify does', () => {
    const data: Record<string, unknown> = {};
    data.self = data;
    const d = doc([{ id: 'a', z: 'a0', x: startPlacement, y: startPlacement, data }]);
    expect(() => serialize(d)).toThrowError(/cyclic/);
  });

  it('preserves keys the schema does not know rather than dropping them', () => {
    // Defensive: a hand-built doc carrying a stray key still serializes it.
    const text = serialize({
      version: 1,
      container: { base: { width: 10 } },
      items: [],
      stray: 'kept',
    } as unknown as LayoutDoc);
    expect(JSON.parse(text)).toMatchObject({ stray: 'kept' });
  });
});
