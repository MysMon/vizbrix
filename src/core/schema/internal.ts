/**
 * Private helpers shared by the schema module (normalize / validate / load /
 * migrate / serialize). Not part of the public surface — nothing outside
 * `src/core/schema` and `src/core/convert` should import this file.
 *
 * Everything here is dependency-free, DOM-free and total: no function in this
 * file throws for any input.
 */

import type { AxisMode, Issue } from './types';

/* ------------------------------------------------------------------ */
/* Type guards                                                         */
/* ------------------------------------------------------------------ */

/** True for non-null, non-array objects (the only shape the schema uses). */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/* ------------------------------------------------------------------ */
/* Issue helpers                                                       */
/* ------------------------------------------------------------------ */

export function issueError(path: string, message: string): Issue {
  return { severity: 'error', path, message };
}

export function issueWarn(path: string, message: string): Issue {
  return { severity: 'warn', path, message };
}

/**
 * Issue paths are JS access expressions rooted at the document, with the
 * document itself addressed by the empty string — `''`,
 * `'container.base.width'`, `'items[3].x.offset'`.
 */
export function indexPath(base: string, index: number): string {
  return `${base}[${index}]`;
}

/* ------------------------------------------------------------------ */
/* Known key sets — everything else parks in `$unknown`                */
/* ------------------------------------------------------------------ */

export const DOC_KEYS = ['version', 'compat', 'container', 'items', '$unknown'] as const;

export const CONTAINER_KEYS = [
  'base',
  'height',
  'sizes',
  'stackBelow',
  'responsive',
  'direction',
] as const;

export const BASE_KEYS = ['width', 'height'] as const;

export const SIZE_KEYS = ['maxWidth'] as const;

export const LEN_KEYS = ['pct', 'px'] as const;

export const ITEM_KEYS = [
  'id',
  'x',
  'y',
  'z',
  'minW',
  'minH',
  'maxW',
  'maxH',
  'collision',
  'collisionWith',
  'tags',
  'locked',
  'hidden',
  'order',
  'at',
  'data',
  '$unknown',
] as const;

export const OVERRIDE_KEYS = ['x', 'y', 'hidden', 'order'] as const;

export const AXIS_MODES: readonly AxisMode[] = ['start', 'end', 'both', 'center', 'scale'];

export const COLLISION_POLICIES = ['allow', 'guide', 'forbid'] as const;

/** Fields an `AxisPlacement` carries for a given mode. */
export function placementFields(mode: AxisMode): readonly string[] {
  return mode === 'both' ? ['start', 'end'] : ['offset', 'size'];
}

/** True when the mode needs a definite container extent to resolve (§1.6). */
export function modeNeedsDefiniteExtent(mode: AxisMode): boolean {
  return mode !== 'start';
}

/**
 * Own enumerable keys of `obj` that are not in `known`, in a deterministic
 * (sorted) order. Used both for `$unknown` parking and for the
 * `forward-degraded` ignored-path report.
 */
export function unknownKeysOf(obj: Record<string, unknown>, known: readonly string[]): string[] {
  const set = new Set<string>(known);
  return Object.keys(obj)
    .filter((k) => !set.has(k))
    .sort();
}

/** Base design width used when a document does not supply a usable one. */
export const DEFAULT_BASE_WIDTH = 1200;

/** Deterministic fallback placement for structurally broken input. */
export function fallbackPlacement(): { mode: 'start'; offset: number; size: number } {
  return { mode: 'start', offset: 0, size: 0 };
}

/**
 * Parses `load()`-style input: a JSON string is parsed, anything else is
 * passed through untouched. Never throws — a parse failure yields `undefined`.
 */
export function parseInput(input: unknown): { value: unknown; parseError?: string } {
  if (typeof input !== 'string') return { value: input };
  try {
    return { value: JSON.parse(input) as unknown };
  } catch (e) {
    return { value: undefined, parseError: e instanceof Error ? e.message : String(e) };
  }
}
