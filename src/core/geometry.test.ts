import { describe, expect, it } from 'vitest';
import { createDashboard } from './doc';
import {
  activeVariant,
  affine,
  compileCss,
  flowLayout,
  frameFor,
  fromPixels,
  readingOrder,
  resolveVariant,
  toPixels,
} from './geometry';
import { PINS, type Rect } from './types';

const doc = createDashboard({
  width: 1200,
  gap: 16,
  padding: 8,
  items: [
    { id: 'a', type: 't', x: 0, y: 0, w: 300, h: 100 },
    { id: 'b', type: 't', x: 300, y: 0, w: 900, h: 100 },
    { id: 'c', type: 't', x: 0, y: 100, w: 1200, h: 200 },
  ],
});

describe('toPixels / fromPixels', () => {
  const rect: Rect = { x: 240, y: 40, w: 360, h: 200 };

  it('renders 1:1 at the width where the canvas equals the design width', () => {
    // canvas = container + gap - 2·padding  ⇒  container = 1200 - 16 + 16
    const frame = { d: 1200, gap: 16, padding: 8, container: 1200 };
    for (const pin of PINS) {
      expect(toPixels(rect, pin, frame)).toEqual({ x: 248, y: 48, w: 344, h: 184 });
    }
  });

  it('is exactly invertible for every pin (while a stretched brick still has width)', () => {
    for (const container of [900, 1200, 1920]) {
      const frame = { d: 1200, gap: 16, padding: 8, container };
      for (const pin of PINS) {
        const back = fromPixels(toPixels(rect, pin, frame), pin, frame);
        for (const key of ['x', 'y', 'w', 'h'] as const) expect(back[key]).toBeCloseTo(rect[key], 6);
      }
    }
  });

  it('keeps gutters a constant pixel size while scaling', () => {
    const frame = { d: 1200, gap: 16, padding: 0, container: 700 };
    const a = toPixels({ x: 0, y: 0, w: 300, h: 100 }, 'scale', frame);
    const b = toPixels({ x: 300, y: 0, w: 900, h: 100 }, 'scale', frame);
    expect(a.x).toBeCloseTo(0);
    expect(b.x - (a.x + a.w)).toBeCloseTo(16);
    expect(b.x + b.w).toBeCloseTo(700);
  });

  it('applies each pin as documented when the container grows', () => {
    const narrow = { d: 1200, gap: 0, padding: 0, container: 1200 };
    const wide = { ...narrow, container: 1500 };
    const r: Rect = { x: 200, y: 0, w: 400, h: 100 };
    expect(toPixels(r, 'left', wide)).toMatchObject({ x: 200, w: 400 });
    expect(toPixels(r, 'right', wide)).toMatchObject({ x: 500, w: 400 });
    expect(toPixels(r, 'stretch', wide)).toMatchObject({ x: 200, w: 700 });
    expect(toPixels(r, 'center', wide)).toMatchObject({ x: 350, w: 400 });
    expect(toPixels(r, 'scale', wide)).toMatchObject({ x: 250, w: 500 });
    expect(toPixels(r, 'scale', narrow)).toMatchObject({ x: 200, w: 400 });
  });

  it('agrees with the affine form used for CSS', () => {
    for (const pin of PINS) {
      const a = affine(rect, pin, 1200, 16, 8);
      const frame = { d: 1200, gap: 16, padding: 8, container: 913 };
      const px = toPixels(rect, pin, frame);
      expect(a.la * 913 + a.lb).toBeCloseTo(px.x);
      expect(a.wa * 913 + a.wb).toBeCloseTo(px.w);
    }
  });
});

