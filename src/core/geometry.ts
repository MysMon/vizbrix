import { BASE, type Breakpoint, type DashboardDoc, type DashboardItem, type Pin, type Rect } from './types';

/**
 * One concrete arrangement of the dashboard: the base layout, or the layout
 * used below a breakpoint.
 */
export interface Variant {
  name: string;
  /** Design width the rects are expressed against. */
  width: number;
  /** Container width at or below which this variant applies; null for base. */
  maxWidth: number | null;
  rects: ReadonlyMap<string, Rect>;
  /** Bottom edge of the lowest tile, design units. */
  height: number;
  /** True when the rects were derived by the flow algorithm, not hand-placed. */
  auto: boolean;
}

/** Everything needed to turn a tile rect into pixels at a container width. */
export interface Frame {
  /** Design width. */
  d: number;
  gap: number;
  padding: number;
  /** Container width in px. */
  container: number;
}

const cache = new WeakMap<object, Map<string, Variant>>();

type AnyDoc = DashboardDoc<unknown>;

export function variantNames(doc: AnyDoc): string[] {
  return [BASE, ...doc.breakpoints.map((b) => b.name)];
}

/** Which variant applies at a container width. */
export function activeVariant(doc: AnyDoc, containerWidth: number): string {
  let name = BASE;
  // Breakpoints are sorted largest first; the last match is the tightest.
  for (const bp of doc.breakpoints) {
    if (containerWidth <= bp.maxWidth) name = bp.name;
  }
  return name;
}

export function resolveVariant(doc: AnyDoc, name: string): Variant {
  let perDoc = cache.get(doc);
  if (!perDoc) {
    perDoc = new Map();
    cache.set(doc, perDoc);
  }
  const hit = perDoc.get(name);
  if (hit) return hit;

  const bp = doc.breakpoints.find((b) => b.name === name);
  let variant: Variant;
  if (!bp) {
    const rects = new Map<string, Rect>();
    let height = 0;
    for (const item of doc.items) {
      rects.set(item.id, { x: item.x, y: item.y, w: item.w, h: item.h });
      height = Math.max(height, item.y + item.h);
    }
    variant = { name: BASE, width: doc.width, maxWidth: null, rects, height, auto: false };
  } else {
    const manual = doc.layouts[bp.name];
    const rects = new Map<string, Rect>();
    let height = 0;
    const missing: DashboardItem<unknown>[] = [];
    if (manual) {
      for (const item of doc.items) {
        const rect = manual[item.id];
        if (rect) {
          rects.set(item.id, rect);
          height = Math.max(height, rect.y + rect.h);
        } else {
          missing.push(item);
        }
      }
    }
    // Bricks without a hand-placed rect (all of them when there is no manual
    // layout; newly added ones otherwise) flow in below what is already there.
    const flowed = flowLayout(manual ? missing : doc.items, doc.width, bp, height);
    for (const [id, rect] of flowed) {
      rects.set(id, rect);
      height = Math.max(height, rect.y + rect.h);
    }
    variant = { name: bp.name, width: bp.maxWidth, maxWidth: bp.maxWidth, rects, height, auto: !manual };
  }
  perDoc.set(name, variant);
  return variant;
}

/** Order bricks the way a person reads them: row by row, left to right. */
export function readingOrder<T extends Rect>(items: readonly T[]): T[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: T[] = [];
  let row: T[] = [];
  let rowLimit = 0;
  const flush = (): void => {
    row.sort((a, b) => a.x - b.x || a.y - b.y);
    out.push(...row);
    row = [];
  };
  for (const item of sorted) {
    // A brick belongs to the current visual row while it starts above the
    // bottom of the shortest brick in that row.
    if (row.length && item.y >= rowLimit - 0.5) flush();
    rowLimit = row.length ? Math.min(rowLimit, item.y + item.h) : item.y + item.h;
    row.push(item);
  }
  flush();
  return out;
}

/**
 * Derive a compact layout: bricks in reading order, packed into rows of
 * `columns` equal columns. A brick's span is its share of the design width;
 * a row that would end ragged stretches its last brick, and bricks in one row
 * share the row's height so the result reads as a tidy grid.
 */
export function flowLayout(
  items: readonly DashboardItem<unknown>[],
  designWidth: number,
  bp: Breakpoint,
  startY = 0,
): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const k = bp.columns;
  const colW = bp.maxWidth / k;
  let y = startY;
  let row: { id: string; span: number; h: number }[] = [];
  let used = 0;

  const flush = (): void => {
    if (!row.length) return;
    const last = row[row.length - 1]!;
    last.span += k - used;
    const h = Math.max(...row.map((r) => r.h));
    let col = 0;
    for (const entry of row) {
      out.set(entry.id, { x: round(col * colW), y, w: round(entry.span * colW), h });
      col += entry.span;
    }
    y += h;
    row = [];
    used = 0;
  };

  for (const item of readingOrder(items)) {
    const span = Math.max(1, Math.min(k, Math.round((item.w / designWidth) * k)));
    if (used + span > k) flush();
    row.push({ id: item.id, span, h: item.h });
    used += span;
    if (used === k) flush();
  }
  flush();
  return out;
}

const round = (n: number): number => Math.round(n * 100) / 100;

export function frameFor(doc: AnyDoc, variant: Variant, containerWidth: number): Frame {
  return { d: variant.width, gap: doc.gap, padding: doc.padding, container: containerWidth };
}

