/**
 * Sparse integer z-index ranks derived from fractional z-keys.
 *
 * The persisted order lives in each item's fractional `z` string
 * ({@link ./fractional.ts}); `createZRanker` turns a z-sorted list of
 * `{ id, z }` pairs into a `Map<id, integer>` suitable for CSS `z-index`.
 * Ranks start sparse (gap 1024) so that inserting one item between two
 * others only has to touch that one item — everyone else's rank is
 * `strictly` preserved across calls to `update`, unless a local neighborhood
 * has run out of integers between two neighbors and must be rebalanced.
 *
 * Stability is the whole point: a naive "just re-enumerate 1..n every time"
 * dense rank would bump the CSS `z-index` (and therefore invalidate) of
 * every single item whenever any one item moved in z-order. This module
 * instead computes the *longest run of ids whose old ranks are already
 * consistent with the new order* (a longest-increasing-subsequence problem)
 * and keeps exactly those ranks; only the ids that fell out of that run get
 * freshly assigned ranks, and only the smallest possible neighborhood is
 * touched when a rebalance is unavoidable.
 */

/** Starting/typical gap between neighboring ranks. */
const INITIAL_GAP = 1024;

/** One entry of the ordered input to {@link createZRanker}'s `update`. */
export interface ZOrderEntry {
  id: string;
  z: string;
}

/** Return shape of {@link createZRanker}. */
export interface ZRanker {
  /**
   * Recomputes ranks for the complete, already z-sorted `{ id, z }` list.
   * Returns the full `id -> rank` map; unchanged neighborhoods keep their
   * exact previous ranks.
   */
  update(sorted: ReadonlyArray<ZOrderEntry>): ReadonlyMap<string, number>;
}

/**
 * Computes, for each position in `values`, whether the existing value at
 * that position can be kept (i.e. participates in *a* longest strictly
 * increasing subsequence of the defined values). `undefined` entries (ids
 * with no previous rank) are never keepable.
 *
 * O(n log n) patience-sorting LIS with predecessor reconstruction.
 */
function longestIncreasingKeepMask(values: ReadonlyArray<number | undefined>): boolean[] {
  const n = values.length;
  const keep = new Array<boolean>(n).fill(false);

  // tailIndex[k] = index (into `values`) of the smallest possible tail value
  // for an increasing subsequence of length k+1 found so far.
  const tailIndex: number[] = [];
  const tailValue: number[] = [];
  const predecessor = new Array<number>(n).fill(-1);

  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v === undefined) continue;
    // First index in tailValue with value >= v (strict increase => replace).
    let lo = 0;
    let hi = tailValue.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tailValue[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) predecessor[i] = tailIndex[lo - 1];
    if (lo === tailValue.length) {
      tailValue.push(v);
      tailIndex.push(i);
    } else {
      tailValue[lo] = v;
      tailIndex[lo] = i;
    }
  }

  let cursor = tailIndex.length > 0 ? tailIndex[tailIndex.length - 1] : -1;
  while (cursor !== -1) {
    keep[cursor] = true;
    cursor = predecessor[cursor];
  }
  return keep;
}

/**
 * Assigns `runLen` fresh ranks strictly between `lowerRank` (exclusive) and
 * `upperRank` (exclusive) for `ids[start .. start+runLen)`, writing into
 * `out`. Either bound may be `undefined` for an open end — an open end is
 * *never* treated as a nearby fixed sentinel (e.g. `0`) to halve toward:
 * doing that would make repeated single-item inserts at the same open end
 * (the canonical `bringToFront`/`sendToBack` access pattern) converge on an
 * unreachable floor/ceiling within a handful of calls and then need an
 * ever-larger rebalance on every subsequent call — precisely the failure
 * mode {@link ./fractional.ts}'s tiered integer encoding exists to
 * avoid for z-*keys*, and the reason ranks mirror that choice here: an open
 * end always grows *away* from its single real boundary by a fresh
 * {@link INITIAL_GAP} per member, so consecutive same-end operations each
 * touch only the one id being moved, indefinitely.
 */
