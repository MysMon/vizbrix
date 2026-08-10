/**
 * Marketing-asset test (spec §15.6): resolve ∘ reencode is the identity within
 * half a pixel, for every anchor mode, across randomized positions, sizes and
 * container extents.
 *
 * This is the law that makes anchors safe to change: `setAnchor` resolves the
 * item at the current extent and re-encodes it under the new mode, and the item
 * must not move by so much as a visible pixel.
 */

import { describe, expect, it } from 'vitest';
import type { AxisMode, ContainerConfig, LayoutItemBase } from '../schema/types';
import { resolveAxis, resolveItem } from './resolve';
import { reencodeAxis, reencodeRect } from './reencode';

const MODES: AxisMode[] = ['start', 'end', 'both', 'center', 'scale'];
const TOLERANCE = 0.5;

/** Deterministic PRNG — a failing case is always reproducible from the seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('reencodeAxis ∘ resolveAxis identity', () => {
  it('round-trips within 0.5px over 20000 randomized cases per mode', () => {
    const rng = mulberry32(0x5eed);
    let worst = 0;
    let worstCase = '';
    for (const mode of MODES) {
      for (let i = 0; i < 20000; i++) {
        const extent = 1 + rng() * 9999; // W ∈ [1, 10000]
        const size = rng() * extent;
        const pos = rng() * (extent - size);
        const placement = reencodeAxis(pos, size, extent, mode);
        expect(placement.mode).toBe(mode);
        const back = resolveAxis(placement, extent);
        const dPos = Math.abs(back.pos - pos);
        const dSize = Math.abs(back.size - size);
        const d = Math.max(dPos, dSize);
        if (d > worst) {
          worst = d;
          worstCase = `${mode} pos=${pos} size=${size} extent=${extent}`;
        }
      }
    }
    expect(worst, `worst case: ${worstCase}`).toBeLessThanOrEqual(TOLERANCE);
  });

  it('round-trips items placed outside the container (negative and overflowing)', () => {
    const rng = mulberry32(99);
    for (const mode of MODES) {
      for (let i = 0; i < 5000; i++) {
        const extent = 1 + rng() * 9999;
        const size = rng() * extent * 2;
        const pos = (rng() - 0.5) * extent * 2;
        const back = resolveAxis(reencodeAxis(pos, size, extent, mode), extent);
        expect(Math.abs(back.pos - pos)).toBeLessThanOrEqual(TOLERANCE);
        expect(Math.abs(back.size - size)).toBeLessThanOrEqual(TOLERANCE);
      }
    }
  });

  it('holds at the extremes of the declared extent range', () => {
    for (const mode of MODES) {
      for (const extent of [1, 2, 375, 1440, 9999, 10000]) {
        for (const [pos, size] of [
          [0, 0],
          [0, extent],
          [extent / 3, extent / 3],
          [extent - 1, 1],
        ] as const) {
          const back = resolveAxis(reencodeAxis(pos, size, extent, mode), extent);
          expect(Math.abs(back.pos - pos), `${mode}@${extent}`).toBeLessThanOrEqual(TOLERANCE);
          expect(Math.abs(back.size - size), `${mode}@${extent}`).toBeLessThanOrEqual(TOLERANCE);
        }
      }
    }
  });
});

describe('reencodeAxis encoding shape', () => {
  it('writes pixels for px modes and fractions for scale', () => {
    expect(reencodeAxis(20, 300, 1000, 'start')).toEqual({ mode: 'start', offset: 20, size: 300 });
    expect(reencodeAxis(20, 300, 1000, 'end')).toEqual({ mode: 'end', offset: 680, size: 300 });
    expect(reencodeAxis(20, 300, 1000, 'both')).toEqual({ mode: 'both', start: 20, end: 680 });
    expect(reencodeAxis(400, 200, 1000, 'center')).toEqual({ mode: 'center', offset: 0, size: 200 });
    expect(reencodeAxis(250, 500, 1000, 'scale')).toEqual({
      mode: 'scale',
      offset: { pct: 25 },
      size: { pct: 50 },
    });
  });

  it('rounds px to 2 decimals and pct to 4', () => {
    const p = reencodeAxis(10.123456, 20.987654, 1000, 'start');
    expect(p).toEqual({ mode: 'start', offset: 10.12, size: 20.99 });
    const s = reencodeAxis(1 / 3, 2 / 3, 999, 'scale');
    expect(s).toEqual({ mode: 'scale', offset: { pct: 0.0334 }, size: { pct: 0.0667 } });
  });

  it('emits canonical lengths — no zero terms survive into the JSON', () => {
    expect(JSON.stringify(reencodeAxis(0, 100, 1000, 'start'))).toBe(
      '{"mode":"start","offset":0,"size":100}',
    );
    expect(JSON.stringify(reencodeAxis(0, 500, 1000, 'scale'))).toBe(
      '{"mode":"scale","offset":0,"size":{"pct":50}}',
    );
  });

  it('never emits Infinity or NaN at a zero extent', () => {
    for (const mode of MODES) {
      const json = JSON.stringify(reencodeAxis(10, 20, 0, mode));
      expect(json).not.toContain('null');
      expect(json).not.toContain('Infinity');
    }
  });

  it('is total for garbage input', () => {
    const p = reencodeAxis(Number.NaN, Number.POSITIVE_INFINITY, 1000, 'start');
    expect(p).toEqual({ mode: 'start', offset: 0, size: 0 });
  });
});

describe('reencodeRect ∘ resolveItem identity', () => {
  const item = (id: string): LayoutItemBase => ({
    id,
    x: { mode: 'start', offset: 0, size: 10 },
    y: { mode: 'start', offset: 0, size: 10 },
    z: 'a0',
  });

  it('round-trips rects for every mode pair under height:"fill"', () => {
    const rng = mulberry32(7);
    const config: ContainerConfig = { base: { width: 1200, height: 800 }, height: 'fill' };
    for (const xMode of MODES) {
      for (const yMode of MODES) {
        for (let i = 0; i < 400; i++) {
          const width = 1 + rng() * 2000;
          const height = 1 + rng() * 2000;
          const rect = {
            x: rng() * width * 0.5,
            y: rng() * height * 0.5,
            w: rng() * width * 0.5,
            h: rng() * height * 0.5,
          };
          const pair = reencodeRect(rect, config, width, height, xMode, yMode);
          const back = resolveItem({ ...item('a'), ...pair }, config, width, height);
          expect(Math.abs(back.x - rect.x)).toBeLessThanOrEqual(TOLERANCE);
          expect(Math.abs(back.y - rect.y)).toBeLessThanOrEqual(TOLERANCE);
          expect(Math.abs(back.w - rect.w)).toBeLessThanOrEqual(TOLERANCE);
          expect(Math.abs(back.h - rect.h)).toBeLessThanOrEqual(TOLERANCE);
        }
      }
    }
  });

  it('degrades every y mode to plain-pixel start under height:"auto"', () => {
    const config: ContainerConfig = { base: { width: 1200, height: 800 } };
    for (const yMode of MODES) {
      const pair = reencodeRect({ x: 10, y: 120, w: 100, h: 50 }, config, 1200, 640, 'start', yMode);
      expect(pair.y).toEqual({ mode: 'start', offset: 120, size: 50 });
      // and it still round-trips, at any measured height
      const back = resolveItem({ id: 'a', z: 'a0', ...pair }, config, 1200, 999);
      expect(back.y).toBe(120);
      expect(back.h).toBe(50);
    }
  });
});

describe('setAnchor invariance', () => {
  it('changing an anchor mode never moves the item', () => {
    const rng = mulberry32(1234);
    const config: ContainerConfig = { base: { width: 1000, height: 700 }, height: 'fill' };
    for (let i = 0; i < 2000; i++) {
      const width = 1 + rng() * 3000;
      const height = 1 + rng() * 3000;
      const from = MODES[Math.floor(rng() * MODES.length)];
      const to = MODES[Math.floor(rng() * MODES.length)];
      const rect = {
        x: rng() * width,
        y: rng() * height,
        w: rng() * width * 0.4,
        h: rng() * height * 0.4,
      };
      const original = reencodeRect(rect, config, width, height, from, to);
      const item: LayoutItemBase = { id: 'a', z: 'a0', ...original };
      // resolve at the current extent, re-encode with new modes
      const resolved = resolveItem(item, config, width, height);
      const next = MODES[Math.floor(rng() * MODES.length)];
      const reanchored = reencodeRect(resolved, config, width, height, next, next);
      const after = resolveItem({ ...item, ...reanchored }, config, width, height);
      expect(Math.abs(after.x - resolved.x)).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(after.y - resolved.y)).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(after.w - resolved.w)).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(after.h - resolved.h)).toBeLessThanOrEqual(TOLERANCE);
    }
  });
});
