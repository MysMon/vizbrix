/**
 * Authoring entry (`defineLayout`) and the repair pass (`normalize`).
 *
 * `normalize()` is total: it accepts anything and returns a document the rest
 * of the engine can consume without defensive checks. It repairs rather than
 * rejects — invalid optional fields are dropped, duplicate ids are renamed,
 * missing `z` keys are generated, `Len`s are canonicalized and items are
 * sorted by `z`. Damage is reported through an optional issue sink, never by
 * throwing.
 *
 * `defineLayout()` is the one authoring-time entry that DOES throw, and only
 * on duplicate ids: at authoring time a duplicate id is a typo you want to
 * see immediately, whereas at load time it is damaged data you want repaired.
 */

import type {
  AxisMode,
  AxisPlacement,
  ContainerConfig,
  FlatItemInput,
  Issue,
  ItemOverride,
  LayoutDoc,
  LayoutInput,
  LayoutItem,
  Len,
  SizeDef,
} from './types';
import { SCHEMA_VERSION } from './types';
import { canonLen, lenParts } from '../geometry/len';
import { reencodeAxis } from '../geometry/reencode';
import { isValidKey, keysBetween } from '../order/fractional';
import {
  AXIS_MODES,
  COLLISION_POLICIES,
  CONTAINER_KEYS,
  DEFAULT_BASE_WIDTH,
  DOC_KEYS,
  ITEM_KEYS,
  LEN_KEYS,
  OVERRIDE_KEYS,
  fallbackPlacement,
  hasOwn,
  indexPath,
  isFiniteNumber,
  isNonEmptyString,
  isPlainObject,
  issueWarn,
  modeNeedsDefiniteExtent,
  placementFields,
  unknownKeysOf,
} from './internal';

export { DEFAULT_BASE_WIDTH } from './internal';

const MODE_SET = new Set<string>(AXIS_MODES);
const COLLISION_SET = new Set<string>(COLLISION_POLICIES);

/* ------------------------------------------------------------------ */
/* normalize                                                           */
/* ------------------------------------------------------------------ */

/**
 * Repairs any input into a canonical {@link LayoutDoc}. Never throws.
 *
 * Guarantees on the result:
 * - `container.base.width` is a positive number.
 * - every item has a unique `id`, a non-empty `z`, and valid `x` / `y`.
 * - items are sorted ascending by `z` (ties broken by `id`, so the order is
 *   total and stable).
 * - all `Len` values are canonical (`canonLen`), and no placement `size` is
 *   negative at every container width.
 * - unknown keys at the document and item level are parked in `$unknown`.
 * - the result is a fixpoint: `normalize(normalize(d))` deep-equals
 *   `normalize(d)` (law L3).
 *
 * @param docLike anything — a parsed document, a partial one, or junk.
 * @param issues optional sink; every repair is appended here as a `warn`.
 *   The spec's `normalize(docLike): LayoutDoc` shape is preserved because the
 *   parameter is optional.
 */
export function normalize<TData = undefined>(docLike: unknown, issues?: Issue[]): LayoutDoc<TData> {
  const out = issues ?? [];
  const src = isPlainObject(docLike) ? docLike : {};
  if (!isPlainObject(docLike)) {
    out.push(issueWarn('', 'not a layout document; produced an empty layout'));
  }

  const version = normalizeVersion(src.version, 'version', out);
  const container = normalizeContainer(src.container, out);
  const items = normalizeItems(src.items, out);

  const doc: Record<string, unknown> = { version, container, items };

  if (src.compat !== undefined) {
    if (isFiniteNumber(src.compat) && Number.isInteger(src.compat) && src.compat >= 1) {
      // `compat` defaults to 1; omitting it keeps serialized output minimal.
      if (src.compat !== 1) doc.compat = src.compat;
    } else {
      out.push(issueWarn('compat', 'not an integer ≥ 1; it will be dropped'));
    }
  }

  const parked = parkUnknown(src, DOC_KEYS, '', out, 'document');
  if (parked) doc.$unknown = parked;

  return doc as unknown as LayoutDoc<TData>;
}