function assignRun(
  out: Map<string, number>,
  ids: readonly string[],
  start: number,
  runLen: number,
  lowerRank: number | undefined,
  upperRank: number | undefined,
): void {
  if (lowerRank === undefined && upperRank === undefined) {
    // Only possible on the very first-ever assignment (nothing kept at
    // all): baseline at 0 and grow upward, matching spec §5's "first
    // update assigns ranks 1024, 2048, ...".
    let r = 0;
    for (let k = 0; k < runLen; k++) {
      r += INITIAL_GAP;
      out.set(ids[start + k], r);
    }
    return;
  }
  if (upperRank === undefined) {
    let r = lowerRank as number;
    for (let k = 0; k < runLen; k++) {
      r += INITIAL_GAP;
      out.set(ids[start + k], r);
    }
    return;
  }
  if (lowerRank === undefined) {
    // Mirror image of the open-upper branch: grow downward from
    // upperRank, filling back-to-front so the id closest to upperRank
    // lands closest to it.
    let r = upperRank;
    for (let k = runLen - 1; k >= 0; k--) {
      r -= INITIAL_GAP;
      out.set(ids[start + k], r);
    }
    return;
  }
  const span = upperRank - lowerRank;
  // Widening (below) guarantees span >= runLen + 1, i.e. at least one free
  // integer per run member, so this is always >= 1. It is frequently much
  // more: widening jumps straight to the next surviving fixed neighbor, and
  // that neighbor is usually far enough away that the gap ends up generous.
  const gap = Math.floor(span / (runLen + 1));
  let r = lowerRank;
  for (let k = 0; k < runLen; k++) {
    r += gap;
    out.set(ids[start + k], r);
  }
}

/**
 * Given the boolean keep-mask from {@link longestIncreasingKeepMask}, widens
 * it in place wherever a run of non-kept positions has genuinely run out of
 * integers — i.e. "gap exhaustion" per spec §5: no integer left strictly
 * between the run's two kept neighbors for every member of the run to get
 * its own rank. This is a *hard* correctness requirement (`span >= runLen +
 * 1`), not a soft comfort target: packing at gap 1 is valid and cheaper than
 * rebalancing, so we only widen when gap 1 packing itself would be
 * impossible. Widening demotes the tighter-adjacent kept neighbor (evicting
 * it back into the run to be reassigned too) and retries — the smallest
 * local neighborhood that restores a fitting gap; nothing further out is
 * ever touched. In practice the neighbor a widen jumps to is usually far
 * enough away that the eventual assigned gap ends up generously above the
 * bare minimum anyway (see {@link assignRun}).
 *
 * A run with an *open* end (no kept neighbor on that side, i.e. it reaches
 * the start or end of the list) never needs widening on that side — an open
 * end has unbounded room by construction (see {@link assignRun}) — so
 * widening only ever triggers for a run pinned between two real kept
 * neighbors on both sides.
 */
function widenUntilRoomy(keep: boolean[], rankOf: ReadonlyArray<number | undefined>): void {
  const n = keep.length;
  let changed = true;
  while (changed) {
    changed = false;
    let i = 0;
    while (i < n) {
      if (keep[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < n && !keep[j]) j++;
      const runLen = j - i;
      if (i > 0 && j < n) {
        const lowerRank = rankOf[i - 1] as number;
        const upperRank = rankOf[j] as number;
        const span = upperRank - lowerRank;
        if (span < runLen + 1) {
          // Demote the right-side neighbor (grows the run rightward); if
          // there is none further right this also naturally terminates
          // because j reaches n and the run becomes open-ended.
          keep[j] = false;
          changed = true;
        }
      }
      i = j;
    }
  }
}

/**
 * Creates a stateful sparse z-ranker. Each call to `update` receives the
 * *complete*, already z-sorted `{ id, z }` list and returns the full
 * `id -> rank` map for that state. Ranks are strictly increasing in input
 * order; an id whose position relative to its neighbors is unchanged from
 * the previous call keeps the exact same rank.
 */
export function createZRanker(): ZRanker {
  let ranks: ReadonlyMap<string, number> = new Map();

  function update(sorted: ReadonlyArray<ZOrderEntry>): ReadonlyMap<string, number> {
    const n = sorted.length;
    if (n === 0) {
      ranks = new Map();
      return ranks;
    }

    const ids = sorted.map((e) => e.id);
    const prev = ranks;
    const oldRankInNewOrder = ids.map((id) => prev.get(id));

    const keep = longestIncreasingKeepMask(oldRankInNewOrder);
    widenUntilRoomy(keep, oldRankInNewOrder);

    const next = new Map<string, number>();
    let i = 0;
    while (i < n) {
      if (keep[i]) {
        next.set(ids[i], oldRankInNewOrder[i] as number);
        i++;
        continue;
      }
      let j = i;
      while (j < n && !keep[j]) j++;
      const runLen = j - i;
      const lowerRank = i > 0 ? (oldRankInNewOrder[i - 1] as number) : undefined;
      const upperRank = j < n ? (oldRankInNewOrder[j] as number) : undefined;
      assignRun(next, ids, i, runLen, lowerRank, upperRank);
      i = j;
    }

    ranks = next;
    return ranks;
  }

  return { update };
}
