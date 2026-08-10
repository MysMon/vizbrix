/**
 * Deterministic document serialization.
 *
 * Two properties matter more than speed here:
 *
 * 1. **Stable key order.** Known schema keys are written in a fixed, semantic
 *    order (`version, compat, container, items, $unknown`; items lead with
 *    `id, x, y, z`); anything else — including `$unknown` payloads and opaque
 *    `data` — is written with keys sorted alphabetically. Two documents that
 *    are deeply equal therefore serialize to identical bytes regardless of how
 *    their objects were built, which is what makes layout diffs reviewable.
 *
 * 2. **Verbatim forward-compat.** `$unknown` values are written exactly as
 *    they were parked, so a document written by a newer version survives a
 *    load/serialize round trip through this reader (law L2).
 */

import type { LayoutDoc } from './types';
import { hasOwn, isPlainObject } from './internal';

const DOC_ORDER = ['version', 'compat', 'container', 'items', '$unknown'] as const;
const CONTAINER_ORDER = ['base', 'height', 'sizes', 'stackBelow', 'responsive', 'direction'] as const;
const BASE_ORDER = ['width', 'height'] as const;
const ITEM_ORDER = [
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
const OVERRIDE_ORDER = ['x', 'y', 'hidden', 'order'] as const;
const PLACEMENT_ORDER = ['mode', 'offset', 'size', 'start', 'end'] as const;
const LEN_ORDER = ['pct', 'px'] as const;

export interface SerializeOptions {
  /** Spaces per indent level. `0` emits a single compact line. Default `2`. */
  indent?: number;
}

/**
 * Serializes a layout document to canonical JSON.
 *
 * @throws {TypeError} only on a cyclic (or BigInt) `data` / `$unknown` payload
 * — the same failure `JSON.stringify` would produce. Everything the schema
 * itself owns is always serializable, and nesting depth is never a failure
 * mode: any document `load()` accepts, this writes back (the opaque writer
 * uses an explicit stack, not recursion).
 */
export function serialize<TData = undefined>(
  doc: LayoutDoc<TData>,
  opts?: SerializeOptions,
): string {
  const indent = opts?.indent ?? 2;
  const ctx: Ctx = { indent, stack: new Set<object>() };
  return writeDoc(doc as unknown as Record<string, unknown>, ctx, 0);
}

interface Ctx {
  indent: number;
  stack: Set<object>;
}

/* ------------------------------------------------------------------ */
/* schema-aware writers                                                */
/* ------------------------------------------------------------------ */

function writeDoc(doc: Record<string, unknown>, ctx: Ctx, depth: number): string {
  return object(
    ordered(doc, DOC_ORDER).map(([key, value]) => {
      if (key === 'container' && isPlainObject(value)) {
        return [key, writeContainer(value, ctx, depth + 1)] as const;
      }
      if (key === 'items' && Array.isArray(value)) {
        return [
          key,
          array(
            value.map((item) =>
              isPlainObject(item) ? writeItem(item, ctx, depth + 2) : writeOpaque(item, ctx, depth + 2),
            ),
            ctx,
            depth + 1,
          ),
        ] as const;
      }
      return [key, writeOpaque(value, ctx, depth + 1)] as const;
    }),
    ctx,
    depth,
  );
}

function writeContainer(container: Record<string, unknown>, ctx: Ctx, depth: number): string {
  return object(
    ordered(container, CONTAINER_ORDER).map(([key, value]) => {
      if (key === 'base' && isPlainObject(value)) {
        return [
          key,
          object(
            ordered(value, BASE_ORDER).map(([k, v]) => [k, writeOpaque(v, ctx, depth + 2)] as const),
            ctx,
            depth + 1,
          ),
        ] as const;
      }
      return [key, writeOpaque(value, ctx, depth + 1)] as const;
    }),
    ctx,
    depth,
  );
}

function writeItem(item: Record<string, unknown>, ctx: Ctx, depth: number): string {
  return object(
    ordered(item, ITEM_ORDER).map(([key, value]) => {
      if ((key === 'x' || key === 'y') && isPlainObject(value)) {
        return [key, writePlacement(value, ctx, depth + 1)] as const;
      }
      if (key === 'at' && isPlainObject(value)) {
        return [key, writeAt(value, ctx, depth + 1)] as const;
      }
      return [key, writeOpaque(value, ctx, depth + 1)] as const;
    }),
    ctx,
    depth,
  );
}

function writeAt(at: Record<string, unknown>, ctx: Ctx, depth: number): string {
  const names = Object.keys(at)
    .filter((k) => at[k] !== undefined)
    .sort();
  return object(
    names.map((name) => {
      const override = at[name];
      if (!isPlainObject(override)) return [name, writeOpaque(override, ctx, depth + 1)] as const;
      return [
        name,
        object(
          ordered(override, OVERRIDE_ORDER).map(([key, value]) =>
            (key === 'x' || key === 'y') && isPlainObject(value)
              ? ([key, writePlacement(value, ctx, depth + 2)] as const)
              : ([key, writeOpaque(value, ctx, depth + 2)] as const),
          ),
          ctx,
          depth + 1,
        ),
      ] as const;
    }),
    ctx,
    depth,
  );
}

function writePlacement(placement: Record<string, unknown>, ctx: Ctx, depth: number): string {
  return object(
    ordered(placement, PLACEMENT_ORDER).map(([key, value]) =>
      key === 'mode'
        ? ([key, writeOpaque(value, ctx, depth + 1)] as const)
        : ([key, writeLen(value, ctx, depth + 1)] as const),
    ),
    ctx,
    depth,
  );
}

function writeLen(len: unknown, ctx: Ctx, depth: number): string {
  if (isPlainObject(len)) {
    return object(
      ordered(len, LEN_ORDER).map(([key, value]) => [key, writeOpaque(value, ctx, depth + 1)] as const),
      ctx,
      depth,
    );
  }
  return writeOpaque(len, ctx, depth);
}

/* ------------------------------------------------------------------ */
/* opaque JSON writer                                                  */
/* ------------------------------------------------------------------ */

/** One in-progress container in {@link writeOpaque}'s explicit stack. */
interface OpaqueFrame {
  node: object;
  depth: number;
  isArray: boolean;
  /** Own keys, sorted; empty for arrays. */
  keys: string[];
  /** How many children have been emitted so far. */
  index: number;
  /** Emitted JSON text per child, parallel to `keys` for records. */
  parts: string[];
}

/**
 * JSON text for anything that is not a traversable object.
 *
 * @returns the text, or `undefined` when `v` is an object/array that has to be
 * walked.
 */
function writeScalar(v: unknown): string | undefined {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      return Number.isFinite(v) ? JSON.stringify(v) : 'null';
    case 'string':
      return JSON.stringify(v);
    case 'bigint':
      throw new TypeError('vizbrix: cannot serialize a BigInt value');
    case 'object':
      return undefined;
    default:
      // undefined / function / symbol — callers filter these out; reaching
      // here means it sat inside an array, where JSON writes null.
      return 'null';
  }
}