function normalizeVersion(value: unknown, path: string, out: Issue[]): number {
  if (isFiniteNumber(value) && Number.isInteger(value) && value >= 1) return value;
  if (value !== undefined) {
    out.push(issueWarn(path, `not an integer ≥ 1; defaulted to ${SCHEMA_VERSION}`));
  }
  return SCHEMA_VERSION;
}

/* ------------------------------------------------------------------ */
/* container                                                           */
/* ------------------------------------------------------------------ */

function normalizeContainer(value: unknown, out: Issue[]): ContainerConfig {
  const src = isPlainObject(value) ? value : {};
  if (!isPlainObject(value) && value !== undefined) {
    out.push(issueWarn('container', 'not an object; replaced with defaults'));
  }

  const srcBase = isPlainObject(src.base) ? src.base : {};
  const base: { width: number; height?: number } = { width: DEFAULT_BASE_WIDTH };
  if (isFiniteNumber(srcBase.width) && srcBase.width > 0) {
    base.width = srcBase.width;
  } else {
    out.push(
      issueWarn('container.base.width', `missing or invalid; defaulted to ${DEFAULT_BASE_WIDTH}`),
    );
  }
  if (isFiniteNumber(srcBase.height) && srcBase.height > 0) base.height = srcBase.height;

  const container: Record<string, unknown> = { base };

  if (src.height === 'auto' || src.height === 'fill') container.height = src.height;
  if (src.responsive === 'reflow' || src.responsive === 'scale') container.responsive = src.responsive;
  if (src.direction === 'ltr' || src.direction === 'rtl') container.direction = src.direction;
  if (isFiniteNumber(src.stackBelow) && src.stackBelow >= 0) container.stackBelow = src.stackBelow;

  if (isPlainObject(src.sizes)) {
    // Prototype-free accumulator: a size literally named `__proto__` (JSON
    // permits it) would otherwise hit `Object.prototype`'s setter, silently
    // vanish, and break the L3 fixpoint. The spread at the end turns the own
    // key back into a normal own data property on an ordinary object.
    const sizes = Object.create(null) as Record<string, SizeDef>;
    let count = 0;
    for (const name of Object.keys(src.sizes)) {
      const def: unknown = src.sizes[name];
      if (name !== '' && isPlainObject(def) && isFiniteNumber(def.maxWidth) && def.maxWidth > 0) {
        sizes[name] = { maxWidth: def.maxWidth };
        count++;
      }
    }
    if (count > 0) container.sizes = { ...sizes };
  }

  // Unknown container keys are NOT parked: ContainerConfig has no $unknown
  // slot in the frozen contract, so they are reported and dropped.
  for (const key of unknownKeysOf(src, CONTAINER_KEYS)) {
    out.push(issueWarn(`container.${key}`, 'unknown container key; dropped'));
  }

  return container as unknown as ContainerConfig;
}

/* ------------------------------------------------------------------ */
/* items                                                               */
/* ------------------------------------------------------------------ */

interface WorkItem {
  fields: Record<string, unknown>;
  /** Original index, used for issue paths and for the z-fill walk. */
  index: number;
}

function normalizeItems(value: unknown, out: Issue[]): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    out.push(issueWarn('items', 'not an array; replaced with an empty list'));
    return [];
  }

  const work: WorkItem[] = [];
  const usedIds = new Set<string>();

  // Every id an item already carries is reserved before any repair runs. A
  // duplicate is renamed by suffixing, and without the reservation the suffixed
  // name could belong to an undamaged item further down the array — which would
  // then be renamed in turn, moving an id that external state (stored
  // selections, per-widget rows, deep links) still points at.
  const reservedIds = new Set<string>();
  for (const raw of value) {
    if (isPlainObject(raw) && isNonEmptyString(raw.id)) reservedIds.add(raw.id);
  }

  for (let i = 0; i < value.length; i++) {
    const path = indexPath('items', i);
    const raw: unknown = value[i];
    if (!isPlainObject(raw)) {
      out.push(issueWarn(path, 'not an object; dropped'));
      continue;
    }
    work.push({ fields: normalizeItem(raw, path, usedIds, reservedIds, out), index: i });
  }

  fillKeys(work, out);
  sortByKey(work);

  const items = work.map((w) => w.fields);
  canonicalizeZInPlace(items, out);
  return items;
}

