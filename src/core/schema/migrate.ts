/**
 * Schema migration pipeline.
 *
 * The registry is a list of single-step upgrades keyed `from → to`. v1 is the
 * current writer version, so the shipped registry is EMPTY — the machinery
 * exists from day one so that adding v2 is a data change, not a redesign, and
 * so law L5 (every field a migration drops is reported with a path) is
 * enforced by the runner rather than by each migration's diligence.
 *
 * Standalone and React-free: this file is part of the `vizbrix/schema` entry.
 */

import type { Issue, LoadOutcome } from './types';
import { SCHEMA_VERSION } from './types';
import { validate } from './validate';
import { normalize } from './normalize';
import { isFiniteNumber, isPlainObject, issueError, issueWarn, parseInput } from './internal';

/** Reporting channel handed to a migration step. */
export interface MigrationContext {
  /** Report a field the step deliberately drops, renames or reinterprets. */
  report(issue: Issue): void;
}

/**
 * One contiguous upgrade step. `up` receives the raw document (never a typed
 * `LayoutDoc` — the input predates the current types) and returns the raw
 * document at version `to`.
 */
export interface Migration {
  from: number;
  to: number;
  /** Short human description, used in auto-generated drop reports. */
  describe?: string;
  up(doc: Record<string, unknown>, ctx: MigrationContext): Record<string, unknown>;
}

export type MigrationRegistry = readonly Migration[];

/**
 * The shipped registry. Empty because v1 is current: any document with
 * `version < 1` has no upgrade path and loads as `invalid`.
 */
export const MIGRATIONS: MigrationRegistry = [];

/* ------------------------------------------------------------------ */
/* Registry integrity                                                  */
/* ------------------------------------------------------------------ */

/**
 * Checks that a registry forms a contiguous single-step chain ending at
 * `target`. Asserted by a test (and therefore in CI) so a missing step can
 * never ship.
 *
 * @returns a list of human-readable problems; empty means the chain is sound.
 */
export function checkRegistry(
  registry: MigrationRegistry = MIGRATIONS,
  target: number = SCHEMA_VERSION,
): string[] {
  const problems: string[] = [];
  if (registry.length === 0) return problems;

  const seen = new Set<number>();
  for (const m of registry) {
    if (!Number.isInteger(m.from) || !Number.isInteger(m.to)) {
      problems.push(`migration ${m.from}→${m.to}: versions must be integers`);
      continue;
    }
    if (m.to !== m.from + 1) {
      problems.push(`migration ${m.from}→${m.to}: steps must advance exactly one version`);
    }
    if (seen.has(m.from)) {
      problems.push(`duplicate migration from version ${m.from}`);
    }
    seen.add(m.from);
  }

  const froms = [...seen].sort((a, b) => a - b);
  const lowest = froms[0]!;
  for (let v = lowest; v < target; v++) {
    if (!seen.has(v)) problems.push(`missing migration from version ${v} (chain must reach v${target})`);
  }
  const highest = froms[froms.length - 1]!;
  if (highest + 1 !== target) {
    problems.push(`chain ends at v${highest + 1} but the current schema is v${target}`);
  }
  return problems;
}

/**
 * Builds the ordered list of steps taking `from` to `to`.
 *
 * @returns the steps, or `null` when no path exists (including `from > to` —
 * migrations only run forward).
 */
export function planMigration(
  from: number,
  to: number,
  registry: MigrationRegistry = MIGRATIONS,
): Migration[] | null {
  if (from === to) return [];
  if (from > to) return null;
  const byFrom = new Map<number, Migration>();
  for (const m of registry) if (!byFrom.has(m.from)) byFrom.set(m.from, m);

  const plan: Migration[] = [];
  let cursor = from;
  while (cursor < to) {
    const step = byFrom.get(cursor);
    if (!step || step.to <= cursor) return null;
    plan.push(step);
    cursor = step.to;
  }
  return cursor === to ? plan : null;
}

/* ------------------------------------------------------------------ */
/* Law L5 — key-set diff                                               */
/* ------------------------------------------------------------------ */

const MAX_DIFF_DEPTH = 12;

/**
 * Key-set diff used to enforce law L5: every field present in `before` but
 * absent from `after` must surface as an {@link Issue} with a path.
 *
 * Walks plain objects and arrays only (opaque leaves are compared by
 * presence, not by value) and is depth-limited, so a cyclic or pathological
 * payload cannot hang the loader.
 *
 * @returns dropped paths in the `items[0].x.offset` form, sorted.
 */
export function diffKeyPaths(before: unknown, after: unknown, base = ''): string[] {
  const dropped: string[] = [];
  walk(before, after, base, 0, dropped);
  dropped.sort();
  return dropped;
}

