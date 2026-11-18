import { describe, expect, it } from 'vitest';
import { createDashboard, parseDashboard, serializeDashboard } from './doc';

describe('createDashboard', () => {
  it('fills defaults and flows unpositioned bricks into rows', () => {
    const doc = createDashboard({
      items: [
        { id: 'a', type: 'stat', w: 600, h: 100 },
        { id: 'b', type: 'stat', w: 600, h: 120 },
        { id: 'c', type: 'line', w: 800, h: 300 },
      ],
    });
    expect(doc.version).toBe(1);
    expect(doc.width).toBe(1200);
    expect(doc.items.map((i) => [i.x, i.y])).toEqual([
      [0, 0],
      [600, 0],
      [0, 120],
    ]);
  });

  it('places unpositioned bricks below explicitly positioned ones', () => {
    const doc = createDashboard({
      items: [
        { id: 'a', type: 'stat', x: 0, y: 0, w: 400, h: 200 },
        { id: 'b', type: 'stat', w: 400, h: 100 },
      ],
    });
    expect(doc.items[1]).toMatchObject({ x: 0, y: 200 });
  });

  it('drops default breakpoints that are wider than the design width', () => {
    expect(createDashboard({ width: 800 }).breakpoints.map((b) => b.name)).toEqual(['sm']);
  });

  it('sorts breakpoints largest first', () => {
    const doc = createDashboard({
      breakpoints: [
        { name: 's', maxWidth: 400, columns: 1 },
        { name: 'l', maxWidth: 900, columns: 3 },
      ],
    });
    expect(doc.breakpoints.map((b) => b.name)).toEqual(['l', 's']);
  });
});

describe('parseDashboard', () => {
  it('never throws and returns an empty document for garbage', () => {
    for (const input of [null, undefined, 42, 'not json', '[]', [], () => 0]) {
      const result = parseDashboard(input);
      expect(result.ok).toBe(false);
      expect(result.doc.items).toEqual([]);
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it('round-trips a document through serialize', () => {
    const doc = createDashboard({
      gap: 12,
      items: [
        { id: 'a', type: 'stat', x: 0, y: 0, w: 300, h: 120, title: 'A', props: { z: 1, a: [1, 2] } },
        { id: 'b', type: 'line', x: 300, y: 0, w: 900, h: 300, pin: 'stretch', locked: true },
      ],
      layouts: { sm: { a: { x: 0, y: 0, w: 600, h: 100 } } },
    });
    const result = parseDashboard(serializeDashboard(doc));
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.doc).toEqual(doc);
  });

  it('serializes deterministically regardless of key insertion order', () => {
    const a = createDashboard({ items: [{ id: 'a', type: 't', x: 0, y: 0, w: 100, h: 100, props: { b: 1, a: 2 } }] });
    const b = createDashboard({ items: [{ props: { a: 2, b: 1 }, h: 100, w: 100, y: 0, x: 0, type: 't', id: 'a' }] });
    expect(serializeDashboard(a)).toBe(serializeDashboard(b));
  });

  it('repairs bad items and reports each problem with a path', () => {
    const result = parseDashboard({
      version: 1,
      items: [
        { id: 'a', type: 'stat', x: 0, y: 0, w: 300, h: 100 },
        { id: 'a', type: 'stat', x: 0, y: 0, w: 300, h: 100 },
        'nope',
        { id: 'c', x: 'left', y: 0, w: 5000, h: 100, pin: 'diagonal', props: [] },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.doc.items).toHaveLength(3);
    expect(new Set(result.doc.items.map((i) => i.id)).size).toBe(3);
    const c = result.doc.items[2]!;
    expect(c).toMatchObject({ type: 'unknown', x: 0, w: 1200 });
    expect(c.pin).toBeUndefined();
    expect(c.props).toBeUndefined();
    const paths = result.issues.map((i) => i.path);
    expect(paths).toContain('items[1].id');
    expect(paths).toContain('items[2]');
    expect(paths).toContain('items[3].x');
    expect(paths).toContain('items[3].pin');
  });

  it('keeps unknown item keys so newer documents survive older readers', () => {
    const result = parseDashboard({ version: 1, items: [{ id: 'a', type: 't', x: 0, y: 0, w: 100, h: 100, future: { k: 1 } }] });
    expect((result.doc.items[0] as unknown as { future: unknown }).future).toEqual({ k: 1 });
    expect(JSON.parse(serializeDashboard(result.doc)).items[0].future).toEqual({ k: 1 });
  });

  it('loads a newer version best-effort with a warning', () => {
    const result = parseDashboard({ version: 99, items: [{ id: 'a', type: 't', x: 0, y: 0, w: 100, h: 100 }] });
    expect(result.ok).toBe(true);
    expect(result.doc.items).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ path: 'version', severity: 'warning' });
  });

  it('drops layout entries for bricks that no longer exist', () => {
    const result = parseDashboard({
      version: 1,
      items: [{ id: 'a', type: 't', x: 0, y: 0, w: 100, h: 100 }],
      layouts: { sm: { a: { x: 0, y: 0, w: 600, h: 100 }, gone: { x: 0, y: 100, w: 600, h: 100 } } },
    });
    expect(Object.keys(result.doc.layouts.sm!)).toEqual(['a']);
  });
});
