import { describe, expect, it } from 'vitest';
import { isValidKey, keyBetween, keysBetween } from './fractional';

/**
 * Deterministic LCG (Numerical Recipes constants) so property-test failures
 * are reproducible from the printed seed, per spec §15.3 — `Math.random` is
 * intentionally never used here (it *is* used inside `keyBetween`'s jitter
 * step in production, which is fine: that's collision-resistance jitter, not
 * test determinism).
 */
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function assertSorted(keys: readonly string[], seed: number): void {
  for (let i = 1; i < keys.length; i++) {
    expect(
      keys[i - 1] < keys[i],
      `seed=${seed}: order violated at index ${i}: ${JSON.stringify(keys[i - 1])} >= ${JSON.stringify(keys[i])}`,
    ).toBe(true);
  }
}

describe('keyBetween — basics', () => {
  it('returns a valid key for two null bounds', () => {
    const k = keyBetween(null, null);
    expect(isValidKey(k)).toBe(true);
  });

  it('front insert (null, b) is strictly less than b', () => {
    const b = keyBetween(null, null);
    const a = keyBetween(null, b);
    expect(a < b).toBe(true);
    expect(isValidKey(a)).toBe(true);
  });

  it('back insert (a, null) is strictly greater than a', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    expect(b > a).toBe(true);
    expect(isValidKey(b)).toBe(true);
  });

  it('between two existing keys is strictly between them', () => {
    const a = keyBetween(null, null);
    const c = keyBetween(a, null);
    const b = keyBetween(a, c);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
    expect(isValidKey(b)).toBe(true);
  });

  it('rejects an inverted bound pair', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    expect(() => keyBetween(b, a)).toThrow();
  });

  it('rejects equal bounds', () => {
    const a = keyBetween(null, null);
    expect(() => keyBetween(a, a)).toThrow();
  });

  it('repeated calls with the same bounds do not always collide (jitter)', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    const results = new Set<string>();
    for (let i = 0; i < 50; i++) {
      results.add(keyBetween(a, b));
    }
    // Jitter makes collisions unlikely though not impossible; with 50 draws
    // from a wide space we expect meaningfully more than 1 distinct value.
    expect(results.size).toBeGreaterThan(1);
    for (const k of results) {
      expect(k > a && k < b).toBe(true);
    }
  });

  it('handles the classic prefix-of-upper-bound hazard (a="a1", b="a1V")', () => {
    // Not necessarily literal internal candidates, but exercises a case
    // where the deterministic candidate is a proper prefix of the upper
    // bound: jitter must never be allowed to overshoot it.
    for (let i = 0; i < 2000; i++) {
      const k = keyBetween('a1', 'a1V');
      expect(k > 'a1' && k < 'a1V').toBe(true);
    }
  });
});

describe('isValidKey', () => {
  it('rejects the empty string', () => {
    expect(isValidKey('')).toBe(false);
  });

  it('rejects characters outside the base-62 alphabet', () => {
    expect(isValidKey('a0-')).toBe(false);
    expect(isValidKey('a0 ')).toBe(false);
    expect(isValidKey('a0_')).toBe(false);
  });

  it('accepts a bare integer part ending in the magnitude digit 0', () => {
    expect(isValidKey('a0')).toBe(true);
  });

  it('rejects a redundant trailing zero in the fractional suffix', () => {
    expect(isValidKey('a0V0')).toBe(false);
  });

  it('accepts every key keyBetween produces', () => {
    let prev: string | null = null;
    for (let i = 0; i < 500; i++) {
      const k: string = keyBetween(prev, null);
      expect(isValidKey(k)).toBe(true);
      prev = k;
    }
  });
});

describe('keysBetween', () => {
  it('generates n keys, sorted, strictly inside (a, b)', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    const keys = keysBetween(a, b, 25);
    expect(keys).toHaveLength(25);
    assertSorted(keys, 0);
    expect(a < keys[0]).toBe(true);
    expect(keys[keys.length - 1] < b).toBe(true);
  });

  it('generates n keys with an open lower bound', () => {
    const b = keyBetween(null, null);
    const keys = keysBetween(null, b, 25);
    expect(keys).toHaveLength(25);
    assertSorted(keys, 0);
    expect(keys[keys.length - 1] < b).toBe(true);
  });

  it('generates n keys with an open upper bound', () => {
    const a = keyBetween(null, null);
    const keys = keysBetween(a, null, 25);
    expect(keys).toHaveLength(25);
    assertSorted(keys, 0);
    expect(a < keys[0]).toBe(true);
  });

  it('handles n=0 and n=1', () => {
    expect(keysBetween(null, null, 0)).toEqual([]);
    expect(keysBetween(null, null, 1)).toHaveLength(1);
  });
});

