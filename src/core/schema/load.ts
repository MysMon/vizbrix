/**
 * The persistence boundary. `load()` is the only function a consumer needs to
 * turn untrusted bytes into a document the engine can render — and it NEVER
 * throws, for any input at all: JSON strings, objects, `null`, arrays,
 * numbers, cyclic structures, documents from the future.
 *
 * Every failure mode is an arm of {@link LoadOutcome}, so the caller writes a
 * `switch` instead of a `try`.
 */

import type { AxisMode, Issue, LayoutDoc, LoadOutcome } from './types';
import { SCHEMA_VERSION } from './types';
import { validate } from './validate';
import { normalize } from './normalize';
import { migrate } from './migrate';
import type { MigrationRegistry } from './migrate';
import {
  AXIS_MODES,
  BASE_KEYS,
  CONTAINER_KEYS,
  DOC_KEYS,
  ITEM_KEYS,
  LEN_KEYS,
  OVERRIDE_KEYS,
  SIZE_KEYS,
  indexPath,
  isFiniteNumber,
  isPlainObject,
  issueError,
  parseInput,
  placementFields,
  unknownKeysOf,
} from './internal';

const MODE_SET = new Set<string>(AXIS_MODES);

/**
 * Reads a persisted layout.
 *
 * Dispatch on `version`:
 * - `< SCHEMA_VERSION` → the migration chain runs (`migrated`), or `invalid`
 *   when no path exists. With the v1 registry empty, every sub-v1 document is
 *   `invalid`.
 * - `=== SCHEMA_VERSION` → validate, then normalize → `ok`. Structural errors
 *   yield `invalid`; repairs and parked unknown keys yield `ok` with warnings.
 * - `> SCHEMA_VERSION` → the writer's `compat` floor decides. `compat >
 *   SCHEMA_VERSION` means the writer says this reader cannot render the
 *   document faithfully → `incompatible`. Otherwise the document is read with
 *   v1 semantics, everything this reader does not understand is parked in
 *   `$unknown` and listed in `ignored` → `forward-degraded`.
 *
 * A forward-degraded document keeps its original `version` and `compat` so
 * that `serialize()` writes the future document back verbatim rather than
 * silently downgrading it.
 *
 * @param input a JSON string or an already-parsed value.
 * @param registry migration registry override (tests, app-specific steps).
 */
export function load<TData = undefined>(
  input: unknown,
  registry?: MigrationRegistry,
): LoadOutcome<TData> {
  try {
    const { value, parseError } = parseInput(input);
    if (parseError !== undefined) {
      return { status: 'invalid', errors: [issueError('', `not valid JSON: ${parseError}`)] };
    }
    if (!isPlainObject(value)) {
      return {
        status: 'invalid',
        errors: [
          issueError('', `expected a layout document object, received ${describeInput(value)}`),
        ],
      };
    }

    const version = value.version;
    if (!isFiniteNumber(version) || !Number.isInteger(version)) {
      return {
        status: 'invalid',
        errors: [
          issueError(
            'version',
            version === undefined
              ? 'required: a persisted layout must declare its schema version'
              : 'expected an integer schema version',
          ),
        ],
      };
    }

    if (version > SCHEMA_VERSION) return forwardDegrade<TData>(value, version);

    return migrate<TData>(value, registry);
  } catch (e) {
    return {
      status: 'invalid',
      errors: [issueError('', `load failed: ${e instanceof Error ? e.message : String(e)}`)],
    };
  }
}

/* ------------------------------------------------------------------ */
/* forward compatibility                                               */
/* ------------------------------------------------------------------ */

function forwardDegrade<TData>(
  raw: Record<string, unknown>,
  version: number,
): LoadOutcome<TData> {
  const compat = isFiniteNumber(raw.compat) && Number.isInteger(raw.compat) ? raw.compat : 1;
  if (compat > SCHEMA_VERSION) {
    return {
      status: 'incompatible',
      reason:
        `document version ${version} declares a reader floor of v${compat}; ` +
        `this build reads v${SCHEMA_VERSION}. Upgrade vizbrix to open it.`,
      compat,
    };
  }

  const found = validate(raw);
  const errors = found.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    // The writer promised a v1-readable core (compat ≤ 1) and did not deliver.
    return { status: 'invalid', errors };
  }

  const issues: Issue[] = [...found];
  const doc = normalize<TData>(raw, issues);
  return { status: 'forward-degraded', doc, ignored: collectIgnoredPaths(raw), issues };
}