function walk(before: unknown, after: unknown, path: string, depth: number, out: string[]): void {
  if (depth > MAX_DIFF_DEPTH) return;

  if (Array.isArray(before)) {
    if (!Array.isArray(after)) {
      if (path !== '') out.push(path);
      return;
    }
    for (let i = 0; i < before.length; i++) {
      const child = `${path}[${i}]`;
      if (i >= after.length) out.push(child);
      else walk(before[i], after[i], child, depth + 1, out);
    }
    return;
  }

  if (isPlainObject(before)) {
    if (!isPlainObject(after)) {
      if (path !== '') out.push(path);
      return;
    }
    for (const key of Object.keys(before)) {
      if (before[key] === undefined) continue;
      const child = path === '' ? key : `${path}.${key}`;
      if (after[key] === undefined) out.push(child);
      else walk(before[key], after[key], child, depth + 1, out);
    }
    return;
  }

  // Opaque leaf: presence-only comparison, already handled by the caller.
}

/* ------------------------------------------------------------------ */
/* migrate                                                             */
/* ------------------------------------------------------------------ */

/**
 * Upgrades a document to the current schema version and finishes it through
 * `validate` + `normalize`. Never throws.
 *
 * Version dispatch:
 * - `< SCHEMA_VERSION` → run the registry chain → `migrated` (or `invalid`
 *   when no chain exists, which is every case while the registry is empty).
 * - `=== SCHEMA_VERSION` → `ok` / `invalid`.
 * - `> SCHEMA_VERSION` → `incompatible`. Migrations only run forward; the
 *   forward-compat *degradation* path lives in `load()`, which dispatches on
 *   `compat` before ever calling here.
 *
 * @param registry override for tests and for embedding an app's own steps.
 */
export function migrate<TData = undefined>(
  input: unknown,
  registry: MigrationRegistry = MIGRATIONS,
): LoadOutcome<TData> {
  try {
    const { value, parseError } = parseInput(input);
    if (parseError !== undefined) {
      return { status: 'invalid', errors: [issueError('', `not valid JSON: ${parseError}`)] };
    }
    if (!isPlainObject(value)) {
      return {
        status: 'invalid',
        errors: [issueError('', 'expected a layout document object')],
      };
    }

    const version = value.version;
    if (!isFiniteNumber(version) || !Number.isInteger(version)) {
      return {
        status: 'invalid',
        errors: [issueError('version', 'expected an integer schema version')],
      };
    }

    if (version > SCHEMA_VERSION) {
      const compat = isFiniteNumber(value.compat) ? value.compat : 1;
      return {
        status: 'incompatible',
        reason: `document is version ${version}; migrations only run forward and this reader writes v${SCHEMA_VERSION}`,
        compat,
      };
    }

    const issues: Issue[] = [];
    let raw = value;

    if (version < SCHEMA_VERSION) {
      const plan = planMigration(version, SCHEMA_VERSION, registry);
      if (plan === null) {
        return {
          status: 'invalid',
          errors: [
            issueError(
              'version',
              `no migration path from version ${version} to ${SCHEMA_VERSION}`,
            ),
          ],
        };
      }
      raw = runChain(raw, plan, issues);
    }

    const found = validate(raw);
    const errors = found.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      return { status: 'invalid', errors: [...issues.filter((i) => i.severity === 'error'), ...errors] };
    }
    issues.push(...found);
    const doc = normalize<TData>(raw, issues);

    return version < SCHEMA_VERSION
      ? { status: 'migrated', doc, from: version, issues }
      : { status: 'ok', doc, issues };
  } catch (e) {
    return {
      status: 'invalid',
      errors: [issueError('', `migration failed: ${e instanceof Error ? e.message : String(e)}`)],
    };
  }
}

/**
 * Runs the plan, stamping the version after each step and auto-reporting any
 * key the step dropped without reporting it itself. This is what makes L5 a
 * property of the pipeline instead of a convention each migration must honor.
 */
function runChain(
  raw: Record<string, unknown>,
  plan: readonly Migration[],
  issues: Issue[],
): Record<string, unknown> {
  let current = raw;
  for (const step of plan) {
    const reported: Issue[] = [];
    const next = step.up(current, { report: (issue) => reported.push(issue) });
    if (!isPlainObject(next)) {
      throw new Error(`migration v${step.from}→v${step.to} did not return a document object`);
    }
    const reportedPaths = new Set(reported.map((i) => i.path));
    issues.push(...reported);
    for (const path of diffKeyPaths(current, next)) {
      if (path === 'version' || reportedPaths.has(path)) continue;
      issues.push(
        issueWarn(
          path,
          `dropped by migration v${step.from}→v${step.to}${step.describe ? ` (${step.describe})` : ''}`,
        ),
      );
    }
    current = { ...next, version: step.to };
  }
  return current;
}
