import { describe, expect, it } from 'vitest';
import type { Migration, MigrationRegistry } from './migrate';
import { MIGRATIONS, checkRegistry, diffKeyPaths, migrate, planMigration } from './migrate';
import { load } from './load';
import { SCHEMA_VERSION } from './types';

/* ------------------------------------------------------------------ */
/* the shipped registry                                                */
/* ------------------------------------------------------------------ */

describe('migration registry', () => {
  it('is a contiguous chain ending at the current schema version', () => {
    expect(checkRegistry(MIGRATIONS, SCHEMA_VERSION)).toEqual([]);
  });

  it('is empty at v1 — there is nothing older to read', () => {
    expect(MIGRATIONS).toHaveLength(0);
    expect(planMigration(0, 1, MIGRATIONS)).toBeNull();
  });

  it('rejects an empty registry once the schema has moved past v1', () => {
    expect(checkRegistry([], 1)).toEqual([]);
    expect(checkRegistry([], 2)).toEqual([expect.stringContaining('registry is empty')]);
    expect(checkRegistry([], 7)).toEqual([expect.stringContaining('v7')]);
  });

  it('does not invent a version when no step is usable', () => {
    const problems = checkRegistry([{ from: 1.5, to: 2.5, up: (d) => d }], 2);
    expect(problems.some((p) => p.includes('NaN'))).toBe(false);
    expect(problems).toEqual(
      expect.arrayContaining([expect.stringContaining('must be integers')]),
    );
    expect(problems.length).toBeGreaterThan(1);
  });

  it('rejects a chain with a hole', () => {
    const broken: MigrationRegistry = [
      { from: 1, to: 2, up: (d) => d },
      { from: 3, to: 4, up: (d) => d },
    ];
    expect(checkRegistry(broken, 4)).toEqual(
      expect.arrayContaining([expect.stringContaining('missing migration from version 2')]),
    );
  });

  it('rejects a multi-version leap and a duplicate source version', () => {
    expect(checkRegistry([{ from: 1, to: 3, up: (d) => d }], 3)).toEqual(
      expect.arrayContaining([expect.stringContaining('advance exactly one version')]),
    );
    expect(
      checkRegistry(
        [
          { from: 1, to: 2, up: (d) => d },
          { from: 1, to: 2, up: (d) => d },
        ],
        2,
      ),
    ).toEqual(expect.arrayContaining([expect.stringContaining('duplicate migration')]));
  });

  it('rejects a chain that stops short of the current version', () => {
    expect(checkRegistry([{ from: 1, to: 2, up: (d) => d }], 3)).toEqual(
      expect.arrayContaining([expect.stringContaining('chain ends at v2')]),
    );
  });

  it('plans a multi-step chain in order', () => {
    const registry: MigrationRegistry = [
      { from: 2, to: 3, up: (d) => d },
      { from: 1, to: 2, up: (d) => d },
    ];
    expect(planMigration(1, 3, registry)?.map((m) => `${m.from}->${m.to}`)).toEqual(['1->2', '2->3']);
    expect(planMigration(3, 3, registry)).toEqual([]);
    expect(planMigration(3, 1, registry)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* synthetic v0 → v1 fixture                                           */
/* ------------------------------------------------------------------ */

/**
 * A stand-in for the first real migration. v0 is imagined as a grid-flavored
 * schema: `col`/`row` cells and a `legacyFlag` that v1 has no home for.
 */
const V0_TO_V1: Migration = {
  from: 0,
  to: 1,
  describe: 'grid cells became affine placements',
  up(raw, ctx) {
    const items = Array.isArray(raw.items) ? raw.items : [];
    ctx.report({ severity: 'warn', path: 'gridGap', message: 'gaps are an interaction concern in v1' });
    return {
      version: 1,
      container: { base: { width: 1200 } },
      items: items.map((entry) => {
        const cell = entry as Record<string, unknown>;
        return {
          id: cell.id,
          x: { mode: 'start', offset: (cell.col as number) * 100, size: 100 },
          y: { mode: 'start', offset: (cell.row as number) * 80, size: 80 },
        };
      }),
    };
  },
};

const V0_DOC = {
  version: 0,
  gridGap: 12,
  items: [
    { id: 'a', col: 0, row: 0, legacyFlag: true },
    { id: 'b', col: 2, row: 1, legacyFlag: false },
  ],
};

describe('migrate() pipeline', () => {
  const registry: MigrationRegistry = [V0_TO_V1];

  it('runs the chain and reports the source version', () => {
    const outcome = migrate(V0_DOC, registry);
    expect(outcome.status).toBe('migrated');
    if (outcome.status !== 'migrated') return;
    expect(outcome.from).toBe(0);
    expect(outcome.doc.version).toBe(SCHEMA_VERSION);
    expect(outcome.doc.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(outcome.doc.items[1]!.x).toEqual({ mode: 'start', offset: 200, size: 100 });
  });

  it('law L5: every dropped field is reported with a path', () => {
    const outcome = migrate(V0_DOC, registry);
    if (outcome.status !== 'migrated') throw new Error('expected a migration');
    const reported = new Set(outcome.issues.map((i) => i.path));
    // Every path the key-set diff says vanished must appear in `issues` — the
    // runner enforces the law so an individual migration cannot forget it.
    const dropped = diffKeyPaths(V0_DOC, {
      version: 1,
      container: { base: { width: 1200 } },
      items: [
        { id: 'a', x: {}, y: {} },
        { id: 'b', x: {}, y: {} },
      ],
    }).filter((p) => p !== 'version');
    expect(dropped.length).toBeGreaterThan(0);
    for (const path of dropped) expect(reported.has(path)).toBe(true);

    // Fields the migration silently dropped are auto-reported by the runner.
    expect(reported.has('items[0].legacyFlag')).toBe(true);
    expect(reported.has('items[1].legacyFlag')).toBe(true);
    expect(reported.has('items[0].col')).toBe(true);
    expect(reported.has('items[0].row')).toBe(true);
    // And a field the migration reported itself is not double-reported.
    expect(outcome.issues.filter((i) => i.path === 'gridGap')).toHaveLength(1);
  });

  it('does not report the version bump as a dropped field', () => {
    const outcome = migrate(V0_DOC, registry);
    if (outcome.status !== 'migrated') throw new Error('expected a migration');
    expect(outcome.issues.some((i) => i.path === 'version')).toBe(false);
  });

  it('says when the drop audit stopped short of the bottom of a payload', () => {
    const deep: MigrationRegistry = [
      {
        from: 0,
        to: 1,
        up: (raw) => ({
          ...raw,
          items: (raw.items as Record<string, unknown>[]).map((item) => ({
            ...item,
            data: nest(15, { keep: 1 }),
          })),
        }),
      },
    ];
    const outcome = migrate(
      {
        version: 0,
        container: { base: { width: 100 } },
        items: [
          {
            id: 'a',
            x: { mode: 'start', offset: 0, size: 1 },
            y: { mode: 'start', offset: 0, size: 1 },
            data: nest(15, { keep: 1, drop: 2 }),
          },
        ],
      },
      deep,
    );
    expect(outcome.status).toBe('migrated');
    if (outcome.status !== 'migrated') return;
    const truncated = outcome.issues.find((i) => i.path.endsWith('…'));
    expect(truncated?.severity).toBe('warn');
    expect(truncated?.message).toContain('are not reported');
  });

  it('surfaces the fixture through load() when the registry is supplied', () => {
    expect(load(V0_DOC, registry).status).toBe('migrated');
    expect(load(V0_DOC).status).toBe('invalid');
  });

  it('reports a migration that returns garbage as invalid instead of throwing', () => {
    const bad: MigrationRegistry = [{ from: 0, to: 1, up: () => null as unknown as Record<string, unknown> }];
    expect(migrate(V0_DOC, bad).status).toBe('invalid');
  });

  it('reports a throwing migration as invalid', () => {
    const boom: MigrationRegistry = [
      {
        from: 0,
        to: 1,
        up: () => {
          throw new Error('kaboom');
        },
      },
    ];
    const outcome = migrate(V0_DOC, boom);
    expect(outcome.status).toBe('invalid');
    if (outcome.status !== 'invalid') return;
    expect(outcome.errors[0]!.message).toContain('kaboom');
  });

  it('returns ok for a document already at the current version', () => {
    const outcome = migrate({ version: 1, container: { base: { width: 10 } }, items: [] });
    expect(outcome.status).toBe('ok');
  });

  it('refuses to run backwards', () => {
    const outcome = migrate({ version: 5, container: { base: { width: 10 } }, items: [] });
    expect(outcome.status).toBe('incompatible');
  });
});

/* ------------------------------------------------------------------ */
/* diffKeyPaths                                                        */
/* ------------------------------------------------------------------ */

describe('diffKeyPaths()', () => {
  it('finds dropped keys at every depth', () => {
    expect(
      diffKeyPaths({ a: 1, b: { c: 2, d: 3 }, e: [{ f: 4 }] }, { b: { c: 2 }, e: [{}] }),
    ).toEqual(['a', 'b.d', 'e[0].f']);
  });

  it('reports a shortened array', () => {
    expect(diffKeyPaths({ xs: [1, 2, 3] }, { xs: [1] })).toEqual(['xs[1]', 'xs[2]']);
  });

  it('reports a container whose type changed as a whole-subtree drop', () => {
    expect(diffKeyPaths({ a: { b: 1 } }, { a: 5 })).toEqual(['a']);
    expect(diffKeyPaths({ a: [1] }, { a: {} })).toEqual(['a']);
  });

  it('finds nothing when nothing was dropped', () => {
    expect(diffKeyPaths({ a: 1 }, { a: 1, extra: 2 })).toEqual([]);
  });

  it('is depth-limited so it cannot hang on a deep or cyclic payload', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => diffKeyPaths(cyclic, {})).not.toThrow();
  });

  it('marks the subtree it stopped walking instead of reporting nothing', () => {
    const paths = diffKeyPaths({ data: nest(15, { keep: 1, drop: 2 }) }, { data: nest(15, { keep: 1 }) });
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/…$/);
    expect(paths[0]).toMatch(/^data\./);
  });

  it('does not mark a subtree it walked to the bottom', () => {
    expect(diffKeyPaths({ data: nest(3, { keep: 1, drop: 2 }) }, { data: nest(3, { keep: 1 }) })).toEqual([
      'data.a.a.a.drop',
    ]);
  });

  it('does not mark a subtree both documents share by reference', () => {
    const shared = nest(15, { keep: 1 });
    expect(diffKeyPaths({ data: shared }, { data: shared })).toEqual([]);
  });
});

/** `{ a: { a: { … leaf } } }`, `depth` levels of nesting above `leaf`. */
function nest(depth: number, leaf: Record<string, unknown>): Record<string, unknown> {
  let node: Record<string, unknown> = leaf;
  for (let i = 0; i < depth; i++) node = { a: node };
  return node;
}
