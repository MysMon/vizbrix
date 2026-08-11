import { describe, expect, it } from 'vitest';
import type { Issue, LayoutDoc, LoadOutcome } from './types';
import { SCHEMA_VERSION } from './types';
import { load, isLoaded } from './load';
import { validate } from './validate';
import { serialize } from './serialize';

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

function v1(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    container: { base: { width: 1200 }, sizes: { md: { maxWidth: 900 } } },
    items: [
      { id: 'a', x: { mode: 'start', offset: 10, size: 100 }, y: { mode: 'start', offset: 0, size: 80 }, z: 'a0' },
      { id: 'b', x: { mode: 'end', offset: 20, size: 200 }, y: { mode: 'start', offset: 100, size: 80 }, z: 'a1' },
    ],
    ...overrides,
  };
}

function paths(issues: readonly Issue[]): string[] {
  return issues.map((i) => i.path);
}

function docOf(outcome: LoadOutcome<undefined>): LayoutDoc<undefined> {
  if (!isLoaded(outcome)) throw new Error(`expected a document, got ${outcome.status}`);
  return outcome.doc;
}

/* ------------------------------------------------------------------ */
/* totality                                                           */
/* ------------------------------------------------------------------ */

describe('load() never throws', () => {
  const hostile: [string, unknown][] = [
    ['undefined', undefined],
    ['null', null],
    ['zero', 0],
    ['NaN', NaN],
    ['empty string', ''],
    ['non-JSON string', 'not json {{{'],
    ['JSON scalar string', '42'],
    ['JSON null string', 'null'],
    ['array', []],
    ['array of docs', [v1()]],
    ['empty object', {}],
    ['boolean', true],
    ['function', () => 0],
    ['symbol', Symbol('x')],
    ['Date', new Date(0)],
    ['Map', new Map()],
    ['doc with null items', { version: 1, container: { base: { width: 10 } }, items: null }],
    ['doc with scalar items', { version: 1, container: { base: { width: 10 } }, items: [1, 'x', null] }],
    ['negative version', { version: -3, container: {}, items: [] }],
    ['fractional version', { version: 1.5, container: {}, items: [] }],
    ['huge version', { version: Number.MAX_SAFE_INTEGER, container: { base: { width: 1 } }, items: [] }],
  ];

  for (const [name, input] of hostile) {
    it(`survives ${name}`, () => {
      const outcome = load(input);
      expect(outcome).toBeTruthy();
      expect(typeof outcome.status).toBe('string');
    });
  }

  it('survives a cyclic document without traversing the cycle', () => {
    const cyclic: Record<string, unknown> = v1();
    cyclic.self = cyclic;
    const outcome = load(cyclic);
    expect(outcome.status).toBe('ok');
    // The cycle is parked by reference, never walked.
    expect(docOf(outcome).$unknown?.self).toBe(cyclic);
  });

  it('survives a document whose data payload is cyclic', () => {
    const data: Record<string, unknown> = {};
    data.loop = data;
    const doc = v1();
    (doc.items as Record<string, unknown>[])[0]!.data = data;
    expect(load(doc).status).toBe('ok');
  });

  it('survives a deeply nested unknown payload', () => {
    let nested: unknown = 1;
    for (let i = 0; i < 5000; i++) nested = { nested };
    expect(load(v1({ deep: nested })).status).toBe('ok');
  });
});

/* ------------------------------------------------------------------ */
/* version dispatch                                                    */
/* ------------------------------------------------------------------ */