/**
 * Re-keys items whose `z` the generator cannot use as a bound: non-canonical
 * keys (hand-written `"b0"`, `"c0"`, …) and keys that are not strictly greater
 * than their predecessor (duplicates). Order-preserving: the input must
 * already be sorted, kept keys keep their exact value, and each run of
 * re-keyed items lands strictly between its surviving anchors. Without this
 * pass, a later `bringToFront()` on a hand-authored document would throw from
 * deep inside a gesture.
 */
function canonicalizeZInPlace(items: Array<Record<string, unknown>>, out: Issue[]): void {
  const n = items.length;
  if (n === 0) return;

  // Pass 1: decide which keys survive — valid AND strictly increasing.
  const keep = new Array<boolean>(n);
  let prevKept: string | null = null;
  let dirty = false;
  for (let i = 0; i < n; i++) {
    const z = items[i]!.z;
    const ok = typeof z === 'string' && isValidKey(z) && (prevKept === null || z > prevKept);
    keep[i] = ok;
    if (ok) prevKept = z as string;
    else dirty = true;
  }
  if (!dirty) return;

  // Pass 2: fill each run of rejected keys between its surviving anchors.
  let i = 0;
  let lower: string | null = null;
  while (i < n) {
    if (keep[i]) {
      lower = items[i]!.z as string;
      i++;
      continue;
    }
    let j = i;
    while (j < n && !keep[j]) j++;
    const upper = j < n ? (items[j]!.z as string) : null;
    const keys = safeKeysBetween(lower, upper, j - i, out);
    for (let k = i; k < j; k++) {
      out.push(
        issueWarn(
          `items[${k}].z`,
          `non-canonical or duplicate z key ${JSON.stringify(items[k]!.z)}; re-keyed`,
        ),
      );
      items[k]!.z = keys[k - i];
    }
    lower = upper ?? keys[keys.length - 1] ?? lower;
    i = j;
  }
}

/**
 * Defensive construction-time variant for `createStore`: returns the same
 * array when every key is canonical and strictly increasing, otherwise a new
 * array in which offending items are copied with regenerated keys. Never
 * mutates its input and never throws.
 */
export function ensureCanonicalZ<T extends { id: string; z: string }>(
  items: readonly T[],
): { items: readonly T[]; changed: boolean } {
  // Canonicalize against the same total order the engine sorts by — (z, id,
  // input index) — so re-keying preserves the ordering the author expressed,
  // even when the input array itself is unsorted.
  const order = items.map((_, i) => i);
  order.sort((a, b) => {
    const ia = items[a]!;
    const ib = items[b]!;
    if (ia.z !== ib.z) return ia.z < ib.z ? -1 : 1;
    if (ia.id !== ib.id) return ia.id < ib.id ? -1 : 1;
    return a - b;
  });
  const probe: Array<Record<string, unknown>> = order.map((i) => ({ z: items[i]!.z }));
  canonicalizeZInPlace(probe, []);

  const rekeyed = new Map<number, string>();
  for (let k = 0; k < order.length; k++) {
    const z = probe[k]!.z as string;
    if (z !== items[order[k]!]!.z) rekeyed.set(order[k]!, z);
  }
  if (rekeyed.size === 0) return { items, changed: false };
  const next = items.map((it, i) => (rekeyed.has(i) ? { ...it, z: rekeyed.get(i)! } : it));
  return { items: next, changed: true };
}

/**
 * @param usedIds ids already claimed by an earlier item in this pass.
 * @param reservedIds every id carried by any item of the document, so a
 *   generated or de-duplicated id never lands on one an item still owns.
 */