/**
 * Paths this reader does not understand, in document order. Everything listed
 * here is parked in `$unknown` (document and item level) or dropped, and is
 * re-emitted verbatim by `serialize()` when it was parkable.
 *
 * The walk covers every level at which `normalize` discards an unrecognized
 * key — not only the document, item and container roots but `container.base`,
 * each declared size, both placements of an item and of each of its size
 * overrides, and the `Len` terms inside them. A caller that gates a write-back
 * on `ignored` is deciding whether saving would destroy a newer writer's data,
 * so a path missing here is a false all-clear.
 */
function collectIgnoredPaths(raw: Record<string, unknown>): string[] {
  const ignored: string[] = [];
  for (const key of unknownKeysOf(raw, DOC_KEYS)) ignored.push(key);

  if (Array.isArray(raw.items)) {
    for (let i = 0; i < raw.items.length; i++) {
      const item: unknown = raw.items[i];
      if (!isPlainObject(item)) continue;
      const path = indexPath('items', i);
      for (const key of unknownKeysOf(item, ITEM_KEYS)) ignored.push(`${path}.${key}`);
      collectPlacement(item.x, `${path}.x`, ignored);
      collectPlacement(item.y, `${path}.y`, ignored);
      if (isPlainObject(item.at)) {
        for (const name of Object.keys(item.at)) {
          const override: unknown = item.at[name];
          if (!isPlainObject(override)) continue;
          const p = `${path}.at.${name}`;
          for (const key of unknownKeysOf(override, OVERRIDE_KEYS)) ignored.push(`${p}.${key}`);
          collectPlacement(override.x, `${p}.x`, ignored);
          collectPlacement(override.y, `${p}.y`, ignored);
        }
      }
    }
  }

  if (isPlainObject(raw.container)) {
    const container = raw.container;
    for (const key of unknownKeysOf(container, CONTAINER_KEYS)) {
      ignored.push(`container.${key}`);
    }
    if (isPlainObject(container.base)) {
      for (const key of unknownKeysOf(container.base, BASE_KEYS)) {
        ignored.push(`container.base.${key}`);
      }
    }
    if (isPlainObject(container.sizes)) {
      for (const name of Object.keys(container.sizes)) {
        const def: unknown = container.sizes[name];
        if (!isPlainObject(def)) continue;
        for (const key of unknownKeysOf(def, SIZE_KEYS)) {
          ignored.push(`container.sizes.${name}.${key}`);
        }
      }
    }
  }

  return ignored;
}

/**
 * Adds the parts of one placement this reader drops: an axis mode it has never
 * heard of (the whole placement goes), the fields that mode does not use, and
 * unknown keys inside each `Len` term.
 */
function collectPlacement(value: unknown, path: string, ignored: string[]): void {
  if (!isPlainObject(value)) return;
  const mode = value.mode;
  if (typeof mode !== 'string' || !MODE_SET.has(mode)) {
    ignored.push(path);
    return;
  }
  const fields = placementFields(mode as AxisMode);
  for (const key of unknownKeysOf(value, ['mode', ...fields])) ignored.push(`${path}.${key}`);
  for (const field of fields) {
    const term: unknown = value[field];
    if (!isPlainObject(term)) continue;
    for (const key of unknownKeysOf(term, LEN_KEYS)) ignored.push(`${path}.${field}.${key}`);
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Narrows a {@link LoadOutcome} to the arms that carry a document, so callers
 * can write `if (isLoaded(outcome)) render(outcome.doc)`.
 */
export function isLoaded<TData>(
  outcome: LoadOutcome<TData>,
): outcome is Extract<LoadOutcome<TData>, { doc: LayoutDoc<TData> }> {
  return (
    outcome.status === 'ok' ||
    outcome.status === 'migrated' ||
    outcome.status === 'forward-degraded'
  );
}

function describeInput(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}
