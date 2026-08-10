/**
 * Round-trip laws (spec §15.4). These are the persistence guarantees the
 * README cites, checked over seeded random documents so a counterexample is
 * always replayable from its seed.
 *
 * - **L1** `load(serialize(doc)).doc` deep-equals `doc`.
 * - **L2** unknown keys injected by a "newer writer" survive byte-identically.
 * - **L3** `normalize` is idempotent.
 * - **L5** every field a migration drops is reported with a path.
 */

import { describe, expect, it } from 'vitest';
import type { Issue, LayoutDoc } from './types';
import { load, isLoaded } from './load';
import { serialize } from './serialize';
import { normalize } from './normalize';
import { validate } from './validate';
import type { Migration } from './migrate';
import { diffKeyPaths, migrate } from './migrate';
import { injectUnknown, makeRng, randomDoc, randomRawDoc } from './testing';

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

function loaded(input: unknown, seed: number): LayoutDoc<unknown> {
  const outcome = load<unknown>(input);
  if (!isLoaded(outcome)) {
    throw new Error(
      `seed ${seed}: expected a document, got ${outcome.status} — ${JSON.stringify(outcome)}`,
    );
  }
  return outcome.doc;
}

/* ------------------------------------------------------------------ */
/* generator sanity                                                    */
/* ------------------------------------------------------------------ */

describe('random document generator', () => {
  it('is deterministic for a seed', () => {
    expect(JSON.stringify(randomRawDoc(1234))).toBe(JSON.stringify(randomRawDoc(1234)));
    expect(JSON.stringify(randomRawDoc(1234))).not.toBe(JSON.stringify(randomRawDoc(1235)));
  });

  it('produces identical geometry for a seed (generated z keys carry jitter)', () => {
    const strip = (doc: LayoutDoc<unknown>) => ({
      ...doc,
      items: doc.items.map(({ z: _z, ...rest }) => rest),
    });
    expect(strip(randomDoc(77))).toEqual(strip(randomDoc(77)));
  });

  it('accepts a shared rng so callers can interleave draws', () => {
    const rng = makeRng(7);
    const a = randomRawDoc(rng);
    const b = randomRawDoc(rng);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('produces structurally valid raw documents', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const raw = randomRawDoc(seed);
      const errors = validate(raw).filter((i) => i.severity === 'error');
      expect(errors, `seed ${seed}`).toEqual([]);
    }
  });

  it('exercises every axis mode across the seed range', () => {
    const modes = new Set<string>();
    for (const seed of SEEDS) {
      for (const item of randomDoc(seed, { fillHeight: true }).items) {
        modes.add(item.x.mode);
        modes.add(item.y.mode);
      }
    }
    expect([...modes].sort()).toEqual(['both', 'center', 'end', 'scale', 'start']);
  });
});

/* ------------------------------------------------------------------ */
/* L1                                                                  */
/* ------------------------------------------------------------------ */

describe('L1 — load(serialize(doc)) deep-equals doc', () => {
  it('holds for every seeded document', () => {
    for (const seed of SEEDS) {
      const doc = randomDoc(seed);
      const text = serialize(doc);
      const back = loaded(text, seed);
      expect(back, `seed ${seed}`).toEqual(doc);
    }
  });

  it('is byte-stable: serialize ∘ load ∘ serialize is a fixpoint', () => {
    for (const seed of SEEDS) {
      const text = serialize(randomDoc(seed));
      expect(serialize(loaded(text, seed)), `seed ${seed}`).toBe(text);
    }
  });

  it('survives a second full trip', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const doc = randomDoc(seed);
      const once = loaded(serialize(doc), seed);
      const twice = loaded(serialize(once), seed);
      expect(twice, `seed ${seed}`).toEqual(doc);
    }
  });

  it('holds for the compact (indent 0) encoding too', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const doc = randomDoc(seed);
      expect(loaded(serialize(doc, { indent: 0 }), seed), `seed ${seed}`).toEqual(doc);
    }
  });
});

/* ------------------------------------------------------------------ */
/* L2                                                                  */
/* ------------------------------------------------------------------ */

describe('L2 — injected unknown keys survive byte-identically', () => {
  it('parks and re-emits document- and item-level unknowns', () => {
    for (const seed of SEEDS) {
      const raw = injectUnknown(randomRawDoc(seed));
      const doc = loaded(raw, seed);

      expect(doc.$unknown, `seed ${seed}`).toMatchObject({
        futureMode: 'orbital',
        futureNums: [2, 1],
        parkedEarlier: 1,
      });
      for (let i = 0; i < doc.items.length; i++) {
        expect(doc.items[i]!.$unknown, `seed ${seed} item ${i}`).toBeTruthy();
      }

      // A byte-identical fixpoint: nothing degrades on repeated trips.
      const text = serialize(doc);
      expect(serialize(loaded(text, seed)), `seed ${seed}`).toBe(text);
    }
  });

  it('keeps unknown values structurally untouched', () => {
    const payload = {
      futureShape: { curve: [0, 1, 2], nested: { deep: { deeper: 'yes' } } },
      futureNull: null,
      futureNumber: 1.5,
    };
    const doc = loaded(injectUnknown(randomRawDoc(99), payload), 99);
    expect(doc.$unknown).toMatchObject(payload);
  });

  it('keeps a future writer version and its unknown keys through the trip', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const raw = { ...injectUnknown(randomRawDoc(seed)), version: 2, compat: 1 };
      const outcome = load<unknown>(raw);
      expect(outcome.status, `seed ${seed}`).toBe('forward-degraded');
      if (outcome.status !== 'forward-degraded') continue;
      expect(outcome.ignored.length).toBeGreaterThan(0);
      const text = serialize(outcome.doc);
      expect(JSON.parse(text)).toMatchObject({ version: 2 });
      expect(serialize(loaded(text, seed))).toBe(text);
    }
  });
});