function normalizeItem(
  raw: Record<string, unknown>,
  path: string,
  usedIds: Set<string>,
  reservedIds: Set<string>,
  out: Issue[],
): Record<string, unknown> {
  const item: Record<string, unknown> = {};

  /* id — unique by construction */
  const taken = (candidate: string): boolean => usedIds.has(candidate) || reservedIds.has(candidate);
  let id = isNonEmptyString(raw.id) ? raw.id : '';
  if (id === '') {
    let n = usedIds.size + 1;
    while (taken(`item-${n}`)) n++;
    id = `item-${n}`;
    out.push(issueWarn(`${path}.id`, `missing or empty; generated "${id}"`));
  }
  if (usedIds.has(id)) {
    const original = id;
    let n = 2;
    while (taken(`${original}-${n}`)) n++;
    id = `${original}-${n}`;
    out.push(issueWarn(`${path}.id`, `duplicate id "${original}"; renamed to "${id}"`));
  }
  usedIds.add(id);
  item.id = id;

  item.x = normalizePlacement(raw.x, `${path}.x`, out);
  item.y = normalizePlacement(raw.y, `${path}.y`, out);

  // The `z` slot is claimed here even when the key has to be generated, so
  // that the field order of the produced item is canonical either way — which
  // is what makes normalize a byte-level fixpoint, not merely a deep-equal one.
  item.z = isNonEmptyString(raw.z) ? raw.z : undefined;
  if (item.z === undefined && raw.z !== undefined) {
    out.push(issueWarn(`${path}.z`, 'not a non-empty string; a key will be generated'));
  }

  for (const key of ['minW', 'minH', 'maxW', 'maxH'] as const) {
    const v = raw[key];
    if (v === undefined) continue;
    if (isFiniteNumber(v) && v >= 0) item[key] = v;
    else out.push(issueWarn(`${path}.${key}`, 'not a number ≥ 0; dropped'));
  }

  if (raw.collision !== undefined) {
    if (typeof raw.collision === 'string' && COLLISION_SET.has(raw.collision)) {
      item.collision = raw.collision;
    } else {
      out.push(issueWarn(`${path}.collision`, 'not a valid collision policy; dropped'));
    }
  }

  const collisionWith = normalizeStringArray(raw.collisionWith, `${path}.collisionWith`, out);
  if (collisionWith) item.collisionWith = collisionWith;
  const tags = normalizeStringArray(raw.tags, `${path}.tags`, out);
  if (tags) item.tags = tags;

  for (const key of ['locked', 'hidden'] as const) {
    const v = raw[key];
    if (v === undefined) continue;
    if (typeof v === 'boolean') item[key] = v;
    else out.push(issueWarn(`${path}.${key}`, 'not a boolean; dropped'));
  }

  if (raw.order !== undefined) {
    if (isFiniteNumber(raw.order)) item.order = raw.order;
    else out.push(issueWarn(`${path}.order`, 'not a number; dropped'));
  }

  const at = normalizeAt(raw.at, `${path}.at`, out);
  if (at) item.at = at;

  // `data` is opaque and passed by reference: it is consumer-owned, may hold
  // non-JSON values, and must keep identity across normalize.
  if (hasOwn(raw, 'data')) item.data = raw.data;

  const parked = parkUnknown(raw, ITEM_KEYS, path, out, 'item');
  if (parked) item.$unknown = parked;

  return item;
}

function normalizeAt(
  value: unknown,
  path: string,
  out: Issue[],
): Record<string, ItemOverride> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    out.push(issueWarn(path, 'not an object; dropped'));
    return undefined;
  }
  // Prototype-free accumulator — see `normalizeContainer`'s `sizes` for why.
  const at = Object.create(null) as Record<string, ItemOverride>;
  let count = 0;
  for (const name of Object.keys(value)) {
    const p = `${path}.${name}`;
    const raw: unknown = value[name];
    if (name === '' || !isPlainObject(raw)) {
      out.push(issueWarn(p, 'not an object; dropped'));
      continue;
    }
    const override: Record<string, unknown> = {};
    for (const axis of ['x', 'y'] as const) {
      if (raw[axis] === undefined) continue;
      const placement = normalizeOverridePlacement(raw[axis], `${p}.${axis}`, out);
      if (placement) override[axis] = placement;
      else {
        out.push(
          issueWarn(
            `${p}.${axis}`,
            'invalid axis placement in a size override; dropped (the base placement is kept)',
          ),
        );
      }
    }
    if (typeof raw.hidden === 'boolean') override.hidden = raw.hidden;
    else if (raw.hidden !== undefined) out.push(issueWarn(`${p}.hidden`, 'not a boolean; dropped'));
    if (isFiniteNumber(raw.order)) override.order = raw.order;
    else if (raw.order !== undefined) out.push(issueWarn(`${p}.order`, 'not a number; dropped'));

    for (const key of unknownKeysOf(raw, OVERRIDE_KEYS)) {
      out.push(
        issueWarn(
          `${p}.${key}`,
          key === 'z'
            ? 'per-size z overrides are forbidden (spec §1.23); dropped'
            : 'unknown key in a size override; dropped',
        ),
      );
    }
    at[name] = override as ItemOverride;
    count++;
  }
  return count > 0 ? { ...at } : undefined;
}