describe('load() version dispatch', () => {
  it('accepts a current-version document', () => {
    const outcome = load(v1());
    expect(outcome.status).toBe('ok');
    expect(docOf(outcome).items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('accepts a serialized JSON string', () => {
    const outcome = load(JSON.stringify(v1()));
    expect(outcome.status).toBe('ok');
  });

  it('reports a JSON parse failure as invalid, not a throw', () => {
    const outcome = load('{ "version": 1, ');
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(outcome.errors[0]!.message).toContain('not valid JSON');
  });

  it('rejects a missing version with a path', () => {
    const { version: _drop, ...rest } = v1();
    const outcome = load(rest);
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(paths(outcome.errors)).toContain('version');
  });

  it('rejects version < 1: there is no migration path (registry is empty at v1)', () => {
    for (const version of [0, -1, -99]) {
      const outcome = load(v1({ version }));
      expect(outcome.status).toBe('invalid');
      if (outcome.status !== 'invalid') continue;
      expect(outcome.errors.some((e) => e.path === 'version')).toBe(true);
    }
  });

  it('degrades a future document whose compat floor this reader satisfies', () => {
    const future = v1({
      version: 2,
      compat: 1,
      curvature: { kind: 'bezier' },
      items: [
        {
          id: 'a',
          x: { mode: 'start', offset: 10, size: 100 },
          y: { mode: 'start', offset: 0, size: 80 },
          z: 'a0',
          rotation: 45,
        },
      ],
    });
    const outcome = load(future);
    expect(outcome.status).toBe('forward-degraded');
    if (outcome.status !== 'forward-degraded') return;
    expect(outcome.ignored).toEqual(['curvature', 'items[0].rotation']);
    // Everything ignored is parked, not lost.
    expect(outcome.doc.$unknown).toEqual({ curvature: { kind: 'bezier' } });
    expect(outcome.doc.items[0]!.$unknown).toEqual({ rotation: 45 });
    // The original version survives so serialize() writes the future doc back.
    expect(outcome.doc.version).toBe(2);
  });

  it('lists every path it did not understand, at every level it drops one', () => {
    const outcome = load({
      version: 2,
      compat: 1,
      container: {
        base: { width: 1200, depth: 3 },
        sizes: { md: { maxWidth: 900, minWidth: 400 } },
        grid: 8,
      },
      items: [
        {
          id: 'a',
          x: { mode: 'start', offset: 10, size: 100, skew: 2 },
          y: { mode: 'start', offset: { px: 0, deg: 90 }, size: 80 },
          z: 'a0',
          at: { md: { hidden: true, glow: 1 } },
          future: 'kept',
        },
      ],
    });
    expect(outcome.status).toBe('forward-degraded');
    if (outcome.status !== 'forward-degraded') return;
    // Every key below is gone from the re-serialized bytes, so the caller that
    // gates a write-back on `ignored` has to be told about all of them.
    expect([...outcome.ignored].sort()).toEqual([
      'container.base.depth',
      'container.grid',
      'container.sizes.md.minWidth',
      'items[0].at.md.glow',
      'items[0].future',
      'items[0].x.skew',
      'items[0].y.offset.deg',
    ]);
    const written = serialize(outcome.doc);
    for (const key of ['depth', 'grid', 'minWidth', 'glow', 'skew', 'deg']) {
      expect(written).not.toContain(key);
    }
  });

  it('lists an axis mode only a newer reader knows', () => {
    const outcome = load(
      v1({
        version: 2,
        compat: 1,
        items: [
          {
            id: 'a',
            x: { mode: 'start', offset: 0, size: 1 },
            y: { mode: 'start', offset: 0, size: 1 },
            z: 'a0',
            at: { md: { x: { mode: 'orbital', offset: 0, size: 1 } } },
          },
        ],
      }),
    );
    expect(outcome.status).toBe('forward-degraded');
    if (outcome.status !== 'forward-degraded') return;
    expect(outcome.ignored).toContain('items[0].at.md.x');
  });

  it('refuses a future document whose compat floor exceeds this reader', () => {
    const outcome = load(v1({ version: 9, compat: 4 }));
    expect(outcome.status).toBe('incompatible');
    if (outcome.status !== 'incompatible') return;
    expect(outcome.compat).toBe(4);
    expect(outcome.reason).toContain('v4');
  });

  it('treats an absent compat as the default floor of 1', () => {
    expect(load(v1({ version: 7 })).status).toBe('forward-degraded');
  });

  it('rejects a future document that is not even structurally v1-readable', () => {
    const outcome = load({ version: 3, compat: 1, container: { base: {} }, items: 'nope' });
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(paths(outcome.errors)).toContain('items');
  });
});

/* ------------------------------------------------------------------ */
/* structural errors                                                   */
/* ------------------------------------------------------------------ */

describe('load() structural errors', () => {
  it('requires container.base.width', () => {
    const outcome = load(v1({ container: { base: {} } }));
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(paths(outcome.errors)).toContain('container.base.width');
  });

  it('reports per-item placement errors with indexed paths', () => {
    const outcome = load(
      v1({
        items: [
          { id: 'a', x: { mode: 'start', offset: 0, size: 0 }, y: { mode: 'start', offset: 0, size: 0 } },
          { id: 'b', x: { mode: 'diagonal' }, y: { mode: 'start', offset: 0, size: 0 } },
          { id: 'c', x: { mode: 'both', start: 0 }, y: { mode: 'start', offset: 0, size: 0 } },
        ],
      }),
    );
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(paths(outcome.errors)).toEqual(['items[1].x.mode', 'items[2].x.end']);
  });

  it('rejects a non-Len offset', () => {
    const outcome = load(
      v1({
        items: [{ id: 'a', x: { mode: 'start', offset: 'left', size: 10 }, y: { mode: 'start', offset: 0, size: 0 } }],
      }),
    );
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(paths(outcome.errors)).toContain('items[0].x.offset');
  });

  it('requires a non-empty item id', () => {
    const outcome = load(
      v1({ items: [{ x: { mode: 'start', offset: 0, size: 0 }, y: { mode: 'start', offset: 0, size: 0 } }] }),
    );
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(paths(outcome.errors)).toContain('items[0].id');
  });
});

/* ------------------------------------------------------------------ */
/* repairs are warnings, not failures                                  */
/* ------------------------------------------------------------------ */

describe('load() repairs', () => {
  it('renames duplicate ids rather than failing the load', () => {
    const outcome = load(
      v1({
        items: [
          { id: 'a', x: { mode: 'start', offset: 0, size: 1 }, y: { mode: 'start', offset: 0, size: 1 }, z: 'a0' },
          { id: 'a', x: { mode: 'start', offset: 0, size: 2 }, y: { mode: 'start', offset: 0, size: 1 }, z: 'a1' },
          { id: 'a', x: { mode: 'start', offset: 0, size: 3 }, y: { mode: 'start', offset: 0, size: 1 }, z: 'a2' },
        ],
      }),
    );
    expect(outcome.status).toBe('ok');
    const doc = docOf(outcome);
    expect(doc.items.map((i) => i.id)).toEqual(['a', 'a-2', 'a-3']);
    if (outcome.status !== 'ok') return;
    // validate() flags the clash, normalize() reports the repair it made.
    const reports = outcome.issues.filter((i) => i.path === 'items[1].id');
    expect(reports).toHaveLength(2);
    expect(reports.map((i) => i.message)).toEqual([
      expect.stringContaining('duplicate id "a"'),
      expect.stringContaining('renamed to "a-2"'),
    ]);
    expect(outcome.issues.every((i) => i.severity === 'warn')).toBe(true);
  });

  it('confines a duplicate-id rename to the duplicated items', () => {
    const outcome = load(
      v1({
        items: [
          { id: 'a', x: { mode: 'start', offset: 0, size: 1 }, y: { mode: 'start', offset: 0, size: 1 }, z: 'a0' },
          { id: 'a', x: { mode: 'start', offset: 0, size: 2 }, y: { mode: 'start', offset: 0, size: 1 }, z: 'a1' },
          { id: 'a-2', x: { mode: 'start', offset: 0, size: 3 }, y: { mode: 'start', offset: 0, size: 1 }, z: 'a2' },
        ],
      }),
    );
    expect(outcome.status).toBe('ok');
    // The third item owns "a-2" legitimately: the repair steps over it instead
    // of taking the id and renaming its owner in turn.
    expect(docOf(outcome).items.map((i) => i.id)).toEqual(['a', 'a-3', 'a-2']);
  });

  it('drops invalid optional fields with a warning apiece', () => {
    const outcome = load(
      v1({
        items: [
          {
            id: 'a',
            x: { mode: 'start', offset: 0, size: 1 },
            y: { mode: 'start', offset: 0, size: 1 },
            z: 'a0',
            minW: -5,
            collision: 'push',
            locked: 'yes',
            tags: ['ok', 7],
          },
        ],
      }),
    );
    expect(outcome.status).toBe('ok');
    const item = docOf(outcome).items[0]!;
    expect(item.minW).toBeUndefined();
    expect(item.collision).toBeUndefined();
    expect(item.locked).toBeUndefined();
    expect(item.tags).toEqual(['ok']);
    if (outcome.status !== 'ok') return;
    expect(paths(outcome.issues)).toEqual(
      expect.arrayContaining([
        'items[0].minW',
        'items[0].collision',
        'items[0].locked',
        'items[0].tags',
      ]),
    );
  });

  it('parks unknown keys at the document and item level', () => {
    const outcome = load(
      v1({
        telemetry: { enabled: true },
        items: [
          {
            id: 'a',
            x: { mode: 'start', offset: 0, size: 1 },
            y: { mode: 'start', offset: 0, size: 1 },
            z: 'a0',
            sparkle: 'yes',
          },
        ],
      }),
    );
    expect(outcome.status).toBe('ok');
    const doc = docOf(outcome);
    expect(doc.$unknown).toEqual({ telemetry: { enabled: true } });
    expect(doc.items[0]!.$unknown).toEqual({ sparkle: 'yes' });
    // Parking is never an error (spec §1.13).
    if (outcome.status !== 'ok') return;
    expect(outcome.issues.every((i) => i.severity === 'warn')).toBe(true);
  });

  it('merges freshly parked keys with keys an earlier reader parked', () => {
    const outcome = load(v1({ fresh: 1, $unknown: { earlier: 2 } }));
    expect(docOf(outcome).$unknown).toEqual({ fresh: 1, earlier: 2 });
  });

  it('drops per-size z overrides (spec §1.23)', () => {
    const outcome = load(
      v1({
        items: [
          {
            id: 'a',
            x: { mode: 'start', offset: 0, size: 1 },
            y: { mode: 'start', offset: 0, size: 1 },
            z: 'a0',
            at: { md: { hidden: true, z: 'zz' } },
          },
        ],
      }),
    );
    expect(docOf(outcome).items[0]!.at).toEqual({ md: { hidden: true } });
    if (outcome.status !== 'ok') return;
    expect(outcome.issues.find((i) => i.path === 'items[0].at.md.z')?.message).toContain('forbidden');
  });
});

/* ------------------------------------------------------------------ */
/* damage inside an `at` override costs the override, not the document */
/* ------------------------------------------------------------------ */

describe('load() with a damaged size override', () => {
  const withOverride = (override: unknown, extra: Record<string, unknown> = {}) =>
    v1({
      ...extra,
      items: [
        {
          id: 'a',
          x: { mode: 'start', offset: 10, size: 100 },
          y: { mode: 'start', offset: 0, size: 80 },
          z: 'a0',
          at: { md: override },
        },
      ],
    });

  const damaged: [string, unknown][] = [
    ['a missing size term', { x: { mode: 'start', offset: 10 } }],
    ['an unknown axis mode', { x: { mode: 'nope', offset: 1, size: 1 } }],
    ['a placement that is not an object', { x: 'left' }],
    ['a non-Len offset', { y: { mode: 'start', offset: 'ten', size: 1 } }],
    ['a missing both-mode end', { x: { mode: 'both', start: 0 } }],
  ];

  for (const [name, override] of damaged) {
    it(`loads ok with ${name}, dropping the override`, () => {
      const outcome = load(withOverride(override));
      expect(outcome.status).toBe('ok');
      const item = docOf(outcome).items[0]!;
      // The base placement cascades through, exactly as if the override had
      // never been written.
      expect(item.x).toEqual({ mode: 'start', offset: 10, size: 100 });
      expect(item.at).toEqual({ md: {} });
      if (outcome.status !== 'ok') return;
      expect(outcome.issues.every((i) => i.severity === 'warn')).toBe(true);
      expect(paths(outcome.issues).some((p) => p.startsWith('items[0].at.md'))).toBe(true);
    });
  }

  it('still fails the document when the same damage is on the base placement', () => {
    const outcome = load(
      v1({ items: [{ id: 'a', x: { mode: 'start', offset: 10 }, y: { mode: 'start', offset: 0, size: 1 }, z: 'a0' }] }),
    );
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(paths(outcome.errors)).toContain('items[0].x.size');
  });

  it('degrades a future document whose new axis mode appears only in an override', () => {
    const outcome = load(
      withOverride({ x: { mode: 'orbital', offset: 0, size: 1 } }, { version: 2, compat: 1 }),
    );
    expect(outcome.status).toBe('forward-degraded');
  });
});

/* ------------------------------------------------------------------ */
/* validate() on its own                                               */
/* ------------------------------------------------------------------ */

describe('validate()', () => {
  it('returns no issues for a clean document', () => {
    expect(validate(v1())).toEqual([]);
  });

  it('warns (not errors) on unknown doc and item keys', () => {
    const issues = validate(v1({ future: 1 }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'warn', path: 'future' });
  });

  it('warns on an at-override naming an undeclared size', () => {
    const issues = validate(
      v1({
        items: [
          {
            id: 'a',
            x: { mode: 'start', offset: 0, size: 1 },
            y: { mode: 'start', offset: 0, size: 1 },
            z: 'a0',
            at: { phone: { hidden: true } },
          },
        ],
      }),
    );
    expect(issues.find((i) => i.path === 'items[0].at.phone')?.message).toContain('no size named');
  });

  it("warns that vertical anchors degrade under height:'auto' (spec §1.6)", () => {
    const issues = validate(
      v1({
        container: { base: { width: 800 } },
        items: [
          {
            id: 'a',
            x: { mode: 'start', offset: 0, size: 1 },
            y: { mode: 'end', offset: 0, size: 1 },
            z: 'a0',
          },
        ],
      }),
    );
    const issue = issues.find((i) => i.path === 'items[0].y.mode');
    expect(issue?.severity).toBe('warn');
    expect(issue?.message).toContain("height:'fill'");
  });

  it("accepts vertical anchors under height:'fill'", () => {
    const issues = validate(
      v1({
        container: { base: { width: 800, height: 600 }, height: 'fill' },
        items: [
          {
            id: 'a',
            x: { mode: 'start', offset: 0, size: 1 },
            y: { mode: 'center', offset: 0, size: 1 },
            z: 'a0',
          },
        ],
      }),
    );
    expect(issues).toEqual([]);
  });

  it('flags a non-document input as a single root error', () => {
    expect(validate(null)).toEqual([{ severity: 'error', path: '', message: expect.any(String) }]);
  });

  it('warns on fields a placement mode does not use', () => {
    const issues = validate(
      v1({
        items: [
          {
            id: 'a',
            x: { mode: 'start', offset: 0, size: 1, end: 5 },
            y: { mode: 'start', offset: 0, size: 1 },
            z: 'a0',
          },
        ],
      }),
    );
    expect(issues.find((i) => i.path === 'items[0].x.end')?.message).toContain("mode 'start'");
  });
});

/* ------------------------------------------------------------------ */
/* the load → serialize seam                                           */
/* ------------------------------------------------------------------ */

describe('load ∘ serialize', () => {
  it('round-trips a hand-written document through both directions', () => {
    const first = docOf(load(v1()));
    const text = serialize(first);
    const second = docOf(load(text));
    expect(second).toEqual(first);
    expect(serialize(second)).toBe(text);
  });

  it('keeps the writer version of a forward-degraded document', () => {
    const outcome = load(v1({ version: 2, compat: 1, moons: 3 }));
    const text = serialize(docOf(outcome));
    expect(JSON.parse(text)).toMatchObject({ version: 2, $unknown: { moons: 3 } });
    // Re-reading it degrades again rather than silently downgrading.
    expect(load(text).status).toBe('forward-degraded');
  });

  it('exposes the current schema version', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});