/** Px per design unit for bricks that scale with the container. */
export function frameScale(frame: Frame): number {
  return (frame.container + frame.gap - 2 * frame.padding) / frame.d;
}

/**
 * Horizontal geometry as an affine function of the container width:
 * `left = la·W + lb`, `width = wa·W + wb`. This is what makes the layout
 * expressible as static CSS (`calc(la·100% + lb px)`), so the server can
 * render a correct first paint without knowing the viewport.
 */
export interface Affine {
  la: number;
  lb: number;
  wa: number;
  wb: number;
}

export function affine(rect: Rect, pin: Pin, d: number, gap: number, padding: number): Affine {
  const k = gap - 2 * padding;
  const r = d - rect.x - rect.w;
  switch (pin) {
    case 'left':
      return { la: 0, lb: padding + rect.x, wa: 0, wb: rect.w - gap };
    case 'right':
      return { la: 1, lb: gap - padding - r - rect.w, wa: 0, wb: rect.w - gap };
    case 'stretch':
      return { la: 0, lb: padding + rect.x, wa: 1, wb: -2 * padding - rect.x - r };
    case 'center':
      return { la: 0.5, lb: rect.x + gap / 2 - d / 2, wa: 0, wb: rect.w - gap };
    default: {
      const fx = rect.x / d;
      const fw = rect.w / d;
      return { la: fx, lb: padding + fx * k, wa: fw, wb: fw * k - gap };
    }
  }
}

/** The visible pixel box of a tile at the frame's container width. */
export function toPixels(rect: Rect, pin: Pin, frame: Frame): Rect {
  const a = affine(rect, pin, frame.d, frame.gap, frame.padding);
  return {
    x: a.la * frame.container + a.lb,
    y: frame.padding + rect.y,
    w: Math.max(0, a.wa * frame.container + a.wb),
    h: Math.max(0, rect.h - frame.gap),
  };
}

/** Inverse of `toPixels`: the tile rect that renders as the given pixel box. */
export function fromPixels(px: Rect, pin: Pin, frame: Frame): Rect {
  const { d, gap, padding, container } = frame;
  const y = px.y - padding;
  const h = px.h + gap;
  switch (pin) {
    case 'left':
      return { x: px.x - padding, y, w: px.w + gap, h };
    case 'right': {
      const w = px.w + gap;
      const r = container - padding - px.x - px.w;
      return { x: d - r - w, y, w, h };
    }
    case 'stretch': {
      const x = px.x - padding;
      const r = container - padding - (px.x + px.w);
      return { x, y, w: d - x - r, h };
    }
    case 'center': {
      const w = px.w + gap;
      return { x: px.x + px.w / 2 - container / 2 + d / 2 - w / 2, y, w, h };
    }
    default: {
      const s = frameScale(frame);
      return { x: (px.x - padding) / s, y, w: (px.w + gap) / s, h };
    }
  }
}

/** Pin used inside a variant: breakpoints always scale. */
export function pinIn(variant: Variant, item: { pin?: Pin }): Pin {
  return variant.maxWidth === null ? (item.pin ?? 'scale') : 'scale';
}

const num = (n: number): string => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

function affineCss(a: number, b: number): string {
  if (a === 0) return `${num(b)}px`;
  const pct = `${num(a * 100)}%`;
  if (Math.abs(b) < 0.0005) return pct;
  return `calc(${pct} ${b < 0 ? '-' : '+'} ${num(Math.abs(b))}px)`;
}

/** Escape a value for use inside a double-quoted CSS string in a <style> tag. */
export function cssString(value: string): string {
  return value.replace(/[\\"<>&\n\r\f]/g, (ch) => `\\${ch.charCodeAt(0).toString(16)} `);
}

function variantCss(doc: AnyDoc, variant: Variant, scope: string): string {
  let css = `${scope}>.vbx-canvas{height:${num(Math.max(0, variant.height + 2 * doc.padding - doc.gap))}px}`;
  for (const item of doc.items) {
    const rect = variant.rects.get(item.id);
    if (!rect) continue;
    const a = affine(rect, pinIn(variant, item), variant.width, doc.gap, doc.padding);
    css +=
      `${scope}>.vbx-canvas>[data-vbx-item="${cssString(item.id)}"]{` +
      `left:${affineCss(a.la, a.lb)};top:${num(doc.padding + rect.y)}px;` +
      `width:${affineCss(a.wa, a.wb)};height:${num(Math.max(0, rect.h - doc.gap))}px}`;
  }
  return css;
}

/**
 * Compile the whole document — every variant — to a static stylesheet.
 * Breakpoints become container queries against the dashboard's own width, so
 * a dashboard in a sidebar or split pane responds to the space it actually
 * has, and no JavaScript runs to lay anything out.
 *
 * `scopeId` must match the `data-vbx-scope` attribute on the viewport element.
 */
export function compileCss(doc: AnyDoc, scopeId: string): string {
  const scope = `[data-vbx-scope="${cssString(scopeId)}"]`;
  let css = variantCss(doc, resolveVariant(doc, BASE), scope);
  for (const bp of doc.breakpoints) {
    css += `@container vbx (max-width:${num(bp.maxWidth)}px){${variantCss(doc, resolveVariant(doc, bp.name), scope)}}`;
  }
  return css;
}

export function rectsEqual(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
}