/**
 * Normalize a placement that lives inside a size override, where damage is
 * DROPPED instead of repaired.
 *
 * `normalizePlacement` substitutes `{mode:'start', offset:0, size:0}` for
 * anything it cannot read, which is the right answer for `item.x` / `item.y`
 * (they are required) and the wrong one for `at.<size>.x`: overrides replace
 * placements wholesale (cascade.ts), so the substitute would overwrite a
 * perfectly good base placement with a zero-sized box and make the item vanish
 * at every width where that size is active. Dropping the override instead
 * leaves the base layout intact — exactly what not writing the override would
 * have produced. A dropped field stays dropped on a second pass, so the L3
 * fixpoint is preserved.
 */
function normalizeOverridePlacement(
  value: unknown,
  path: string,
  out: Issue[],
): AxisPlacement | undefined {
  if (!isPlainObject(value) || typeof value.mode !== 'string' || !MODE_SET.has(value.mode)) {
    return undefined;
  }
  // A missing or non-length term would silently normalize to 0 — a zero-sized
  // box again, so treat it as damage rather than repairing it.
  for (const field of placementFields(value.mode as AxisMode)) {
    const term: unknown = value[field];
    if (!isFiniteNumber(term) && !isPlainObject(term)) return undefined;
  }
  return normalizePlacement(value, path, out);
}

function normalizeStringArray(
  value: unknown,
  path: string,
  out: Issue[],
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    out.push(issueWarn(path, 'not an array; dropped'));
    return undefined;
  }
  const kept = value.filter((v): v is string => typeof v === 'string');
  if (kept.length !== value.length) {
    out.push(issueWarn(path, 'contained non-string entries; they were dropped'));
  }
  return kept;
}

/* ------------------------------------------------------------------ */
/* placements + lengths                                                */
/* ------------------------------------------------------------------ */

function normalizePlacement(value: unknown, path: string, out: Issue[]): AxisPlacement {
  if (!isPlainObject(value) || typeof value.mode !== 'string' || !MODE_SET.has(value.mode)) {
    out.push(issueWarn(path, "invalid axis placement; replaced with mode 'start' at 0×0"));
    return fallbackPlacement();
  }
  const mode = value.mode as AxisMode;
  const fields = placementFields(mode);
  const placement: Record<string, unknown> = { mode };
  for (const field of fields) {
    const len = normalizeLen(value[field], `${path}.${field}`, out);
    placement[field] = field === 'size' ? clampSize(len, `${path}.${field}`, out) : len;
  }
  for (const key of unknownKeysOf(value, ['mode', ...fields])) {
    out.push(issueWarn(`${path}.${key}`, `not used by mode '${mode}'; dropped`));
  }
  return placement as unknown as AxisPlacement;
}

/**
 * Floors a `size` term that is negative at every container width, the same rule
 * `minW`/`maxW` obey. Only `size` is subject to it: offsets and the `both`
 * insets are legitimately negative (an item hanging past an edge).
 *
 * A `Len` is affine, so its sign is settled for the whole width range only when
 * both terms agree. `{ pct: 100, px: -32 }` — full width minus a gutter — is an
 * authoring idiom that resolves positive and is left alone; the resolver floors
 * whatever a mixed-sign term comes to at the width where it applies.
 */
function clampSize(len: Len, path: string, out: Issue[]): Len {
  const { pct, px } = lenParts(len);
  if (pct > 0 || px > 0 || (pct === 0 && px === 0)) return len;
  out.push(issueWarn(path, 'negative at every container extent; clamped to 0'));
  return 0;
}

