import { describe, expect, it } from 'vitest';
import type { AxisPlacement, ContainerConfig, LayoutItemBase } from '../schema/types';
import { canonLen, lenAt } from './len';
import { degradesOnY, resolveAxis, resolveItem } from './resolve';
import { activeSizesAt, foldItem, stackOrder } from './cascade';

function item(partial: Partial<LayoutItemBase> & { id: string }): LayoutItemBase {
  return {
    x: { mode: 'start', offset: 0, size: 100 },
    y: { mode: 'start', offset: 0, size: 100 },
    z: 'a0',
    ...partial,
  };
}

const fill: ContainerConfig = { base: { width: 1000, height: 800 }, height: 'fill' };
const auto: ContainerConfig = { base: { width: 1000, height: 800 } };

describe('lenAt', () => {
  it('evaluates the affine form pct/100 · W + px', () => {
    expect(lenAt(12, 1000)).toBe(12);
    expect(lenAt({ pct: 50 }, 1000)).toBe(500);
    expect(lenAt({ pct: 25, px: -10 }, 800)).toBe(190);
    expect(lenAt({ px: 4 }, 1000)).toBe(4);
    expect(lenAt({}, 1000)).toBe(0);
  });

  it('is total: garbage collapses to 0 instead of producing NaN', () => {
    expect(lenAt(Number.NaN, 100)).toBe(0);
    expect(lenAt(undefined as unknown as number, 100)).toBe(0);
    expect(lenAt({ pct: Number.POSITIVE_INFINITY }, 100)).toBe(0);
    expect(lenAt({ pct: 50 }, Number.NaN)).toBe(0);
  });

  it('is invariant under canonicalization', () => {
    const samples = [0, 12, -3.5, { px: 12 }, { pct: 0, px: 12 }, { pct: 25 }, { pct: 25, px: 0 }, { pct: 25, px: -8 }, {}];
    for (const s of samples) {
      expect(lenAt(canonLen(s), 640)).toBeCloseTo(lenAt(s, 640), 10);
    }
  });
});

describe('canonLen', () => {
  it('strips zero terms and collapses pure px to a bare number', () => {
    expect(canonLen({ pct: 0, px: 12 })).toBe(12);
    expect(canonLen({ px: 12 })).toBe(12);
    expect(canonLen({})).toBe(0);
    expect(canonLen({ pct: 25, px: 0 })).toEqual({ pct: 25 });
    expect(canonLen({ pct: 25, px: -8 })).toEqual({ pct: 25, px: -8 });
    expect(canonLen(7)).toBe(7);
  });

  it('normalizes -0 so JSON stays clean', () => {
    expect(Object.is(canonLen(-0), 0)).toBe(true);
  });
});

describe('resolveAxis', () => {
  const W = 1000;

  it('start and scale share the same arm', () => {
    expect(resolveAxis({ mode: 'start', offset: 20, size: 300 }, W)).toEqual({ pos: 20, size: 300 });
    expect(resolveAxis({ mode: 'scale', offset: { pct: 2 }, size: { pct: 30 } }, W)).toEqual({
      pos: 20,
      size: 300,
    });
  });

  it('end measures the offset from the END edge', () => {
    expect(resolveAxis({ mode: 'end', offset: 20, size: 300 }, W)).toEqual({ pos: 680, size: 300 });
  });

  it('both derives the size from the two edges', () => {
    expect(resolveAxis({ mode: 'both', start: 40, end: 60 }, W)).toEqual({ pos: 40, size: 900 });
    expect(resolveAxis({ mode: 'both', start: { pct: 10 }, end: { pct: 10 } }, W)).toEqual({
      pos: 100,
      size: 800,
    });
  });

  it('center offsets the item centre from the container centre', () => {
    expect(resolveAxis({ mode: 'center', offset: 0, size: 200 }, W)).toEqual({ pos: 400, size: 200 });
    expect(resolveAxis({ mode: 'center', offset: 100, size: 200 }, W)).toEqual({ pos: 500, size: 200 });
  });

  it('does not clamp — a degenerate both may be negative', () => {
    expect(resolveAxis({ mode: 'both', start: 700, end: 700 }, W).size).toBe(-400);
  });

  it('is total for malformed placements', () => {
    expect(resolveAxis(undefined as unknown as AxisPlacement, W)).toEqual({ pos: 0, size: 0 });
    expect(resolveAxis({ mode: 'nonsense' } as unknown as AxisPlacement, W)).toEqual({ pos: 0, size: 0 });
  });
});

