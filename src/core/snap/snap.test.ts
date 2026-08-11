import { describe, expect, it } from 'vitest';
import type { GestureSnapshot, Guide, HandleId, Rect, SnapConfig } from '../schema/types';
import { createSnapEngine } from './engine';
import { overlapRatio, resolveSnapConfig } from './providers';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const CONTAINER: Rect = { x: 0, y: 0, w: 1000, h: 800 };

function mk(
  rects: Record<string, Rect>,
  movingIds: string[],
  opts: { width?: number; height?: number; scale?: number } = {},
): GestureSnapshot {
  return {
    container: CONTAINER,
    scale: opts.scale ?? 1,
    rects: new Map(Object.entries(rects)),
    movingIds: new Set(movingIds),
    width: opts.width ?? 1000,
    height: opts.height ?? 800,
  };
}

/** Deep copy of a result — the engine's buffers are reused, so tests must. */
function snapshotResult(r: { dx: number; dy: number; guides: readonly Guide[] }): {
  dx: number;
  dy: number;
  guides: Guide[];
} {
  return { dx: r.dx, dy: r.dy, guides: r.guides.map((g) => ({ ...g })) };
}

function onAxis(guides: readonly Guide[], axis: 'x' | 'y'): Guide[] {
  return guides.filter((g) => g.axis === axis).map((g) => ({ ...g }));
}

function run(
  snap: GestureSnapshot,
  rect: Rect,
  opts: {
    config?: SnapConfig | false;
    kind?: 'move' | 'resize';
    handle?: HandleId | null;
    bypass?: boolean;
    sizeFactor?: number;
  } = {},
): { dx: number; dy: number; guides: Guide[] } {
  const engine = createSnapEngine(opts.config);
  engine.begin(snap);
  const out = snapshotResult(
    engine.query(rect, opts.kind ?? 'move', opts.handle ?? null, opts.bypass ?? false, opts.sizeFactor ?? 1),
  );
  engine.end();
  return out;
}

/* ------------------------------------------------------------------ */
/* config                                                             */
/* ------------------------------------------------------------------ */

