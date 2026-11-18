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

export { BASE };