describe('resolveItem clamping', () => {
  it('clamps the size and keeps the anchored edge anchored', () => {
    const min = item({ id: 'a', x: { mode: 'end', offset: 100, size: 50 }, minW: 200 });
    // end edge stays at 1000 − 100 = 900 → x = 700, w = 200
    expect(resolveItem(min, fill, 1000, 800)).toMatchObject({ x: 700, w: 200 });

    const centered = item({ id: 'b', x: { mode: 'center', offset: 0, size: 900 }, maxW: 400 });
    // centre stays at 500 → x = 300, w = 400
    expect(resolveItem(centered, fill, 1000, 800)).toMatchObject({ x: 300, w: 400 });

    const startAnchored = item({ id: 'c', x: { mode: 'start', offset: 30, size: 50 }, minW: 120 });
    expect(resolveItem(startAnchored, fill, 1000, 800)).toMatchObject({ x: 30, w: 120 });
  });

  it("both min-clamp grows toward the END edge (over-constrained abspos)", () => {
    const it0 = item({ id: 'a', x: { mode: 'both', start: 100, end: 800 }, minW: 400 });
    const r = resolveItem(it0, fill, 1000, 800);
    // start edge pinned at 100, size grown to 400 → the box overflows the end edge
    expect(r.x).toBe(100);
    expect(r.w).toBe(400);
  });

  it('derives the centred position from the floored size', () => {
    // size = 50% − 300px, negative below 600px: the box collapses to zero and
    // sits on the container centre (this is what the emitted CSS does too).
    const it0 = item({ id: 'a', x: { mode: 'center', offset: 0, size: { pct: 50, px: -300 } } });
    expect(resolveItem(it0, fill, 400, 800)).toMatchObject({ x: 200, w: 0 });
    expect(resolveItem(it0, fill, 800, 800)).toMatchObject({ x: 350, w: 100 });
  });

  it('min wins over a smaller max, and sizes never go negative', () => {
    const conflicting = item({ id: 'a', x: { mode: 'start', offset: 0, size: 50 }, minW: 300, maxW: 100 });
    expect(resolveItem(conflicting, fill, 1000, 800).w).toBe(300);

    const negative = item({ id: 'b', x: { mode: 'both', start: 900, end: 900 } });
    expect(resolveItem(negative, fill, 1000, 800).w).toBe(0);
  });

  it('resolves y against the measured height only under height:"fill"', () => {
    const it0 = item({ id: 'a', y: { mode: 'both', start: 10, end: 10 } });
    expect(resolveItem(it0, fill, 1000, 600)).toMatchObject({ y: 10, h: 580 });
    // under 'auto' the measured height is ignored: y freezes at base.height
    expect(resolveItem(it0, auto, 1000, 600)).toMatchObject({ y: 10, h: 780 });
  });

  it('is independent of the measured height under height:"auto"', () => {
    const it0 = item({ id: 'a', y: { mode: 'end', offset: 50, size: 100 } });
    const a = resolveItem(it0, auto, 1000, 400);
    const b = resolveItem(it0, auto, 1000, 9999);
    expect(a).toEqual(b);
    expect(a.y).toBe(800 - 50 - 100);
  });
});

describe('degradesOnY', () => {
  it('flags every non-start y mode under auto height', () => {
    for (const mode of ['end', 'both', 'center', 'scale'] as const) {
      expect(degradesOnY(auto, mode)).toBe(true);
      expect(degradesOnY(fill, mode)).toBe(false);
    }
    expect(degradesOnY(auto, 'start')).toBe(false);
    expect(degradesOnY({ base: { width: 100 } }, 'center')).toBe(true);
  });
});

describe('activeSizesAt', () => {
  const config: ContainerConfig = {
    base: { width: 1200 },
    sizes: { md: { maxWidth: 900 }, sm: { maxWidth: 600 }, lg: { maxWidth: 1100 } },
  };

  it('activates every size whose maxWidth is >= the width, descending', () => {
    expect(activeSizesAt(config, 1200)).toEqual([]);
    expect(activeSizesAt(config, 1100)).toEqual(['lg']);
    expect(activeSizesAt(config, 900)).toEqual(['lg', 'md']);
    expect(activeSizesAt(config, 320)).toEqual(['lg', 'md', 'sm']);
  });

  it('is inclusive at the boundary and deterministic on ties', () => {
    expect(activeSizesAt(config, 901)).toEqual(['lg']);
    const ties: ContainerConfig = { base: { width: 100 }, sizes: { b: { maxWidth: 600 }, a: { maxWidth: 600 } } };
    expect(activeSizesAt(ties, 100)).toEqual(['a', 'b']);
  });

  it('tolerates missing or malformed size declarations', () => {
    expect(activeSizesAt({ base: { width: 100 } }, 100)).toEqual([]);
    const bad = { base: { width: 100 }, sizes: { x: { maxWidth: Number.NaN } } } as unknown as ContainerConfig;
    expect(activeSizesAt(bad, 100)).toEqual([]);
  });
});

