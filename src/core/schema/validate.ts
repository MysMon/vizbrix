/**
 * Structural validation for persisted layout documents.
 *
 * `validate()` is a pure reporter: it never mutates, never throws and never
 * decides policy. It answers one question — "which parts of this input does a
 * v1 reader not understand?" — as a flat list of {@link Issue}s carrying JSON
 * access paths (`items[3].x.offset`; the document itself is `''`).
 *
 * Severity contract:
 * - `error` — the document cannot be read faithfully. `load()` turns any error
 *   into `{ status: 'invalid' }`.
 * - `warn`  — the document is readable but something was repaired, degraded or
 *   parked. Unknown keys at the document and item level are ALWAYS warnings,
 *   never errors: they park in `$unknown` and round-trip verbatim (spec §1.13).
 */

import type { AxisMode, Issue } from './types';
import {
  AXIS_MODES,
  COLLISION_POLICIES,
  CONTAINER_KEYS,
  DOC_KEYS,
  ITEM_KEYS,
  OVERRIDE_KEYS,
  hasOwn,
  indexPath,
  isFiniteNumber,
  isNonEmptyString,
  isPlainObject,
  issueError,
  issueWarn,
  modeNeedsDefiniteExtent,
  placementFields,
  unknownKeysOf,
} from './internal';

const MODE_SET = new Set<string>(AXIS_MODES);
const COLLISION_SET = new Set<string>(COLLISION_POLICIES);

/**
 * Validates any input against the v1 schema.
 *
 * @returns every issue found, in document order. An empty array means the
 * input is a clean v1 document. Callers decide policy by filtering on
 * `severity === 'error'`.
 */
