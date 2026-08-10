/**
 * Affine length arithmetic.
 *
 * A `Len` is `(pct/100)·W + px` — the only expression shape vizbrix stores.
 * It is deliberately isomorphic to CSS `calc(P% + Xpx)` and to a single row of
 * a linear constraint system, which is what makes resolution pure, total and
 * measurement-free.
 */

import type { Len } from '../schema/types';

/** Coerce anything to a finite number; non-finite input collapses to 0. */
function finite(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/** Normalize `-0` to `0` so serialized JSON and equality checks stay clean. */
function zero(n: number): number {
  return n === 0 ? 0 : n;
}

/**
 * Split a `Len` into its percentage and pixel terms.
 *
 * Total by construction: malformed input (undefined fields, NaN, strings from
 * hand-edited JSON) degrades to `0` rather than propagating NaN through the
 * whole layout.
 *
 * @internal Shared by resolve/reencode/css; not part of the documented API.
 */
export function lenParts(len: Len | undefined): { pct: number; px: number } {
  if (typeof len === 'number') return { pct: 0, px: finite(len) };
  if (len && typeof len === 'object') {
    return { pct: finite(len.pct), px: finite(len.px) };
  }
  return { pct: 0, px: 0 };
}

/**
 * Evaluate a `Len` against a container extent: `pct/100 · extent + px`.
 *
 * @param len    the affine length
 * @param extent container extent on the same axis, in px
 */
export function lenAt(len: Len, extent: number): number {
  const { pct, px } = lenParts(len);
  if (pct === 0) return px;
  return (pct / 100) * finite(extent) + px;
}

/**
 * Canonical `Len` form: zero terms are stripped and a pure-pixel length
 * collapses to a bare number. Canonicalization is value-preserving —
 * `lenAt(canonLen(l), W) === lenAt(l, W)` for every W.
 *
 * `{pct: 0, px: 12}` → `12`, `{px: 0, pct: 25}` → `{pct: 25}`, `{}` → `0`.
 */
export function canonLen(len: Len): Len {
  const { pct, px } = lenParts(len);
  if (pct === 0) return zero(px);
  if (px === 0) return { pct: zero(pct) };
  return { pct: zero(pct), px: zero(px) };
}

/**
 * Round a pixel term to 2 decimals (the persisted px precision).
 *
 * @internal
 */
export function roundPx(n: number): number {
  return zero(Math.round(finite(n) * 100) / 100);
}

/**
 * Round a percentage term to 4 decimals (the persisted pct precision).
 *
 * @internal
 */
export function roundPct(n: number): number {
  return zero(Math.round(finite(n) * 1e4) / 1e4);
}