describe('variants', () => {
  it('picks the tightest breakpoint that fits', () => {
    expect(activeVariant(doc, 1400)).toBe('base');
    expect(activeVariant(doc, 961)).toBe('base');
    expect(activeVariant(doc, 960)).toBe('md');
    expect(activeVariant(doc, 601)).toBe('md');
    expect(activeVariant(doc, 600)).toBe('sm');
  });

  it('derives a stacked single column for the narrowest breakpoint', () => {
    const sm = resolveVariant(doc, 'sm');
    expect(sm.auto).toBe(true);
    expect(sm.width).toBe(600);
    expect([...sm.rects.entries()]).toEqual([
      ['a', { x: 0, y: 0, w: 600, h: 100 }],
      ['b', { x: 0, y: 100, w: 600, h: 100 }],
      ['c', { x: 0, y: 200, w: 600, h: 200 }],
    ]);
    expect(sm.height).toBe(400);
  });

  it('memoizes per document', () => {
    expect(resolveVariant(doc, 'md')).toBe(resolveVariant(doc, 'md'));
  });

  it('uses hand-placed rects and flows new bricks in below them', () => {
    const manual = { ...doc, layouts: { sm: { a: { x: 0, y: 0, w: 300, h: 80 }, b: { x: 300, y: 0, w: 300, h: 80 } } } };
    const sm = resolveVariant(manual, 'sm');
    expect(sm.auto).toBe(false);
    expect(sm.rects.get('a')).toEqual({ x: 0, y: 0, w: 300, h: 80 });
    expect(sm.rects.get('c')).toEqual({ x: 0, y: 80, w: 600, h: 200 });
  });
});

describe('flowLayout', () => {
  const bp = { name: 'md', maxWidth: 800, columns: 2 };
  const item = (id: string, x: number, y: number, w: number, h: number) => ({ id, type: 't', x, y, w, h });

  it('packs rows, stretching the last brick of a ragged row and equalising heights', () => {
    const out = flowLayout(
      [item('k1', 0, 0, 300, 100), item('k2', 300, 0, 300, 120), item('k3', 600, 0, 300, 100), item('wide', 0, 120, 1200, 300)],
      1200,
      bp,
    );
    expect(out.get('k1')).toEqual({ x: 0, y: 0, w: 400, h: 120 });
    expect(out.get('k2')).toEqual({ x: 400, y: 0, w: 400, h: 120 });
    expect(out.get('k3')).toEqual({ x: 0, y: 120, w: 800, h: 100 });
    expect(out.get('wide')).toEqual({ x: 0, y: 220, w: 800, h: 300 });
  });

  it('orders by visual rows, not raw y', () => {
    const order = readingOrder([item('tall', 600, 0, 600, 400), item('top', 0, 10, 600, 100), item('under', 0, 110, 600, 290)]);
    expect(order.map((i) => i.id)).toEqual(['top', 'tall', 'under']);
  });
});

describe('compileCss', () => {
  it('emits base rules and one container query per breakpoint', () => {
    const css = compileCss(doc, 'S');
    expect(css).toContain('[data-vbx-scope="S"]>.vbx-canvas{height:300px}');
    expect(css).toContain('[data-vbx-item="a"]{left:8px;top:8px;width:calc(25% - 16px);height:84px}');
    expect(css).toContain('@container vbx (max-width:960px)');
    expect(css).toContain('@container vbx (max-width:600px)');
    expect(css.indexOf('960px')).toBeLessThan(css.indexOf('600px'));
  });

  it('cannot be broken out of by a hostile id', () => {
    const evil = createDashboard({ items: [{ id: '"]}</style><script>alert(1)</script>', type: 't', x: 0, y: 0, w: 100, h: 100 }] });
    const css = compileCss(evil, 'x"y');
    expect(css).not.toContain('</style');
    expect(css).not.toContain('<script');
    expect(css).not.toMatch(/="x"y"/);
  });

  it('matches toPixels for pinned items', () => {
    const pinned = createDashboard({ gap: 0, items: [{ id: 'r', type: 't', x: 900, y: 0, w: 300, h: 100, pin: 'right' }] });
    expect(compileCss(pinned, 's')).toContain('{left:calc(100% - 300px);top:0px;width:300px;height:100px}');
    const frame = frameFor(pinned, resolveVariant(pinned, 'base'), 1000);
    expect(toPixels(pinned.items[0]!, 'right', frame).x).toBe(700);
  });
});
