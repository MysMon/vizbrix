import { createId } from './doc';
import { intersects, rectsEqual, resolveVariant } from './geometry';
import { BASE, DEFAULTS, type DashboardDoc, type DashboardItem, type Rect } from './types';

/**
 * Pure document transforms. Every function returns a new document, or the
 * *same* document when nothing changed — callers rely on identity to skip
 * history entries and re-renders.
 */

type Doc = DashboardDoc<unknown>;
type Item = DashboardItem<unknown>;

const roundUnit = (n: number): number => Math.round(n);

/** Clamp a rect to the canvas and the brick's minimum size; snap to whole units. */
export function constrainRect(rect: Rect, item: { minW?: number; minH?: number }, width: number): Rect {
  const minW = Math.min(item.minW ?? DEFAULTS.minW, width);
  const minH = item.minH ?? DEFAULTS.minH;
  const w = roundUnit(Math.min(width, Math.max(minW, rect.w)));
  const h = roundUnit(Math.max(minH, rect.h));
  const x = roundUnit(Math.min(width - w, Math.max(0, rect.x)));
  const y = roundUnit(Math.max(0, rect.y));
  return { x, y, w, h };
}

/**
 * Apply new rects in a variant. In the base variant this rewrites the items;
 * in a breakpoint the first edit materialises the derived layout into
 * `doc.layouts`, so from then on that breakpoint is arranged by hand.
 */
export function setRects(doc: Doc, variantName: string, updates: Readonly<Record<string, Rect>>): Doc {
  const variant = resolveVariant(doc, variantName);
  const byId = new Map(doc.items.map((item) => [item.id, item]));
  const next: Record<string, Rect> = {};
  let changed = false;
  for (const id of Object.keys(updates)) {
    const item = byId.get(id);
    const current = variant.rects.get(id);
    if (!item || !current) continue;
    const rect = constrainRect(updates[id]!, item, variant.width);
    if (!rectsEqual(rect, current)) {
      next[id] = rect;
      changed = true;
    }
  }
  if (!changed) return doc;

  if (variant.maxWidth === null) {
    return { ...doc, items: doc.items.map((item) => (next[item.id] ? { ...item, ...next[item.id] } : item)) };
  }
  const layout: Record<string, Rect> = {};
  for (const [id, rect] of variant.rects) layout[id] = next[id] ?? rect;
  return { ...doc, layouts: { ...doc.layouts, [variant.name]: layout } };
}

/** Drop a breakpoint's hand-arranged layout and return to the derived one. */
export function resetVariant(doc: Doc, variantName: string): Doc {
  if (!(variantName in doc.layouts)) return doc;
  const layouts = { ...doc.layouts };
  delete layouts[variantName];
  return { ...doc, layouts };
}

