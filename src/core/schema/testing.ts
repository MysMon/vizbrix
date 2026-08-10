/**
 * Seeded random document generator.
 *
 * Shared test infrastructure: the round-trip laws (L1–L3), the CSS
 * differential test and the resolver's totality law all need the same thing —
 * a stream of structurally valid, reproducible layout documents that exercise
 * every axis mode, every responsive size and the forward-compat parking slots.
 *
 * It lives in `src/` rather than in a test file so other modules' tests can
 * import it. It has no test-framework dependency and pulls in nothing beyond
 * the schema module itself.
 */

import type {
  AxisMode,
  AxisPlacement,
  ItemOverride,
  LayoutDoc,
  Len,
  SizeDef,
} from './types';
import { SCHEMA_VERSION } from './types';
import { normalize } from './normalize';

/** Uniform `[0, 1)` source. */
export type Rng = () => number;

/**
 * mulberry32 — 32-bit, seedable, no dependencies, identical across platforms.
 * Deterministic reproduction is the whole point: a failing property test must
 * be replayable from its seed alone.
 */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function int(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: Rng, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)]!;
}

function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/** Two-decimal rounding, matching the px rounding the reencoder writes. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function r4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export interface RandomDocOptions {
  /** Number of items. Default: 1–8, drawn from the rng. */
  items?: number;
  /** Declared responsive sizes. Default: 0–3. */
  sizes?: number;
  /** Emit `container.height: 'fill'`, which unlocks the vertical modes. */
  fillHeight?: boolean;
  /** Attach opaque `data` to some items. Default true. */
  withData?: boolean;
  /** Park unknown keys at the document and item level. Default false. */
  withUnknown?: boolean;
  /** Base design width. Default: a value in 320–1920. */
  baseWidth?: number;
}

const X_MODES: readonly AxisMode[] = ['start', 'end', 'both', 'center', 'scale'];
const Y_START_ONLY: readonly AxisMode[] = ['start'];

/**
 * Builds a raw (un-normalized) document: unsorted `z` keys, some items with no
 * `z` at all, mixed `Len` shapes. Every document is structurally VALID —
 * `validate()` returns no `error` for it — so it is a fair subject for the
 * round-trip laws.
 */
export function randomRawDoc(seed: number | Rng, opts: RandomDocOptions = {}): Record<string, unknown> {
  const rng = typeof seed === 'number' ? makeRng(seed) : seed;

  const baseWidth = opts.baseWidth ?? int(rng, 320, 1920);
  const fill = opts.fillHeight ?? chance(rng, 0.4);
  const baseHeight = fill ? int(rng, 320, 1200) : chance(rng, 0.5) ? int(rng, 320, 1200) : undefined;

  const sizeCount = opts.sizes ?? int(rng, 0, 3);
  const sizeNames = ['xl', 'lg', 'md', 'sm'].slice(0, sizeCount);
  const sizes: Record<string, SizeDef> = {};
  let maxWidth = baseWidth;
  for (const name of sizeNames) {
    maxWidth = Math.max(60, maxWidth - int(rng, 80, 300));
    sizes[name] = { maxWidth };
  }

  const container: Record<string, unknown> = { base: { width: baseWidth } };
  if (baseHeight !== undefined) (container.base as Record<string, unknown>).height = baseHeight;
  if (fill) container.height = 'fill';
  else if (chance(rng, 0.5)) container.height = 'auto';
  if (sizeNames.length > 0) container.sizes = sizes;
  if (chance(rng, 0.3)) container.stackBelow = int(rng, 0, 600);
  if (chance(rng, 0.2)) container.responsive = pick(rng, ['reflow', 'scale'] as const);
  if (chance(rng, 0.2)) container.direction = pick(rng, ['ltr', 'rtl'] as const);

  const yModes: readonly AxisMode[] = fill ? X_MODES : Y_START_ONLY;
  const count = opts.items ?? int(rng, 1, 8);
  const items: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    items.push(
      randomRawItem(rng, `item-${i}`, {
        width: baseWidth,
        height: baseHeight ?? 800,
        xModes: X_MODES,
        yModes,
        sizeNames,
        withData: opts.withData ?? true,
        withUnknown: opts.withUnknown ?? false,
      }),
    );
  }

  const doc: Record<string, unknown> = { version: SCHEMA_VERSION, container, items };
  if (opts.withUnknown) {
    doc.$unknown = { futureFlag: true, futureList: [3, 1, 2] };
  }
  return doc;
}

interface ItemContext {
  width: number;
  height: number;
  xModes: readonly AxisMode[];
  yModes: readonly AxisMode[];
  sizeNames: readonly string[];
  withData: boolean;
  withUnknown: boolean;
}