function normalizeLen(value: unknown, path: string, out: Issue[]): Len {
  if (isFiniteNumber(value)) return canonLen(value);
  if (isPlainObject(value)) {
    const len: { pct?: number; px?: number } = {};
    if (isFiniteNumber(value.pct)) len.pct = value.pct;
    else if (value.pct !== undefined) out.push(issueWarn(`${path}.pct`, 'not a finite number; dropped'));
    if (isFiniteNumber(value.px)) len.px = value.px;
    else if (value.px !== undefined) out.push(issueWarn(`${path}.px`, 'not a finite number; dropped'));
    for (const key of unknownKeysOf(value, LEN_KEYS)) {
      out.push(issueWarn(`${path}.${key}`, 'unknown key in a length; dropped'));
    }
    return canonLen(len);
  }
  if (value !== undefined) out.push(issueWarn(path, 'not a length; replaced with 0'));
  else out.push(issueWarn(path, 'missing; replaced with 0'));
  return 0;
}

/* ------------------------------------------------------------------ */
/* z keys                                                              */
/* ------------------------------------------------------------------ */

/**
 * Fills missing `z` keys in array order, spreading each run of key-less items
 * evenly between its surrounding anchors. Falls back to an open upper bound
 * when the surrounding keys are not in ascending order (a damaged document).
 */
function fillKeys(work: WorkItem[], out: Issue[]): void {
  const n = work.length;
  let i = 0;
  while (i < n) {
    if (typeof work[i]!.fields.z === 'string') {
      i++;
      continue;
    }
    let j = i;
    while (j < n && typeof work[j]!.fields.z !== 'string') j++;
    const lower = i > 0 ? (work[i - 1]!.fields.z as string) : null;
    const upperRaw = j < n ? (work[j]!.fields.z as string) : null;
    const upper = lower !== null && upperRaw !== null && lower >= upperRaw ? null : upperRaw;
    const keys = safeKeysBetween(lower, upper, j - i, out);
    for (let k = i; k < j; k++) work[k]!.fields.z = keys[k - i];
    i = j;
  }
}

function safeKeysBetween(
  a: string | null,
  b: string | null,
  count: number,
  out: Issue[],
): string[] {
  if (count <= 0) return [];
  try {
    const keys = keysBetween(a, b, count);
    if (keys.length === count && keys.every((k) => typeof k === 'string' && k.length > 0)) {
      return keys;
    }
  } catch {
    /* fall through to the open-ended retry */
  }
  try {
    const keys = keysBetween(a, null, count);
    if (keys.length === count) {
      out.push(issueWarn('items', 'z keys were out of order; regenerated with an open upper bound'));
      return keys;
    }
  } catch {
    /* fall through to the last-resort retry */
  }
  out.push(issueWarn('items', 'z key generation failed; regenerated the run from scratch'));
  try {
    const keys = keysBetween(null, null, count);
    if (keys.length === count) return keys;
  } catch {
    /* fall through to the synthetic ladder */
  }
  // normalize() must be total: synthesize an ascending, strictly-ordered
  // ladder rather than propagate a generator failure.
  const keys: string[] = [];
  for (let i = 0; i < count; i++) keys.push(`a${String(i).padStart(6, '0')}`);
  return keys;
}

/** Total order on (z, id) so the sort is deterministic even with duplicate keys. */
function sortByKey(work: WorkItem[]): void {
  work.sort((a, b) => {
    const az = a.fields.z as string;
    const bz = b.fields.z as string;
    if (az !== bz) return az < bz ? -1 : 1;
    const ai = a.fields.id as string;
    const bi = b.fields.id as string;
    if (ai !== bi) return ai < bi ? -1 : 1;
    return a.index - b.index;
  });
}

/* ------------------------------------------------------------------ */
/* $unknown parking                                                    */
/* ------------------------------------------------------------------ */

/**
 * Moves unrecognized own keys into `$unknown`, merging with any `$unknown`
 * already present. A key carried by both wins at the top level: that is where
 * the writer put the live value, while the `$unknown` copy is what an older
 * reader parked before the key had a meaning — keeping the parked copy would
 * revert the edit and then persist the revert. Values are copied by reference,
 * so a cyclic payload is never traversed.
 */