export function validate(input: unknown): Issue[] {
  const out: Issue[] = [];

  if (!isPlainObject(input)) {
    out.push(
      issueError('', `expected a layout document object, received ${describe(input)}`),
    );
    return out;
  }

  checkVersion(input, out);
  const container = checkContainer(input.container, out);
  checkItems(input.items, container, out);

  for (const key of unknownKeysOf(input, DOC_KEYS)) {
    out.push(issueWarn(key, 'unknown document key; parked in $unknown and re-emitted verbatim'));
  }
  if (hasOwn(input, '$unknown') && input.$unknown !== undefined && !isPlainObject(input.$unknown)) {
    out.push(issueWarn('$unknown', 'expected an object; it will be dropped'));
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* version / compat                                                    */
/* ------------------------------------------------------------------ */

function checkVersion(doc: Record<string, unknown>, out: Issue[]): void {
  const { version, compat } = doc;
  if (version === undefined) {
    out.push(issueError('version', 'required'));
  } else if (!isFiniteNumber(version) || !Number.isInteger(version) || version < 1) {
    out.push(issueError('version', `expected an integer ≥ 1, received ${describe(version)}`));
  }

  if (compat === undefined) return;
  if (!isFiniteNumber(compat) || !Number.isInteger(compat) || compat < 1) {
    out.push(issueError('compat', `expected an integer ≥ 1, received ${describe(compat)}`));
    return;
  }
  if (isFiniteNumber(version) && compat > version) {
    out.push(
      issueWarn('compat', `reader floor ${compat} exceeds the writer version ${version}`),
    );
  }
}

/* ------------------------------------------------------------------ */
/* container                                                           */
/* ------------------------------------------------------------------ */

interface ContainerFacts {
  /** True when vertical `end|both|center|scale` are resolvable (spec §1.6). */
  fillHeight: boolean;
  sizeNames: Set<string>;
}

function checkContainer(value: unknown, out: Issue[]): ContainerFacts {
  const facts: ContainerFacts = { fillHeight: false, sizeNames: new Set() };

  if (value === undefined) {
    out.push(issueError('container', 'required'));
    return facts;
  }
  if (!isPlainObject(value)) {
    out.push(issueError('container', `expected an object, received ${describe(value)}`));
    return facts;
  }

  const base = value.base;
  if (!isPlainObject(base)) {
    out.push(issueError('container.base', `expected an object, received ${describe(base)}`));
  } else {
    if (!isFiniteNumber(base.width) || base.width <= 0) {
      out.push(
        issueError(
          'container.base.width',
          `required: the base design width fixes px meaning, tier-3 order and server rects (received ${describe(base.width)})`,
        ),
      );
    }
    if (base.height !== undefined && (!isFiniteNumber(base.height) || base.height <= 0)) {
      out.push(
        issueWarn(
          'container.base.height',
          `expected a positive number, received ${describe(base.height)}; it will be dropped`,
        ),
      );
    }
    for (const key of unknownKeysOf(base, ['width', 'height'])) {
      out.push(issueWarn(`container.base.${key}`, 'unknown key; it will be dropped'));
    }
  }

  facts.fillHeight = value.height === 'fill';
  checkEnum(value.height, ['auto', 'fill'], 'container.height', out);
  checkEnum(value.responsive, ['reflow', 'scale'], 'container.responsive', out);
  checkEnum(value.direction, ['ltr', 'rtl'], 'container.direction', out);

  if (value.stackBelow !== undefined && (!isFiniteNumber(value.stackBelow) || value.stackBelow < 0)) {
    out.push(
      issueWarn(
        'container.stackBelow',
        `expected a number ≥ 0, received ${describe(value.stackBelow)}; it will be dropped`,
      ),
    );
  }

  if (value.sizes !== undefined) {
    if (!isPlainObject(value.sizes)) {
      out.push(
        issueWarn('container.sizes', `expected an object, received ${describe(value.sizes)}; it will be dropped`),
      );
    } else {
      const byMaxWidth = new Map<number, string>();
      for (const name of Object.keys(value.sizes)) {
        const path = `container.sizes.${name}`;
        const def = (value.sizes as Record<string, unknown>)[name];
        if (name === '') {
          out.push(issueWarn(path, 'empty size name; it will be dropped'));
          continue;
        }
        if (!isPlainObject(def) || !isFiniteNumber(def.maxWidth) || def.maxWidth <= 0) {
          out.push(
            issueWarn(
              `${path}.maxWidth`,
              `expected a positive number, received ${describe(isPlainObject(def) ? def.maxWidth : def)}; the size will be dropped`,
            ),
          );
          continue;
        }
        facts.sizeNames.add(name);
        const clash = byMaxWidth.get(def.maxWidth);
        if (clash !== undefined) {
          out.push(
            issueWarn(
              `${path}.maxWidth`,
              `duplicates size "${clash}" (maxWidth ${def.maxWidth}); cascade order between them is by name`,
            ),
          );
        } else {
          byMaxWidth.set(def.maxWidth, name);
        }
        for (const key of unknownKeysOf(def, ['maxWidth'])) {
          out.push(issueWarn(`${path}.${key}`, 'unknown key; it will be dropped'));
        }
      }
    }
  }

  for (const key of unknownKeysOf(value, CONTAINER_KEYS)) {
    out.push(issueWarn(`container.${key}`, 'unknown key; it will be dropped'));
  }

  return facts;
}

/* ------------------------------------------------------------------ */
/* items                                                               */
/* ------------------------------------------------------------------ */

function checkItems(value: unknown, container: ContainerFacts, out: Issue[]): void {
  if (value === undefined) {
    out.push(issueError('items', 'required'));
    return;
  }
  if (!Array.isArray(value)) {
    out.push(issueError('items', `expected an array, received ${describe(value)}`));
    return;
  }

  const seenIds = new Set<string>();
  const seenKeys = new Map<string, string>();

  for (let i = 0; i < value.length; i++) {
    const path = indexPath('items', i);
    const item: unknown = value[i];
    if (!isPlainObject(item)) {
      out.push(issueError(path, `expected an object, received ${describe(item)}`));
      continue;
    }

    if (!isNonEmptyString(item.id)) {
      out.push(
        issueError(`${path}.id`, `expected a non-empty string, received ${describe(item.id)}`),
      );
    } else if (seenIds.has(item.id)) {
      // Not an error: normalize() de-duplicates with a suffix so that a
      // damaged document still loads (spec §12). defineLayout() — the
      // authoring-time entry — throws instead.
      out.push(issueWarn(`${path}.id`, `duplicate id "${item.id}"; it will be renamed on normalize`));
    } else {
      seenIds.add(item.id);
    }

    checkPlacement(item.x, `${path}.x`, false, container, out);
    checkPlacement(item.y, `${path}.y`, true, container, out);

    if (item.z !== undefined) {
      if (!isNonEmptyString(item.z)) {
        out.push(
          issueWarn(`${path}.z`, `expected a non-empty string, received ${describe(item.z)}; a key will be generated`),
        );
      } else {
        // Deliberately NOT checked against the fractional-key alphabet: order
        // is lexicographic, so any non-empty string is a legal key. Which keys
        // a generator considers canonical is that generator's business, and
        // warning about it here would fire on every hand-written document.
        const clash = seenKeys.get(item.z);
        if (clash !== undefined) {
          out.push(
            issueWarn(`${path}.z`, `duplicate z key "${item.z}" (also on "${clash}"); order between them falls back to id`),
          );
        } else if (isNonEmptyString(item.id)) {
          seenKeys.set(item.z, item.id);
        }
      }
    }

    for (const key of ['minW', 'minH', 'maxW', 'maxH'] as const) {
      checkNonNegative(item[key], `${path}.${key}`, out);
    }
    if (isFiniteNumber(item.minW) && isFiniteNumber(item.maxW) && item.minW > item.maxW) {
      out.push(issueWarn(`${path}.minW`, `minW ${item.minW} exceeds maxW ${item.maxW}`));
    }
    if (isFiniteNumber(item.minH) && isFiniteNumber(item.maxH) && item.minH > item.maxH) {
      out.push(issueWarn(`${path}.minH`, `minH ${item.minH} exceeds maxH ${item.maxH}`));
    }

    if (item.collision !== undefined && !COLLISION_SET.has(item.collision as string)) {
      out.push(
        issueWarn(
          `${path}.collision`,
          `expected one of ${COLLISION_POLICIES.join(' | ')}, received ${describe(item.collision)}; it will be dropped`,
        ),
      );
    }
    checkStringArray(item.collisionWith, `${path}.collisionWith`, out);
    checkStringArray(item.tags, `${path}.tags`, out);
    checkBoolean(item.locked, `${path}.locked`, out);
    checkBoolean(item.hidden, `${path}.hidden`, out);
    if (item.order !== undefined && !isFiniteNumber(item.order)) {
      out.push(
        issueWarn(`${path}.order`, `expected a number, received ${describe(item.order)}; it will be dropped`),
      );
    }

    checkAt(item.at, `${path}.at`, container, out);

    for (const key of unknownKeysOf(item, ITEM_KEYS)) {
      out.push(
        issueWarn(`${path}.${key}`, 'unknown item key; parked in $unknown and re-emitted verbatim'),
      );
    }
    if (hasOwn(item, '$unknown') && item.$unknown !== undefined && !isPlainObject(item.$unknown)) {
      out.push(issueWarn(`${path}.$unknown`, 'expected an object; it will be dropped'));
    }
  }
}

function checkAt(
  value: unknown,
  path: string,
  container: ContainerFacts,
  out: Issue[],
): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    out.push(issueWarn(path, `expected an object, received ${describe(value)}; it will be dropped`));
    return;
  }
  for (const name of Object.keys(value)) {
    const p = `${path}.${name}`;
    if (!container.sizeNames.has(name)) {
      out.push(issueWarn(p, `no size named "${name}" is declared in container.sizes; the override is inert`));
    }
    const override: unknown = value[name];
    if (!isPlainObject(override)) {
      out.push(issueWarn(p, `expected an object, received ${describe(override)}; it will be dropped`));
      continue;
    }
    if (override.x !== undefined) checkPlacement(override.x, `${p}.x`, false, container, out);
    if (override.y !== undefined) checkPlacement(override.y, `${p}.y`, true, container, out);
    checkBoolean(override.hidden, `${p}.hidden`, out);
    if (override.order !== undefined && !isFiniteNumber(override.order)) {
      out.push(
        issueWarn(`${p}.order`, `expected a number, received ${describe(override.order)}; it will be dropped`),
      );
    }
    for (const key of unknownKeysOf(override, OVERRIDE_KEYS)) {
      const message =
        key === 'z'
          ? 'per-size z overrides are forbidden (spec §1.23); it will be dropped'
          : 'unknown key in a size override; it will be dropped';
      out.push(issueWarn(`${p}.${key}`, message));
    }
  }
}