describe('resolveSnapConfig', () => {
  it('defaults: grid OFF, threshold 8, all providers on', () => {
    expect(resolveSnapConfig()).toEqual({
      threshold: 8,
      grid: 0,
      siblings: true,
      gaps: true,
      containerEdges: true,
    });
  });

  it('grid:false and grid:0 both mean off', () => {
    expect(resolveSnapConfig({ grid: false })!.grid).toBe(0);
    expect(resolveSnapConfig({ grid: 0 })!.grid).toBe(0);
  });

  it('snap={false} disables the engine entirely', () => {
    expect(resolveSnapConfig(false)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* sibling edges                                                       */
/* ------------------------------------------------------------------ */

describe('sibling edge snapping', () => {
  const snap = mk(
    {
      a: { x: 100, y: 0, w: 300, h: 50 },
      m: { x: 400, y: 200, w: 100, h: 100 },
    },
    ['m'],
  );

  it('snaps the moving start edge exactly onto a sibling edge within threshold', () => {
    const r = run(snap, { x: 104, y: 200, w: 100, h: 100 });
    expect(r.dx).toBeCloseTo(-4, 10);
    expect(r.dy).toBe(0);
    expect(104 + r.dx).toBe(100);
  });

  it('snaps from the other side too', () => {
    const r = run(snap, { x: 94, y: 200, w: 100, h: 100 });
    expect(r.dx).toBeCloseTo(6, 10);
  });

  it('does not snap outside the threshold', () => {
    const r = run(snap, { x: 112, y: 200, w: 100, h: 100 });
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
    expect(r.guides).toHaveLength(0);
  });

  it('emits an edge guide spanning both the source and the moving rect', () => {
    const r = run(snap, { x: 104, y: 200, w: 100, h: 100 });
    const gx = onAxis(r.guides, 'x');
    expect(gx).toHaveLength(1);
    expect(gx[0]).toEqual({ axis: 'x', at: 100, from: 0, to: 300, kind: 'edge' });
  });

  it('never snaps to the moving item itself', () => {
    // The only sibling is far away; the moving rect's own edges must not
    // become candidates or a rect would be frozen to its start position.
    const solo = mk({ m: { x: 400, y: 200, w: 100, h: 100 } }, ['m']);
    const r = run(solo, { x: 402, y: 202, w: 100, h: 100 });
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
  });

  it('threshold is divided by the canvas scale', () => {
    // scale 0.5 → 8 screen px = 16 container px.
    const scaled = mk(
      { a: { x: 100, y: 0, w: 300, h: 50 }, m: { x: 400, y: 200, w: 100, h: 100 } },
      ['m'],
      { scale: 0.5 },
    );
    expect(run(scaled, { x: 112, y: 200, w: 100, h: 100 }).dx).toBeCloseTo(-12, 10);
    expect(run(snap, { x: 112, y: 200, w: 100, h: 100 }).dx).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* container + centre                                                  */
/* ------------------------------------------------------------------ */

describe('centre snapping', () => {
  it('snaps the moving centre to the container centre', () => {
    const snap = mk({ m: { x: 400, y: 600, w: 100, h: 40 } }, ['m']);
    const r = run(snap, { x: 445, y: 600, w: 100, h: 40 });
    expect(r.dx).toBeCloseTo(5, 10);
    const gx = onAxis(r.guides, 'x');
    expect(gx).toHaveLength(1);
    expect(gx[0]!.kind).toBe('center');
    expect(gx[0]!.at).toBe(500);
  });

  it('snaps the moving centre to a sibling centre', () => {
    const snap = mk(
      { b: { x: 200, y: 0, w: 200, h: 40 }, m: { x: 700, y: 600, w: 100, h: 40 } },
      ['m'],
    );
    const r = run(snap, { x: 253, y: 600, w: 100, h: 40 });
    expect(r.dx).toBeCloseTo(-3, 10);
    expect(onAxis(r.guides, 'x')[0]!.kind).toBe('center');
  });

  it('snaps to the container edges', () => {
    const snap = mk({ m: { x: 400, y: 600, w: 100, h: 40 } }, ['m']);
    expect(run(snap, { x: 5, y: 600, w: 100, h: 40 }).dx).toBeCloseTo(-5, 10);
    expect(run(snap, { x: 895, y: 600, w: 100, h: 40 }).dx).toBeCloseTo(5, 10);
  });

  it('containerEdges:false removes the container candidates', () => {
    const snap = mk({ m: { x: 400, y: 600, w: 100, h: 40 } }, ['m']);
    const r = run(snap, { x: 5, y: 600, w: 100, h: 40 }, { config: { containerEdges: false } });
    expect(r.dx).toBe(0);
  });

  it('an edge candidate beats a nearer centre candidate (priority before distance)', () => {
    const snap = mk(
      {
        e: { x: 350, y: 0, w: 20, h: 20 }, // edge at 350
        f: { x: 363, y: 300, w: 20, h: 20 }, // centre at 373
        m: { x: 700, y: 600, w: 60, h: 60 },
      },
      ['m'],
    );
    // start=345 → edge 350 (Δ+5); centre=375 → centre 373 (Δ−2, nearer).
    const r = run(snap, { x: 345, y: 600, w: 60, h: 60 });
    expect(r.dx).toBeCloseTo(5, 10);
    expect(onAxis(r.guides, 'x')[0]!.kind).toBe('edge');
  });
});

/* ------------------------------------------------------------------ */
/* equal gap                                                           */
/* ------------------------------------------------------------------ */

describe('equal-gap snapping', () => {
  const gapDoc = (movingY: number) =>
    mk(
      {
        a: { x: 0, y: 100, w: 100, h: 100 },
        b: { x: 150, y: 100, w: 100, h: 100 }, // observed gap = 50
        m: { x: 400, y: movingY, w: 100, h: 100 },
      },
      ['m'],
    );

  it('duplicates an observed gap after the trailing neighbour', () => {
    const r = run(gapDoc(100), { x: 297, y: 100, w: 100, h: 100 });
    expect(r.dx).toBeCloseTo(3, 10); // 150 + 100 + 50 = 300
    const gx = onAxis(r.guides, 'x');
    expect(gx).toHaveLength(1);
    expect(gx[0]!.kind).toBe('gap');
    expect(gx[0]!.at).toBe(300);
  });

  it('duplicates an observed gap before the leading neighbour', () => {
    // moving END edge lands at a.start − gap = −50 … use the b-side instead:
    // moving END edge at b.start − gap = 100.
    const r = run(gapDoc(100), { x: 3, y: 100, w: 94, h: 100 });
    // end = 97 → 100 (Δ+3) via the gap candidate; start 3 → 0 (Δ−3) via the
    // container edge, which outranks it.
    expect(r.dx).toBeCloseTo(-3, 10);
    expect(onAxis(r.guides, 'x')[0]!.kind).toBe('edge');
  });

  it('honours the ≥50% perpendicular overlap rule', () => {
    // Moving rect only overlaps the row by 10 of its 100 px → not in the band,
    // so no gap candidates exist and the same query does not snap.
    const r = run(gapDoc(190), { x: 297, y: 190, w: 100, h: 100 });
    expect(r.dx).toBe(0);
  });

  it('gaps:false disables the provider', () => {
    const r = run(gapDoc(100), { x: 297, y: 100, w: 100, h: 100 }, { config: { gaps: false } });
    expect(r.dx).toBe(0);
  });

  it('overlapRatio normalises by the smaller extent', () => {
    expect(overlapRatio(0, 100, 0, 100)).toBe(1);
    expect(overlapRatio(0, 100, 50, 100)).toBeCloseTo(0.5, 10);
    expect(overlapRatio(0, 100, 20, 10)).toBe(1); // fully contained
    expect(overlapRatio(0, 100, 200, 10)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* resize                                                              */
/* ------------------------------------------------------------------ */

describe('resize snapping', () => {
  const snap = mk(
    {
      a: { x: 100, y: 0, w: 300, h: 50 }, // x edges 100/400, y edges 0/50
      m: { x: 104, y: 200, w: 292, h: 100 },
    },
    ['m'],
  );

  it('handle "e" corrects the east edge only', () => {
    const r = run(snap, { x: 104, y: 200, w: 292, h: 100 }, { kind: 'resize', handle: 'e' });
    // east edge 396 → 400; the west edge at 104 is within threshold of 100 but
    // the handle does not move it, so the correction is +4, not −4.
    expect(r.dx).toBeCloseTo(4, 10);
    expect(r.dy).toBe(0);
  });

  it('handle "w" corrects the west edge only', () => {
    const r = run(snap, { x: 104, y: 200, w: 292, h: 100 }, { kind: 'resize', handle: 'w' });
    expect(r.dx).toBeCloseTo(-4, 10);
    expect(r.dy).toBe(0);
  });

  it('handle "n" leaves the x axis alone', () => {
    const r = run(snap, { x: 104, y: 54, w: 292, h: 100 }, { kind: 'resize', handle: 'n' });
    expect(r.dx).toBe(0);
    expect(r.dy).toBeCloseTo(-4, 10); // y start 54 → sibling bottom edge 50
  });

  it('handle "se" corrects both end edges', () => {
    const r = run(snap, { x: 0, y: 0, w: 396, h: 46 }, { kind: 'resize', handle: 'se' });
    expect(r.dx).toBeCloseTo(4, 10); // 396 → 400
    expect(r.dy).toBeCloseTo(4, 10); // 46 → 50
  });

  it('a null handle is treated as a move even when kind is "resize"', () => {
    const r = run(snap, { x: 104, y: 200, w: 292, h: 100 }, { kind: 'resize', handle: null });
    expect(r.dx).toBeCloseTo(-4, 10);
  });

  it('sizeMatch: an east resize matches a sibling width', () => {
    const sm = mk(
      { a: { x: 100, y: 0, w: 300, h: 50 }, m: { x: 600, y: 400, w: 296, h: 50 } },
      ['m'],
    );
    const r = run(sm, { x: 600, y: 400, w: 296, h: 50 }, { kind: 'resize', handle: 'e' });
    expect(r.dx).toBeCloseTo(4, 10); // width 296 → 300
    expect(600 + 296 + r.dx).toBe(900);
  });

  it('sizeMatch flips sign when the start edge is the one moving', () => {
    const sm = mk(
      { a: { x: 100, y: 0, w: 300, h: 50 }, m: { x: 600, y: 400, w: 296, h: 50 } },
      ['m'],
    );
    const r = run(sm, { x: 600, y: 400, w: 296, h: 50 }, { kind: 'resize', handle: 'w' });
    expect(r.dx).toBeCloseTo(-4, 10); // x 600 → 596, width 296 → 300
  });

  it('sizeMatch never fires during a move', () => {
    const sm = mk(
      { a: { x: 100, y: 0, w: 300, h: 50 }, m: { x: 600, y: 400, w: 296, h: 50 } },
      ['m'],
    );
    const r = run(sm, { x: 600, y: 400, w: 296, h: 50 });
    expect(r.dx).toBe(0);
  });

  it('sizeMatch divides the correction by the edge-response factor', () => {
    // A from-centre resize changes the size 2 px per px of edge travel, so
    // matching the 300 px sibling from 296 takes 2 px of correction — the
    // caller folds it back into the pointer delta and lands exactly 300.
    const sm = mk(
      { a: { x: 100, y: 0, w: 300, h: 50 }, m: { x: 600, y: 400, w: 296, h: 50 } },
      ['m'],
    );
    const r = run(sm, { x: 600, y: 400, w: 296, h: 50 }, { kind: 'resize', handle: 'e', sizeFactor: 2 });
    expect(r.dx).toBeCloseTo(2, 10);
    // The guide is drawn where the driven edge lands after the fold.
    const gx = onAxis(r.guides, 'x');
    expect(gx).toHaveLength(1);
    expect(gx[0]!.at).toBe(898);
  });

  it('sizeMatch keeps the flipped sign under a factor when the start edge moves', () => {
    const sm = mk(
      { a: { x: 100, y: 0, w: 300, h: 50 }, m: { x: 600, y: 400, w: 296, h: 50 } },
      ['m'],
    );
    const r = run(sm, { x: 600, y: 400, w: 296, h: 50 }, { kind: 'resize', handle: 'w', sizeFactor: 2 });
    expect(r.dx).toBeCloseTo(-2, 10);
  });

  it('the factor widens the size capture window to match the edge threshold', () => {
    // 288 → 300 is a 12 px size difference: outside the plain ±8 window, but
    // only 6 px of edge travel at factor 2 — still within the user's reach.
    const sm = mk(
      { a: { x: 100, y: 0, w: 300, h: 50 }, m: { x: 600, y: 400, w: 288, h: 50 } },
      ['m'],
    );
    const rect = { x: 600, y: 400, w: 288, h: 50 };
    expect(run(sm, rect, { kind: 'resize', handle: 'e' }).dx).toBe(0);
    expect(run(sm, rect, { kind: 'resize', handle: 'e', sizeFactor: 2 }).dx).toBeCloseTo(6, 10);
  });
});

/* ------------------------------------------------------------------ */
/* grid                                                                */
/* ------------------------------------------------------------------ */

describe('grid snapping', () => {
  const snap = mk({ m: { x: 400, y: 400, w: 40, h: 40 } }, ['m']);

  it('is off by default', () => {
    const r = run(snap, { x: 103, y: 203, w: 40, h: 40 });
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
  });

  it('snaps to the configured step on both axes', () => {
    const r = run(snap, { x: 103, y: 203, w: 40, h: 40 }, { config: { grid: 10 } });
    expect(r.dx).toBeCloseTo(-3, 10);
    expect(r.dy).toBeCloseTo(-3, 10);
    expect(onAxis(r.guides, 'x')[0]!.kind).toBe('grid');
  });

  it('loses to a sibling edge in range', () => {
    const withSibling = mk(
      { a: { x: 96, y: 0, w: 400, h: 50 }, m: { x: 400, y: 400, w: 40, h: 40 } },
      ['m'],
    );
    // start 103 → grid 100 (Δ−3) vs sibling edge 96 (Δ−7): edge outranks grid.
    const r = run(withSibling, { x: 103, y: 600, w: 40, h: 40 }, { config: { grid: 10 } });
    expect(r.dx).toBeCloseTo(-7, 10);
    expect(onAxis(r.guides, 'x')[0]!.kind).toBe('edge');
  });
});

/* ------------------------------------------------------------------ */
/* bypass / lifecycle                                                  */
/* ------------------------------------------------------------------ */

describe('bypass and lifecycle', () => {
  const snap = mk(
    { a: { x: 100, y: 0, w: 300, h: 50 }, m: { x: 400, y: 200, w: 100, h: 100 } },
    ['m'],
  );

  it('bypass returns a zero correction and no guides', () => {
    const r = run(snap, { x: 104, y: 200, w: 100, h: 100 }, { bypass: true });
    expect(r).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('snap={false} disables every query', () => {
    const r = run(snap, { x: 104, y: 200, w: 100, h: 100 }, { config: false });
    expect(r).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('query before begin() is a no-op', () => {
    const engine = createSnapEngine();
    expect(snapshotResult(engine.query({ x: 104, y: 200, w: 100, h: 100 }, 'move', null, false)))
      .toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('end() drops the collected state', () => {
    const engine = createSnapEngine();
    engine.begin(snap);
    expect(engine.query({ x: 104, y: 200, w: 100, h: 100 }, 'move', null, false).dx).toBeCloseTo(
      -4,
      10,
    );
    engine.end();
    expect(snapshotResult(engine.query({ x: 104, y: 200, w: 100, h: 100 }, 'move', null, false)))
      .toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('begin() can restart a gesture with a fresh snapshot', () => {
    const engine = createSnapEngine();
    engine.begin(snap);
    engine.end();
    engine.begin(mk({ a: { x: 700, y: 0, w: 50, h: 50 }, m: { x: 0, y: 0, w: 10, h: 10 } }, ['m']));
    expect(engine.query({ x: 704, y: 400, w: 10, h: 10 }, 'move', null, false).dx).toBeCloseTo(
      -4,
      10,
    );
  });
});

/* ------------------------------------------------------------------ */
/* guides                                                              */
/* ------------------------------------------------------------------ */

describe('guides', () => {
  it('merges collinear sources into one line spanning the union', () => {
    const snap = mk(
      {
        a: { x: 100, y: 0, w: 100, h: 50 },
        b: { x: 100, y: 300, w: 100, h: 50 },
        m: { x: 600, y: 600, w: 137, h: 50 },
      },
      ['m'],
    );
    const r = run(snap, { x: 104, y: 600, w: 137, h: 50 });
    expect(r.dx).toBeCloseTo(-4, 10);
    const gx = onAxis(r.guides, 'x');
    expect(gx).toHaveLength(1);
    expect(gx[0]).toEqual({ axis: 'x', at: 100, from: 0, to: 650, kind: 'edge' });
  });

  it('emits one guide per distinct line satisfied by the same correction', () => {
    // Sibling spans 100..200; an equally wide rect at 104 aligns start→100,
    // centre→150 and end→200 with the very same −4 correction: three lines,
    // each labelled by what actually produced it.
    const snap = mk(
      { a: { x: 100, y: 0, w: 100, h: 50 }, m: { x: 600, y: 600, w: 100, h: 50 } },
      ['m'],
    );
    const r = run(snap, { x: 104, y: 600, w: 100, h: 50 });
    expect(r.dx).toBeCloseTo(-4, 10);
    const gx = onAxis(r.guides, 'x').sort((p, q) => p.at - q.at);
    expect(gx.map((g) => g.at)).toEqual([100, 150, 200]);
    expect(gx.map((g) => g.kind)).toEqual(['edge', 'center', 'edge']);
  });

  it('emits guides for both axes independently', () => {
    const snap = mk(
      { a: { x: 100, y: 300, w: 100, h: 100 }, m: { x: 600, y: 600, w: 100, h: 100 } },
      ['m'],
    );
    const r = run(snap, { x: 104, y: 304, w: 100, h: 100 });
    expect(r.dx).toBeCloseTo(-4, 10);
    expect(r.dy).toBeCloseTo(-4, 10);
    expect(onAxis(r.guides, 'x').length).toBeGreaterThan(0);
    expect(onAxis(r.guides, 'y').length).toBeGreaterThan(0);
  });

  it('reuses the result object and guide buffers across frames', () => {
    const engine = createSnapEngine();
    engine.begin(
      mk({ a: { x: 100, y: 0, w: 300, h: 50 }, m: { x: 400, y: 200, w: 100, h: 100 } }, ['m']),
    );
    const r1 = engine.query({ x: 104, y: 200, w: 100, h: 100 }, 'move', null, false);
    const g1 = r1.guides[0]!;
    const r2 = engine.query({ x: 104, y: 200, w: 100, h: 100 }, 'move', null, false);
    // Documented contract: consumers must not retain results across frames.
    expect(r2).toBe(r1);
    expect(r2.guides[0]).toBe(g1);
    // …and the buffer is cleared, not appended to.
    expect(r2.guides).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* determinism                                                         */
/* ------------------------------------------------------------------ */

describe('determinism', () => {
  it('two identical queries produce identical results', () => {
    const snap = mk(
      {
        a: { x: 100, y: 0, w: 300, h: 50 },
        b: { x: 100, y: 300, w: 300, h: 50 },
        c: { x: 0, y: 100, w: 100, h: 100 },
        d: { x: 150, y: 100, w: 100, h: 100 },
        m: { x: 400, y: 100, w: 100, h: 100 },
      },
      ['m'],
    );
    const engine = createSnapEngine({ grid: 10 });
    engine.begin(snap);
    const rect = { x: 297, y: 104, w: 100, h: 100 };
    const first = snapshotResult(engine.query(rect, 'move', null, false));
    const second = snapshotResult(engine.query(rect, 'move', null, false));
    expect(second).toEqual(first);

    // …and across engines built from the same snapshot.
    const other = createSnapEngine({ grid: 10 });
    other.begin(snap);
    expect(snapshotResult(other.query(rect, 'move', null, false))).toEqual(first);
  });

  it('is order-independent w.r.t. equal candidates', () => {
    const build = (order: string[]) => {
      const all: Record<string, Rect> = {
        a: { x: 100, y: 0, w: 100, h: 50 },
        b: { x: 100, y: 300, w: 100, h: 50 },
        m: { x: 600, y: 600, w: 137, h: 50 },
      };
      const rects: Record<string, Rect> = {};
      for (const k of order) rects[k] = all[k]!;
      return mk(rects, ['m']);
    };
    const r1 = run(build(['a', 'b', 'm']), { x: 104, y: 600, w: 137, h: 50 });
    const r2 = run(build(['b', 'm', 'a']), { x: 104, y: 600, w: 137, h: 50 });
    expect(r2.dx).toBe(r1.dx);
    expect(r2.guides).toEqual(r1.guides);
  });
});

/* ------------------------------------------------------------------ */
/* coverage / re-collect                                               */
/* ------------------------------------------------------------------ */

describe('coverage re-collect', () => {
  /** A long row of 1000 items — far more than the 512-candidate cap. */
  function longRow(): GestureSnapshot {
    const rects: Record<string, Rect> = { m: { x: 0, y: 500, w: 40, h: 40 } };
    for (let i = 0; i < 1000; i++) {
      rects[`i${i}`] = { x: i * 50, y: 100, w: 40, h: 40 };
    }
    return mk(rects, ['m'], { width: 60_000, height: 800 });
  }

  it('still snaps to a far item after the moving rect leaves the collected region', () => {
    const engine = createSnapEngine();
    engine.begin(longRow());

    // Near the anchor: inside the initial coverage.
    expect(engine.query({ x: 104, y: 500, w: 40, h: 40 }, 'move', null, false).dx).toBeCloseTo(
      -4,
      10,
    );

    // Far beyond it: requires a transparent re-collect.
    const far = snapshotResult(engine.query({ x: 49_004, y: 500, w: 40, h: 40 }, 'move', null, false));
    expect(far.dx).toBeCloseTo(-4, 10);
    expect(far.guides.length).toBeGreaterThan(0);

    // And back again.
    expect(engine.query({ x: 104, y: 500, w: 40, h: 40 }, 'move', null, false).dx).toBeCloseTo(
      -4,
      10,
    );
    engine.end();
  });

  it('a rect parked past the end of the document does not thrash', () => {
    const engine = createSnapEngine();
    engine.begin(longRow());
    const rect = { x: 59_000, y: 500, w: 40, h: 40 };
    const a = snapshotResult(engine.query(rect, 'move', null, false));
    const b = snapshotResult(engine.query(rect, 'move', null, false));
    expect(b).toEqual(a);
    engine.end();
  });
});

/* ------------------------------------------------------------------ */
/* performance smoke                                                   */
/* ------------------------------------------------------------------ */

describe('performance', () => {
  it('1000-item begin() plus 500 queries stays well inside a frame budget', () => {
    const rects: Record<string, Rect> = { m: { x: 0, y: 0, w: 80, h: 60 } };
    for (let i = 0; i < 1000; i++) {
      rects[`i${i}`] = { x: (i % 40) * 100, y: Math.floor(i / 40) * 80, h: 60, w: 80 };
    }
    const snap = mk(rects, ['m'], { width: 4000, height: 2000 });

    const t0 = performance.now();
    const engine = createSnapEngine({ grid: 8 });
    engine.begin(snap);
    let acc = 0;
    for (let f = 0; f < 500; f++) {
      const r = engine.query(
        { x: 3 + f * 1.7, y: 5 + f * 0.9, w: 80, h: 60 },
        'move',
        null,
        false,
      );
      acc += r.dx + r.dy + r.guides.length;
    }
    engine.end();
    const ms = performance.now() - t0;

    expect(Number.isFinite(acc)).toBe(true);
    // Target is < 50 ms; asserted loosely so a cold CI box cannot flake it.
    expect(ms).toBeLessThan(500);
  });
});