describe('foldItem', () => {
  const base = item({
    id: 'a',
    x: { mode: 'start', offset: 10, size: 100 },
    y: { mode: 'start', offset: 10, size: 100 },
    at: {
      lg: { x: { mode: 'start', offset: 20, size: 200 } },
      md: { x: { mode: 'both', start: 0, end: 0 }, hidden: true },
      sm: { hidden: false, order: 3 },
    },
  });

  it('returns the same object when nothing applies', () => {
    expect(foldItem(base, [])).toBe(base);
    expect(foldItem(item({ id: 'b' }), ['md'])).toBeTruthy();
  });

  it('replaces placements wholesale, smaller sizes winning', () => {
    expect(foldItem(base, ['lg']).x).toEqual({ mode: 'start', offset: 20, size: 200 });
    expect(foldItem(base, ['lg', 'md']).x).toEqual({ mode: 'both', start: 0, end: 0 });
    expect(foldItem(base, ['lg', 'md']).hidden).toBe(true);
    expect(foldItem(base, ['lg', 'md', 'sm']).hidden).toBe(false);
    expect(foldItem(base, ['lg', 'md', 'sm']).order).toBe(3);
    // untouched axes fall through
    expect(foldItem(base, ['lg', 'md', 'sm']).y).toEqual({ mode: 'start', offset: 10, size: 100 });
  });

  it('never mutates the input', () => {
    const snapshot = JSON.stringify(base);
    foldItem(base, ['lg', 'md', 'sm']);
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it('is idempotent for a given active list', () => {
    const once = foldItem(base, ['lg', 'md']);
    const twice = foldItem(once, ['lg', 'md']);
    expect(twice).toEqual(once);
  });

  it('folds in the order activeSizesAt produces, so JS matches the CSS cascade', () => {
    const config: ContainerConfig = {
      base: { width: 1200 },
      sizes: { lg: { maxWidth: 1100 }, md: { maxWidth: 900 }, sm: { maxWidth: 600 } },
    };
    const folded = foldItem(base, activeSizesAt(config, 400));
    expect(folded.hidden).toBe(false);
    expect(folded.x).toEqual({ mode: 'both', start: 0, end: 0 });
  });
});

describe('stackOrder', () => {
  const config: ContainerConfig = { base: { width: 1000, height: 800 }, height: 'fill' };
  const mk = (id: string, x: number, y: number, extra: Partial<LayoutItemBase> = {}) =>
    item({ id, x: { mode: 'start', offset: x, size: 100 }, y: { mode: 'start', offset: y, size: 50 }, ...extra });

  it('orders by resolved y, then x, then id', () => {
    const items = [mk('c', 0, 200), mk('a', 300, 100), mk('b', 10, 100)];
    expect(stackOrder(items, config)).toEqual(['b', 'a', 'c']);
  });

  it('breaks exact ties by id, not by input order', () => {
    const items = [mk('z', 0, 0), mk('a', 0, 0)];
    expect(stackOrder(items, config)).toEqual(['a', 'z']);
  });

  it('honors item.order as a rank replacement', () => {
    const items = [mk('c', 0, 200), mk('a', 300, 100), mk('b', 10, 100, { order: 0 })];
    // geometric ranks: b=0, a=1, c=2 — b already first, order is a no-op here
    expect(stackOrder(items, config)).toEqual(['b', 'a', 'c']);
    const promoted = [mk('c', 0, 200, { order: 0 }), mk('a', 300, 100), mk('b', 10, 100)];
    expect(stackOrder(promoted, config)).toEqual(['c', 'b', 'a']);
  });

  it('is computed at base.width, so it does not change with the container', () => {
    const items = [mk('a', 0, 0), mk('b', 0, 100)];
    expect(stackOrder(items, config)).toEqual(stackOrder(items, { ...config, base: { width: 320, height: 800 } }));
  });

  it('does not fold overrides itself (fold first if you want per-size order)', () => {
    const withOverride = item({
      id: 'a',
      y: { mode: 'start', offset: 500, size: 10 },
      at: { sm: { order: 0 } },
    });
    const other = mk('b', 0, 0);
    const cfg: ContainerConfig = { ...config, sizes: { sm: { maxWidth: 600 } } };
    expect(stackOrder([withOverride, other], cfg)).toEqual(['b', 'a']);
    expect(stackOrder([foldItem(withOverride, ['sm']), other], cfg)).toEqual(['a', 'b']);
  });
});

describe('purity', () => {
  it('resolveItem does not mutate the item', () => {
    const it0 = item({ id: 'a', at: { md: { x: { mode: 'end', offset: 0, size: 10 } } } });
    const snapshot = JSON.stringify(it0);
    resolveItem(it0, { base: { width: 1000 }, sizes: { md: { maxWidth: 900 } } }, 500);
    expect(JSON.stringify(it0)).toBe(snapshot);
  });

  it('resolveItem is deterministic for identical inputs', () => {
    const it0 = item({ id: 'a', x: { mode: 'center', offset: { pct: 3, px: 7 }, size: { pct: 20 } } });
    expect(resolveItem(it0, fill, 977, 613)).toEqual(resolveItem(it0, fill, 977, 613));
  });
});