describe('property: 1e5 interleaved mixed inserts maintain strict total order', () => {
  const SEED = 20260810;
  const OPS = 100_000;
  // Bounded working set so per-op cost stays O(1) amortized instead of the
  // O(n) array-splice cost a fully materialized growing sorted array would
  // pay on every "insert between two random existing keys" — with OPS in
  // the 1e5 range that quadratic blowup is the difference between
  // milliseconds and minutes. Correctness of "strict total order after
  // every insert" is checked *locally* at each op (the freshly generated
  // key is verified strictly between the exact bounds passed to
  // `keyBetween`); by induction over 1e5 such locally-verified inserts the
  // full historical sequence is transitively totally ordered, without
  // needing to re-scan a materialized 1e5-element array on every op.
  const SAMPLE_BOUND = 500;

  it(`seed=${SEED}`, () => {
    const rand = makeLcg(SEED);

    let globalMin = keyBetween(null, null);
    let globalMax = globalMin;
    // Always sorted, always includes globalMin/globalMax at its ends.
    const sample: string[] = [globalMin];

    for (let i = 0; i < OPS; i++) {
      const roll = rand();
      let newKey: string;

      if (roll < 0.34) {
        const hi = globalMin;
        newKey = keyBetween(null, hi);
        expect(newKey < hi, `seed=${SEED} op=${i}: front insert not < ${JSON.stringify(hi)}`).toBe(true);
        globalMin = newKey;
        sample.unshift(newKey);
      } else if (roll < 0.68) {
        const lo = globalMax;
        newKey = keyBetween(lo, null);
        expect(newKey > lo, `seed=${SEED} op=${i}: back insert not > ${JSON.stringify(lo)}`).toBe(true);
        globalMax = newKey;
        sample.push(newKey);
      } else {
        const idx = 1 + Math.floor(rand() * (sample.length - 1));
        const lo = sample[idx - 1];
        const hi = sample[idx];
        newKey = keyBetween(lo, hi);
        expect(
          newKey > lo && newKey < hi,
          `seed=${SEED} op=${i}: between-insert ${JSON.stringify(newKey)} not strictly between ${JSON.stringify(lo)} and ${JSON.stringify(hi)}`,
        ).toBe(true);
        sample.splice(idx, 0, newKey);
      }

      expect(isValidKey(newKey), `seed=${SEED} op=${i}: generated invalid key ${JSON.stringify(newKey)}`).toBe(
        true,
      );

      // Evict a random interior sample entry (never the current min/max) to
      // keep the bounded working set from growing unboundedly. This can
      // only ever *reduce* future insertion pressure, never invalidate an
      // already-verified ordering.
      if (sample.length > SAMPLE_BOUND) {
        const evictIdx = 1 + Math.floor(rand() * (sample.length - 2));
        sample.splice(evictIdx, 1);
      }
    }

    assertSorted(sample, SEED);
    expect(sample[0]).toBe(globalMin);
    expect(sample[sample.length - 1]).toBe(globalMax);
  });
});

describe('property: key length growth stays bounded under sequential same-end inserts', () => {
  const N = 10_000;
  const BOUND = 40;

  it(`10k sequential front-inserts stay under ${BOUND} chars`, () => {
    let cursor: string | null = keyBetween(null, null);
    let maxLen = cursor.length;
    for (let i = 0; i < N; i++) {
      cursor = keyBetween(null, cursor);
      if (cursor.length > maxLen) maxLen = cursor.length;
    }
    expect(maxLen, `observed max key length after ${N} sequential front-inserts: ${maxLen}`).toBeLessThan(BOUND);
  });

  it(`10k sequential back-inserts stay under ${BOUND} chars`, () => {
    let cursor: string | null = keyBetween(null, null);
    let maxLen = cursor.length;
    for (let i = 0; i < N; i++) {
      cursor = keyBetween(cursor, null);
      if (cursor.length > maxLen) maxLen = cursor.length;
    }
    expect(maxLen, `observed max key length after ${N} sequential back-inserts: ${maxLen}`).toBeLessThan(BOUND);
  });

  it('interleaved front+back inserts from a single origin stay bounded', () => {
    const origin = keyBetween(null, null);
    let front: string | null = origin;
    let back: string | null = origin;
    let maxLen = origin.length;
    for (let i = 0; i < N; i++) {
      front = keyBetween(null, front);
      back = keyBetween(back, null);
      maxLen = Math.max(maxLen, front.length, back.length);
    }
    expect(
      maxLen,
      `observed max key length after ${N} interleaved front+back inserts: ${maxLen}`,
    ).toBeLessThan(BOUND);
  });
});