function ownKeysOf(record: Record<string, unknown>): string[] {
  return Object.keys(record)
    .filter((k) => isEmittable(record[k]))
    .sort();
}

/**
 * JSON.stringify semantics with one change: object keys are sorted. Used for
 * `$unknown` payloads, consumer `data`, and any key the schema does not know.
 *
 * Deliberately ITERATIVE (explicit stack, post-order). `load()` accepts a
 * document whose opaque payload is nested thousands of levels deep, so a
 * recursive writer would answer that document with a `RangeError` from the save
 * path — a document you can open but can never write back. The contract is
 * therefore: whatever `load()` accepts, `serialize()` emits.
 */
function writeOpaque(value: unknown, ctx: Ctx, depth: number): string {
  const root = unwrap(value);
  const scalar = writeScalar(root);
  if (scalar !== undefined) return scalar;

  const stack: OpaqueFrame[] = [];

  const push = (node: object, at: number): void => {
    if (ctx.stack.has(node)) {
      throw new TypeError('vizbrix: cannot serialize a cyclic structure');
    }
    ctx.stack.add(node);
    const isArray = Array.isArray(node);
    stack.push({
      node,
      depth: at,
      isArray,
      keys: isArray ? [] : ownKeysOf(node as Record<string, unknown>),
      index: 0,
      parts: [],
    });
  };

  push(root as object, depth);

  for (;;) {
    const frame = stack[stack.length - 1]!;
    const length = frame.isArray ? (frame.node as unknown[]).length : frame.keys.length;

    if (frame.index < length) {
      const child = frame.isArray
        ? (frame.node as unknown[])[frame.index]
        : (frame.node as Record<string, unknown>)[frame.keys[frame.index]!];
      frame.index++;
      const unwrapped = unwrap(child);
      const text = writeScalar(unwrapped);
      if (text !== undefined) frame.parts.push(text);
      else push(unwrapped as object, frame.depth + 1);
      continue;
    }

    stack.pop();
    ctx.stack.delete(frame.node);
    const text = frame.isArray
      ? array(frame.parts, ctx, frame.depth)
      : object(
          frame.keys.map((key, i) => [key, frame.parts[i]!] as const),
          ctx,
          frame.depth,
        );
    if (stack.length === 0) return text;
    stack[stack.length - 1]!.parts.push(text);
  }
}

/** Honors `toJSON()` the way `JSON.stringify` does (Date, Temporal, …). */
function unwrap(value: unknown): unknown {
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'bigint') &&
    typeof (value as { toJSON?: unknown }).toJSON === 'function'
  ) {
    return (value as { toJSON: () => unknown }).toJSON();
  }
  return value;
}

function isEmittable(value: unknown): boolean {
  const t = typeof value;
  return t !== 'undefined' && t !== 'function' && t !== 'symbol';
}

/* ------------------------------------------------------------------ */
/* layout primitives                                                   */
/* ------------------------------------------------------------------ */

function ordered(
  obj: Record<string, unknown>,
  order: readonly string[],
): (readonly [string, unknown])[] {
  const out: (readonly [string, unknown])[] = [];
  const known = new Set(order);
  for (const key of order) {
    if (hasOwn(obj, key) && isEmittable(obj[key])) out.push([key, obj[key]] as const);
  }
  const rest = Object.keys(obj)
    .filter((k) => !known.has(k) && isEmittable(obj[k]))
    .sort();
  for (const key of rest) out.push([key, obj[key]] as const);
  return out;
}

function object(pairs: readonly (readonly [string, string])[], ctx: Ctx, depth: number): string {
  if (pairs.length === 0) return '{}';
  const sep = ctx.indent > 0 ? ': ' : ':';
  const body = pairs
    .map(([key, value]) => `${pad(ctx, depth + 1)}${JSON.stringify(key)}${sep}${value}`)
    .join(',');
  return `{${body}${pad(ctx, depth)}}`;
}

function array(values: readonly string[], ctx: Ctx, depth: number): string {
  if (values.length === 0) return '[]';
  const body = values.map((v) => `${pad(ctx, depth + 1)}${v}`).join(',');
  return `[${body}${pad(ctx, depth)}]`;
}

function pad(ctx: Ctx, depth: number): string {
  return ctx.indent > 0 ? `\n${' '.repeat(ctx.indent * depth)}` : '';
}