/** First spot, scanning in reading order, where a w×h tile overlaps nothing. */
export function findFreeSpot(doc: Doc, w: number, h: number): { x: number; y: number } {
  const width = doc.width;
  const size = Math.min(w, width);
  const xs = new Set<number>([0]);
  const ys = new Set<number>([0]);
  let bottom = 0;
  for (const item of doc.items) {
    xs.add(item.x + item.w);
    ys.add(item.y + item.h);
    ys.add(item.y);
    bottom = Math.max(bottom, item.y + item.h);
  }
  const sortedX = [...xs].filter((x) => x + size <= width + 0.01).sort((a, b) => a - b);
  for (const y of [...ys].sort((a, b) => a - b)) {
    for (const x of sortedX) {
      const candidate = { x, y, w: size, h };
      if (!doc.items.some((item) => intersects(candidate, item))) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

export type NewItem = Partial<Item> & { type: string };

/** Add a brick. Without a position it lands in the first free spot. */
export function addItem(doc: Doc, input: NewItem): { doc: Doc; id: string } {
  const id = input.id && !doc.items.some((i) => i.id === input.id) ? input.id : createId();
  const w = Math.min(doc.width, input.w ?? DEFAULTS.itemW);
  const h = input.h ?? DEFAULTS.itemH;
  const spot = input.x !== undefined && input.y !== undefined ? { x: input.x, y: input.y } : findFreeSpot(doc, w, h);
  const draft = { ...input, id } as Item;
  const item: Item = { ...draft, ...constrainRect({ ...spot, w, h }, draft, doc.width) };
  return { doc: { ...doc, items: [...doc.items, item] }, id };
}

export function removeItems(doc: Doc, ids: readonly string[]): Doc {
  const drop = new Set(ids);
  const items = doc.items.filter((item) => !drop.has(item.id) || item.locked);
  if (items.length === doc.items.length) return doc;
  const kept = new Set(items.map((i) => i.id));
  const layouts: Record<string, Record<string, Rect>> = {};
  for (const name of Object.keys(doc.layouts)) {
    const rects: Record<string, Rect> = {};
    for (const id of Object.keys(doc.layouts[name]!)) {
      if (kept.has(id)) rects[id] = doc.layouts[name]![id]!;
    }
    layouts[name] = rects;
  }
  return { ...doc, items, layouts };
}

/** Duplicate bricks; each copy lands in the nearest free spot. */
export function duplicateItems(doc: Doc, ids: readonly string[]): { doc: Doc; ids: string[] } {
  let next = doc;
  const created: string[] = [];
  for (const id of ids) {
    const source = next.items.find((item) => item.id === id);
    if (!source) continue;
    const copy: NewItem = { ...source, id: undefined, x: undefined, y: undefined };
    delete copy.locked;
    const result = addItem(next, copy);
    next = result.doc;
    created.push(result.id);
  }
  return { doc: next, ids: created };
}

export type ItemPatch = Partial<Omit<Item, 'id'>>;

/** Shallow-merge a patch into a brick. `undefined` values remove the key. */
export function updateItem(doc: Doc, id: string, patch: ItemPatch): Doc {
  const index = doc.items.findIndex((item) => item.id === id);
  if (index < 0) return doc;
  const current = doc.items[index]!;
  const merged = { ...current, ...patch } as Record<string, unknown>;
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  if (merged.pin === 'scale') delete merged.pin;
  if (merged.locked === false) delete merged.locked;
  const item = { ...(merged as unknown as Item), ...constrainRect(merged as unknown as Item, merged as unknown as Item, doc.width) };
  const keys = new Set([...Object.keys(current), ...Object.keys(item)]);
  let same = true;
  for (const key of keys) {
    if ((current as unknown as Record<string, unknown>)[key] !== (item as unknown as Record<string, unknown>)[key]) {
      same = false;
      break;
    }
  }
  if (same) return doc;
  const items = [...doc.items];
  items[index] = item;
  return { ...doc, items };
}

/** Change paint order. */
export function reorderItem(doc: Doc, id: string, to: 'front' | 'back'): Doc {
  const index = doc.items.findIndex((item) => item.id === id);
  if (index < 0) return doc;
  const target = to === 'front' ? doc.items.length - 1 : 0;
  if (index === target) return doc;
  const items = [...doc.items];
  const [item] = items.splice(index, 1);
  if (to === 'front') items.push(item!);
  else items.unshift(item!);
  return { ...doc, items };
}

export type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' | 'distributeX' | 'distributeY';

/** Align bricks to their common bounding box, or space them evenly along an axis. */
export function alignRects(rects: Readonly<Record<string, Rect>>, mode: AlignMode): Record<string, Rect> {
  const ids = Object.keys(rects);
  const out: Record<string, Rect> = {};
  if (ids.length < 2) return { ...rects };
  const list = ids.map((id) => rects[id]!);
  const left = Math.min(...list.map((r) => r.x));
  const right = Math.max(...list.map((r) => r.x + r.w));
  const top = Math.min(...list.map((r) => r.y));
  const bottom = Math.max(...list.map((r) => r.y + r.h));

  if (mode === 'distributeX' || mode === 'distributeY') {
    const horizontal = mode === 'distributeX';
    const pos = (r: Rect): number => (horizontal ? r.x : r.y);
    const len = (r: Rect): number => (horizontal ? r.w : r.h);
    const sorted = [...ids].sort((a, b) => pos(rects[a]!) - pos(rects[b]!));
    const span = (horizontal ? right - left : bottom - top) - list.reduce((sum, r) => sum + len(r), 0);
    const gap = span / (sorted.length - 1);
    let cursor = horizontal ? left : top;
    for (const id of sorted) {
      const r = rects[id]!;
      out[id] = horizontal ? { ...r, x: Math.round(cursor) } : { ...r, y: Math.round(cursor) };
      cursor += len(r) + gap;
    }
    return out;
  }

  for (const id of ids) {
    const r = rects[id]!;
    switch (mode) {
      case 'left':
        out[id] = { ...r, x: left };
        break;
      case 'right':
        out[id] = { ...r, x: right - r.w };
        break;
      case 'centerX':
        out[id] = { ...r, x: Math.round((left + right) / 2 - r.w / 2) };
        break;
      case 'top':
        out[id] = { ...r, y: top };
        break;
      case 'bottom':
        out[id] = { ...r, y: bottom - r.h };
        break;
      default:
        out[id] = { ...r, y: Math.round((top + bottom) / 2 - r.h / 2) };
    }
  }
  return out;
}

/**
 * The position closest to `rect` where it overlaps none of `others`.
 * Candidates are the rect's own position and every spot flush against an
 * edge of another brick, so the result always sits neatly beside something.
 */
export function nearestFreeRect(rect: Rect, others: readonly Rect[], width: number): Rect {
  if (!others.some((o) => intersects(rect, o))) return rect;
  const clampX = (x: number): number => Math.min(Math.max(0, width - rect.w), Math.max(0, x));
  const xs = new Set<number>([clampX(rect.x)]);
  const ys = new Set<number>([Math.max(0, rect.y)]);
  let bottom = 0;
  for (const o of others) {
    xs.add(clampX(o.x + o.w));
    xs.add(clampX(o.x - rect.w));
    ys.add(o.y + o.h);
    if (o.y - rect.h >= 0) ys.add(o.y - rect.h);
    bottom = Math.max(bottom, o.y + o.h);
  }
  let best: Rect = { ...rect, x: clampX(rect.x), y: bottom };
  let bestDist = Infinity;
  for (const y of ys) {
    for (const x of xs) {
      const dist = (x - rect.x) ** 2 + (y - rect.y) ** 2;
      if (dist >= bestDist) continue;
      const candidate = { x, y, w: rect.w, h: rect.h };
      if (!others.some((o) => intersects(candidate, o))) {
        best = candidate;
        bestDist = dist;
      }
    }
  }
  return best;
}

/**
 * Apply the "no overlap" policy to a set of new rects. Moved bricks shift,
 * as a group, to the nearest free position; a resize that would cover a
 * neighbour is refused (returns null).
 */
export function resolveOverlap(
  doc: Doc,
  variantName: string,
  updates: Readonly<Record<string, Rect>>,
  reason: 'move' | 'resize',
): Record<string, Rect> | null {
  const variant = resolveVariant(doc, variantName);
  const byId = new Map(doc.items.map((item) => [item.id, item]));
  const moved: Record<string, Rect> = {};
  for (const id of Object.keys(updates)) {
    const item = byId.get(id);
    if (item && variant.rects.has(id)) moved[id] = constrainRect(updates[id]!, item, variant.width);
  }
  const ids = Object.keys(moved);
  if (!ids.length) return moved;
  const others: Rect[] = [];
  for (const [id, rect] of variant.rects) if (!(id in moved)) others.push(rect);
  const clash = ids.some((id) => others.some((o) => intersects(moved[id]!, o)));
  if (!clash) return moved;
  if (reason === 'resize') return null;

  const x = Math.min(...ids.map((id) => moved[id]!.x));
  const y = Math.min(...ids.map((id) => moved[id]!.y));
  const box = {
    x,
    y,
    w: Math.max(...ids.map((id) => moved[id]!.x + moved[id]!.w)) - x,
    h: Math.max(...ids.map((id) => moved[id]!.y + moved[id]!.h)) - y,
  };
  // A group is placed by its bounding box: simple, and it keeps the group's shape.
  const free = nearestFreeRect(box, others, variant.width);
  const out: Record<string, Rect> = {};
  for (const id of ids) out[id] = { ...moved[id]!, x: moved[id]!.x + free.x - x, y: moved[id]!.y + free.y - y };
  return out;
}

/** Add copies of bricks (new ids, first free spots). Used by paste. */
export function pasteItems(doc: Doc, items: readonly Item[]): { doc: Doc; ids: string[] } {
  let next = doc;
  const ids: string[] = [];
  for (const source of items) {
    const copy: NewItem = { ...source, id: undefined, x: undefined, y: undefined };
    delete copy.locked;
    const result = addItem(next, copy);
    next = result.doc;
    ids.push(result.id);
  }
  return { doc: next, ids };
}

export { BASE };