/* ------------------------------------------------------------------ */
/* L3                                                                  */
/* ------------------------------------------------------------------ */

describe('L3 — normalize is idempotent', () => {
  it('holds for raw generated documents', () => {
    for (const seed of SEEDS) {
      const raw = randomRawDoc(seed);
      const once = normalize(raw);
      const twice = normalize(once);
      expect(twice, `seed ${seed}`).toEqual(once);
      expect(serialize(twice), `seed ${seed}`).toBe(serialize(once));
    }
  });

  it('holds for documents carrying unknown payloads', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const raw = injectUnknown(randomRawDoc(seed, { withUnknown: true }));
      const once = normalize(raw);
      expect(normalize(once), `seed ${seed}`).toEqual(once);
    }
  });

  it('reaches a fixpoint in one pass from damaged input', () => {
    const rng = makeRng(4242);
    for (let n = 0; n < 60; n++) {
      const raw = damage(randomRawDoc(rng), rng);
      const once = normalize(raw);
      expect(normalize(once)).toEqual(once);
      // …and the fixpoint is a document the loader accepts unconditionally.
      expect(load(serialize(once)).status).toBe('ok');
    }
  });

  it('produces documents that validate cleanly except for advisory warnings', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const doc = normalize(randomRawDoc(seed));
      const errors = validate(doc).filter((i: Issue) => i.severity === 'error');
      expect(errors, `seed ${seed}`).toEqual([]);
    }
  });
});

/** Randomly corrupts a document the way a bad writer or a hand edit would. */
function damage(raw: Record<string, unknown>, rng: () => number): Record<string, unknown> {
  const items = (Array.isArray(raw.items) ? raw.items : []).map((item) => {
    const record = { ...(item as Record<string, unknown>) };
    if (rng() < 0.3) delete record.z;
    if (rng() < 0.2) record.id = 'collide';
    if (rng() < 0.2) record.minW = -1;
    if (rng() < 0.2) record.collision = 'push';
    if (rng() < 0.2) record.x = { mode: 'unknown-mode' };
    if (rng() < 0.2) record.strayKey = { deep: [1, 2] };
    return record;
  });
  const out: Record<string, unknown> = { ...raw, items };
  if (rng() < 0.3) out.version = 'v1';
  if (rng() < 0.3) out.container = { base: {} };
  if (rng() < 0.3) out.strayDocKey = 'x';
  return out;
}

/* ------------------------------------------------------------------ */
/* L5                                                                  */
/* ------------------------------------------------------------------ */

describe('L5 — migrations report every field they drop', () => {
  /** A migration that discards a field on purpose and never says so. */
  const forgetful: Migration = {
    from: 0,
    to: 1,
    describe: 'drops decoration',
    up(raw) {
      const items = Array.isArray(raw.items) ? raw.items : [];
      return {
        version: 1,
        container: raw.container,
        items: items.map((entry) => {
          const { decoration: _drop, legacy: _drop2, ...rest } = entry as Record<string, unknown>;
          return rest;
        }),
      };
    },
  };

  it('auto-reports drops the migration forgot, for every seeded document', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const raw = randomRawDoc(seed);
      const before = {
        ...raw,
        version: 0,
        items: (raw.items as Record<string, unknown>[]).map((item) => ({
          ...item,
          decoration: { glow: true },
          legacy: seed,
        })),
      };
      const outcome = migrate(before, [forgetful]);
      expect(outcome.status, `seed ${seed}`).toBe('migrated');
      if (outcome.status !== 'migrated') continue;

      const reported = new Set(outcome.issues.map((i) => i.path));
      for (let i = 0; i < (before.items as unknown[]).length; i++) {
        expect(reported.has(`items[${i}].decoration`), `seed ${seed} item ${i}`).toBe(true);
        expect(reported.has(`items[${i}].legacy`), `seed ${seed} item ${i}`).toBe(true);
      }
    }
  });

  it('every dropped path from the key-set diff has an issue', () => {
    const before = {
      version: 0,
      container: { base: { width: 800 } },
      items: [
        {
          id: 'a',
          x: { mode: 'start', offset: 0, size: 10 },
          y: { mode: 'start', offset: 0, size: 10 },
          decoration: { glow: true },
          legacy: 1,
        },
      ],
    };
    const outcome = migrate(before, [forgetful]);
    if (outcome.status !== 'migrated') throw new Error('expected a migration');

    const after = {
      version: 1,
      container: before.container,
      items: [{ id: 'a', x: before.items[0]!.x, y: before.items[0]!.y }],
    };
    const dropped = diffKeyPaths(before, after).filter((p) => p !== 'version');
    const reported = new Set(outcome.issues.map((i) => i.path));
    expect(dropped).not.toHaveLength(0);
    for (const path of dropped) expect(reported.has(path), path).toBe(true);
  });
});