function randomRawItem(rng: Rng, id: string, ctx: ItemContext): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id,
    x: randomPlacement(rng, ctx.width, ctx.xModes),
    y: randomPlacement(rng, ctx.height, ctx.yModes),
  };

  // A third of the items deliberately omit `z` so normalize's key fill runs.
  if (chance(rng, 0.66)) item.z = randomKey(rng);

  if (chance(rng, 0.3)) item.minW = int(rng, 0, 100);
  if (chance(rng, 0.3)) item.minH = int(rng, 0, 100);
  if (chance(rng, 0.2)) item.maxW = int(rng, 200, 2000);
  if (chance(rng, 0.2)) item.maxH = int(rng, 200, 2000);
  if (chance(rng, 0.25)) item.collision = pick(rng, ['allow', 'guide', 'forbid'] as const);
  if (chance(rng, 0.15)) item.collisionWith = ['widget', 'chrome'].slice(0, int(rng, 1, 2));
  if (chance(rng, 0.2)) item.tags = ['widget'];
  if (chance(rng, 0.15)) item.locked = chance(rng, 0.5);
  if (chance(rng, 0.15)) item.hidden = chance(rng, 0.5);
  if (chance(rng, 0.15)) item.order = int(rng, 0, 20);

  if (ctx.sizeNames.length > 0 && chance(rng, 0.5)) {
    const at: Record<string, ItemOverride> = {};
    for (const name of ctx.sizeNames) {
      if (!chance(rng, 0.6)) continue;
      const override: ItemOverride = {};
      if (chance(rng, 0.8)) override.x = randomPlacement(rng, ctx.width, ctx.xModes);
      if (chance(rng, 0.5)) override.y = randomPlacement(rng, ctx.height, ctx.yModes);
      if (chance(rng, 0.2)) override.hidden = chance(rng, 0.5);
      if (chance(rng, 0.2)) override.order = int(rng, 0, 20);
      at[name] = override;
    }
    if (Object.keys(at).length > 0) item.at = at;
  }

  if (ctx.withData && chance(rng, 0.6)) {
    item.data = { kind: pick(rng, ['chart', 'table', 'kpi'] as const), n: int(rng, 0, 999) };
  }
  if (ctx.withUnknown) {
    item.$unknown = { futureAnchor: 'diagonal', futureDepth: int(rng, 0, 9) };
  }

  return item;
}

/** A `Len` in one of the three canonical shapes (px, pct, both). */
export function randomLen(rng: Rng, extent: number): Len {
  const roll = rng();
  if (roll < 0.45) return r2(rng() * extent);
  if (roll < 0.8) return { pct: r4(rng() * 100) };
  return { pct: r4(rng() * 100), px: r2((rng() - 0.5) * 200) };
}

/** An `AxisPlacement` in a randomly chosen (allowed) mode. */
export function randomPlacement(
  rng: Rng,
  extent: number,
  modes: readonly AxisMode[],
): AxisPlacement {
  const mode = pick(rng, modes);
  if (mode === 'both') {
    return { mode, start: randomLen(rng, extent), end: randomLen(rng, extent) };
  }
  return { mode, offset: randomLen(rng, extent), size: randomLen(rng, extent) };
}

const KEY_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A plausible base-62 fractional key (ordering is not guaranteed — by design). */
export function randomKey(rng: Rng): string {
  const len = int(rng, 1, 4);
  let out = '';
  for (let i = 0; i < len; i++) out += KEY_ALPHABET[int(rng, 0, KEY_ALPHABET.length - 1)];
  return out;
}

/**
 * A normalized document — the canonical form the laws are stated over.
 * Normalizing here means the generator is a fixpoint of `normalize` by
 * construction, so L1 measures the load/serialize round trip and nothing else.
 *
 * Note for other modules: functions pinned to `LayoutDoc<never>` (such as
 * `emitStylesheet`) will not accept `LayoutDoc<unknown>` directly. Generate
 * with `{ withData: false }` and cast — the document then carries no `data`
 * at all, so the cast is sound.
 *
 * The generated `z` keys come from the fractional-key generator, which jitters
 * its output: two calls with the same seed produce the same GEOMETRY but not
 * necessarily the same keys. Compare documents modulo `z` if you need
 * byte-level determinism, or use {@link randomRawDoc}, which is pure.
 */
export function randomDoc(seed: number | Rng, opts: RandomDocOptions = {}): LayoutDoc<unknown> {
  return normalize<unknown>(randomRawDoc(seed, opts));
}

/**
 * Adds forward-compat payloads to a raw document: stray keys at the document
 * and item level (which park into `$unknown`) plus pre-parked `$unknown`
 * entries. Returns a new object; the input is not mutated.
 */
export function injectUnknown(
  raw: Record<string, unknown>,
  payload: Record<string, unknown> = { futureMode: 'orbital', futureNums: [2, 1] },
): Record<string, unknown> {
  const items = Array.isArray(raw.items) ? raw.items : [];
  return {
    ...raw,
    ...payload,
    $unknown: { parkedEarlier: 1, ...(typeof raw.$unknown === 'object' ? raw.$unknown : {}) },
    items: items.map((item, i) =>
      typeof item === 'object' && item !== null
        ? { ...(item as Record<string, unknown>), futureItemKey: `f${i}`, $unknown: { parkedItem: i } }
        : item,
    ),
  };
}