function parkUnknown(
  src: Record<string, unknown>,
  known: readonly string[],
  path: string,
  out: Issue[],
  what: string,
): Record<string, unknown> | undefined {
  const extras = unknownKeysOf(src, known);
  const existing = isPlainObject(src.$unknown) ? src.$unknown : undefined;
  if (extras.length === 0) {
    if (existing === undefined) {
      if (src.$unknown !== undefined) {
        out.push(issueWarn(path === '' ? '$unknown' : `${path}.$unknown`, 'not an object; dropped'));
      }
      return undefined;
    }
    return Object.keys(existing).length > 0 ? { ...existing } : undefined;
  }

  // Prototype-free accumulator: `parked['__proto__'] = …` on a plain object
  // literal would invoke `Object.prototype`'s `__proto__` setter instead of
  // creating an own property, so the value would never land in `$unknown` —
  // contradicting law L2's "parked verbatim and re-emitted" promise. The spread
  // below copies the own key onto an ordinary object via CreateDataProperty,
  // so nothing's prototype is ever mutated.
  const parked = Object.create(null) as Record<string, unknown>;
  for (const key of extras) {
    parked[key] = src[key];
    out.push(
      issueWarn(
        path === '' ? key : `${path}.${key}`,
        existing !== undefined && hasOwn(existing, key)
          ? `unknown ${what} key; parked in $unknown, where it replaces a value an earlier reader parked`
          : `unknown ${what} key; parked in $unknown`,
      ),
    );
  }
  const merged = { ...(existing ?? {}), ...parked };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/* ------------------------------------------------------------------ */
/* defineLayout                                                        */
/* ------------------------------------------------------------------ */

/**
 * Authoring entry point. Accepts flat px sugar (`{ id, x, y, w, h, anchor }`)
 * alongside canonical items and produces a normalized {@link LayoutDoc}.
 *
 * Conversions performed:
 * - `anchor` → per-axis modes (`'scale'` means both axes scale; the object
 *   form defaults each axis to `'start'`), then `reencodeAxis` at the base
 *   extent, so the authored pixel rect is exactly what resolves at
 *   `base.width`.
 * - vertical modes other than `'start'` degrade to `'start'` unless
 *   `container.height === 'fill'` and a `base.height` is declared (spec §1.6);
 *   the degradation is reported through the `issues` sink.
 * - missing `z` keys are generated, `Len`s canonicalized, items sorted by `z`.
 *
 * @throws {Error} if two items share an `id`. This is the ONLY throwing entry
 * in the schema module: authoring-time duplicates are typos, whereas `load()`
 * repairs the same damage silently.
 */
export function defineLayout<TData = undefined>(
  input: LayoutInput<TData>,
  issues?: Issue[],
): LayoutDoc<TData> {
  const out = issues ?? [];
  const rawContainer: Record<string, unknown> = isPlainObject(input?.container)
    ? input.container
    : {};
  const rawBase: Record<string, unknown> = isPlainObject(rawContainer.base)
    ? rawContainer.base
    : {};
  let baseWidth = DEFAULT_BASE_WIDTH;
  if (isFiniteNumber(rawBase.width) && rawBase.width > 0) {
    baseWidth = rawBase.width;
  } else {
    out.push(
      issueWarn(
        'container.base.width',
        `missing or invalid; defaulted to ${DEFAULT_BASE_WIDTH}. Declare it — px offsets, tier-3 order and server rects are measured against it`,
      ),
    );
  }
  const baseHeight = isFiniteNumber(rawBase.height) && rawBase.height > 0 ? rawBase.height : undefined;
  const yResolvable = rawContainer.height === 'fill' && baseHeight !== undefined;

  const rawItems: unknown[] = Array.isArray(input?.items) ? input.items : [];

  // Duplicate ids are rejected BEFORE any conversion so the error names the
  // authored index, not a post-sort one.
  const seen = new Set<string>();
  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i];
    if (!isPlainObject(raw) || !isNonEmptyString(raw.id)) continue;
    if (seen.has(raw.id)) {
      throw new Error(
        `vizbrix: duplicate item id ${JSON.stringify(raw.id)} at items[${i}] — ids must be unique within a layout`,
      );
    }
    seen.add(raw.id);
  }

  const items = rawItems.map((raw, i) =>
    isFlatInput(raw)
      ? convertFlat(raw as FlatItemInput<TData> & Record<string, unknown>, i, {
          baseWidth,
          baseHeight,
          yResolvable,
          out,
        })
      : raw,
  );

  return normalize<TData>(
    {
      version: isFiniteNumber(input?.version) ? input.version : SCHEMA_VERSION,
      container: { ...rawContainer, base: { width: baseWidth, ...(baseHeight !== undefined ? { height: baseHeight } : {}) } },
      items,
    },
    out,
  );
}