/* ------------------------------------------------------------------ */
/* placements + lengths                                                */
/* ------------------------------------------------------------------ */

function checkPlacement(
  value: unknown,
  path: string,
  isY: boolean,
  container: ContainerFacts,
  out: Issue[],
): void {
  if (value === undefined) {
    out.push(issueError(path, 'required'));
    return;
  }
  if (!isPlainObject(value)) {
    out.push(issueError(path, `expected an axis placement object, received ${describe(value)}`));
    return;
  }
  const mode = value.mode;
  if (typeof mode !== 'string' || !MODE_SET.has(mode)) {
    out.push(
      issueError(`${path}.mode`, `expected one of ${AXIS_MODES.join(' | ')}, received ${describe(mode)}`),
    );
    return;
  }

  const fields = placementFields(mode as AxisMode);
  for (const field of fields) {
    if (value[field] === undefined) {
      out.push(issueError(`${path}.${field}`, `required for mode '${mode}'`));
    } else {
      checkLen(value[field], `${path}.${field}`, out);
    }
  }
  for (const key of unknownKeysOf(value, ['mode', ...fields])) {
    out.push(issueWarn(`${path}.${key}`, `not used by mode '${mode}'; it will be dropped`));
  }

  if (isY && modeNeedsDefiniteExtent(mode as AxisMode) && !container.fillHeight) {
    out.push(
      issueWarn(
        `${path}.mode`,
        `vertical '${mode}' needs container.height:'fill'; it degrades to 'start' at resolve time (spec §1.6)`,
      ),
    );
  }
}

function checkLen(value: unknown, path: string, out: Issue[]): void {
  if (isFiniteNumber(value)) return;
  if (isPlainObject(value)) {
    if (value.pct !== undefined && !isFiniteNumber(value.pct)) {
      out.push(issueError(`${path}.pct`, `expected a finite number, received ${describe(value.pct)}`));
    }
    if (value.px !== undefined && !isFiniteNumber(value.px)) {
      out.push(issueError(`${path}.px`, `expected a finite number, received ${describe(value.px)}`));
    }
    for (const key of unknownKeysOf(value, ['pct', 'px'])) {
      out.push(issueWarn(`${path}.${key}`, 'unknown key in a length; it will be dropped'));
    }
    return;
  }
  out.push(
    issueError(path, `expected a number (px) or a { pct, px } object, received ${describe(value)}`),
  );
}

/* ------------------------------------------------------------------ */
/* small shared checks                                                 */
/* ------------------------------------------------------------------ */

function checkEnum(value: unknown, allowed: readonly string[], path: string, out: Issue[]): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !allowed.includes(value)) {
    out.push(
      issueWarn(
        path,
        `expected one of ${allowed.join(' | ')}, received ${describe(value)}; it will be dropped`,
      ),
    );
  }
}

function checkNonNegative(value: unknown, path: string, out: Issue[]): void {
  if (value === undefined) return;
  if (!isFiniteNumber(value) || value < 0) {
    out.push(
      issueWarn(path, `expected a number ≥ 0, received ${describe(value)}; it will be dropped`),
    );
  }
}

function checkStringArray(value: unknown, path: string, out: Issue[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    out.push(issueWarn(path, `expected an array of strings, received ${describe(value)}; it will be dropped`));
    return;
  }
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string') {
      out.push(
        issueWarn(`${path}[${i}]`, `expected a string, received ${describe(value[i])}; it will be dropped`),
      );
    }
  }
}

function checkBoolean(value: unknown, path: string, out: Issue[]): void {
  if (value === undefined) return;
  if (typeof value !== 'boolean') {
    out.push(
      issueWarn(path, `expected a boolean, received ${describe(value)}; it will be dropped`),
    );
  }
}

/** Short, allocation-cheap description of a rejected value for messages. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'an array';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number' || t === 'boolean') return String(value);
  if (t === 'object') return 'an object';
  return t;
}