/** Flat sugar is identified by a numeric `x` — canonical items carry an object. */
function isFlatInput(raw: unknown): boolean {
  return isPlainObject(raw) && typeof raw.x === 'number';
}

interface FlatContext {
  baseWidth: number;
  baseHeight: number | undefined;
  yResolvable: boolean;
  out: Issue[];
}

function convertFlat<TData>(
  raw: FlatItemInput<TData> & Record<string, unknown>,
  index: number,
  ctx: FlatContext,
): Record<string, unknown> {
  const path = indexPath('items', index);
  const anchor = raw.anchor;
  let xMode: AxisMode = 'start';
  let yMode: AxisMode = 'start';
  if (anchor === 'scale') {
    xMode = 'scale';
    yMode = 'scale';
  } else if (isPlainObject(anchor)) {
    if (typeof anchor.x === 'string' && MODE_SET.has(anchor.x)) xMode = anchor.x as AxisMode;
    else if (anchor.x !== undefined) ctx.out.push(issueWarn(`${path}.anchor.x`, "unknown anchor mode; used 'start'"));
    if (typeof anchor.y === 'string' && MODE_SET.has(anchor.y)) yMode = anchor.y as AxisMode;
    else if (anchor.y !== undefined) ctx.out.push(issueWarn(`${path}.anchor.y`, "unknown anchor mode; used 'start'"));
  } else if (anchor !== undefined) {
    ctx.out.push(issueWarn(`${path}.anchor`, "unknown anchor spec; used { x:'start', y:'start' }"));
  }

  if (modeNeedsDefiniteExtent(yMode) && !ctx.yResolvable) {
    ctx.out.push(
      issueWarn(
        `${path}.anchor.y`,
        `vertical '${yMode}' needs container.height:'fill' with a base height; degraded to 'start' (spec §1.6)`,
      ),
    );
    yMode = 'start';
  }

  const x = num(raw.x, `${path}.x`, ctx.out);
  const y = num(raw.y, `${path}.y`, ctx.out);
  const w = num(raw.w, `${path}.w`, ctx.out);
  const h = num(raw.h, `${path}.h`, ctx.out);

  const item: Record<string, unknown> = {
    ...raw,
    x: reencodeAxis(x, w, ctx.baseWidth, xMode),
    y: reencodeAxis(y, h, ctx.baseHeight ?? 0, yMode),
  };
  delete item.w;
  delete item.h;
  delete item.anchor;
  return item;
}

function num(value: unknown, path: string, out: Issue[]): number {
  if (isFiniteNumber(value)) return value;
  out.push(issueWarn(path, 'not a finite number; used 0'));
  return 0;
}

/**
 * Convert ONE flat-sugar item (`{ id, x, y, w, h, anchor?, … }`) into a
 * canonical {@link LayoutItem} against an existing container config — the same
 * conversion {@link defineLayout} applies, for adding an item to a live
 * dashboard. The px numbers are base-design-space.
 *
 * The returned item carries an EMPTY `z`: hand it to `store.addItem`, which
 * assigns a top-of-stack key (a fixed z here would land the new item at an
 * arbitrary depth).
 */
export function defineItem<TData = undefined>(
  flat: FlatItemInput<TData>,
  container: ContainerConfig,
  issues?: Issue[],
): LayoutItem<TData> {
  const doc = defineLayout<TData>(
    { container: container as LayoutInput<TData>['container'], items: [flat] } as LayoutInput<TData>,
    issues,
  );
  const item = doc.items[0]!;
  return { ...item, z: '' };
}
