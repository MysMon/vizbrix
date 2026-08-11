/**
 * Static CSS emission — the whole truth for layout at rest.
 *
 * Every placement in the document is an affine expression, and every affine
 * expression is a `calc(P% + Xpx)`, so the layout is fully expressible as a
 * stylesheet: first paint is correct with zero JavaScript, and SSR/hydration
 * cannot disagree with the client.
 *
 * Hard rules encoded here:
 * - ALL placement lives in this stylesheet. Inline `style=` would out-specify
 *   the `@container` overrides and silently break responsive layouts.
 * - `center` folds the half-size into the affine constant. Never
 *   `translate(-50%)` (transform is reserved for the drag fast path) and never
 *   a negative percentage margin (percentage margins resolve against WIDTH,
 *   so they are simply wrong on the y axis).
 * - `transform` is never written by static CSS.
 * - Every responsive block re-emits the COMPLETE property set for both axes,
 *   including explicit `auto` resets, because switching modes must undo what
 *   the previous mode set.
 * - `@container` blocks are emitted in descending `maxWidth` order, matching
 *   `activeSizesAt` exactly, so the CSS cascade and the JS fold agree.
 */

import type {
  AxisPlacement,
  ContainerConfig,
  LayoutDoc,
  LayoutItemBase,
  Len,
} from '../schema/types';
import { activeSizesAt, foldItem, stackOrder } from './cascade';
import { lenParts, roundPct, roundPx } from './len';
import { resolveAxisClamped, yExtentOf } from './resolve';

/** Gap between items in the tier-3 single-column stack, in px. */
const STACK_GAP = 8;
/** Default `stackBelow` when the container does not declare one. */
const DEFAULT_STACK_BELOW = 480;

/* ------------------------------------------------------------------ */
/* Identifier escaping (no DOM: CSS.escape is unavailable in core)     */
/* ------------------------------------------------------------------ */

/**
 * Characters that must never reach the emitted text literally.
 *
 * The stylesheet is injected into an HTML `<style>` element, which is a RAW
 * TEXT element: the HTML tokenizer does not parse escapes or entities inside
 * it, it only scans for `</style`. A document-supplied id of `</style><script>`
 * would therefore END the style element and inject markup — a stored XSS —
 * even though it is perfectly well-formed as far as CSS is concerned.
 *
 * A CSS *hex* escape (`\3c `) is the fix: the CSS parser resolves it back to
 * the literal character, so selectors keep matching, while the character never
 * appears in the text the HTML parser sees. A backslash escape (`\<`) is NOT
 * enough — it leaves the `<` literal in the text.
 */
function isHtmlUnsafe(ch: string): boolean {
  return ch === '<' || ch === '>' || ch === '&';
}

/** `\3c ` — a CSS hex escape, always space-terminated so it cannot run on. */
function hexEscape(c: number): string {
  return `\\${c.toString(16)} `;
}

/**
 * Escape a string for use as a CSS identifier — an own implementation of the
 * CSSOM `CSS.escape` algorithm, because core never touches the DOM, plus the
 * HTML-context hardening described on {@link isHtmlUnsafe}.
 *
 * Non-ASCII code points pass through (they are valid ident characters);
 * control characters, a leading digit and the HTML-significant characters are
 * hex-escaped; everything else outside `[-_a-zA-Z0-9]` gets a backslash.
 */
export function cssEscapeIdent(s: string): string {
  const str = typeof s === 'string' ? s : String(s);
  const len = str.length;
  if (len === 0) return '';
  const first = str.charCodeAt(0);
  if (len === 1 && first === 0x2d) return '\\-'; // a lone "-" is not an ident
  let out = '';
  for (let i = 0; i < len; i++) {
    const c = str.charCodeAt(i);
    if (c === 0) {
      out += '�';
    } else if (
      (c >= 0x01 && c <= 0x1f) ||
      c === 0x7f ||
      (i === 0 && c >= 0x30 && c <= 0x39) ||
      (i === 1 && c >= 0x30 && c <= 0x39 && first === 0x2d)
    ) {
      out += hexEscape(c);
    } else if (isHtmlUnsafe(str.charAt(i))) {
      out += hexEscape(c);
    } else if (
      c >= 0x80 ||
      c === 0x2d ||
      c === 0x5f ||
      (c >= 0x30 && c <= 0x39) ||
      (c >= 0x41 && c <= 0x5a) ||
      (c >= 0x61 && c <= 0x7a)
    ) {
      out += str.charAt(i);
    } else {
      out += `\\${str.charAt(i)}`;
    }
  }
  return out;
}

/**
 * Escape a string for a double-quoted CSS string (attribute selector value).
 *
 * Quotes and backslashes are backslash-escaped (they only matter to the CSS
 * parser); the HTML-significant characters are hex-escaped so the emitted text
 * can never contain a tag opener — see {@link isHtmlUnsafe}. Hex escapes are
 * resolved by the CSS parser, so `[data-vzb-item="a\3c \2f b"]` still matches
 * an element whose attribute value is literally `a</b`.
 */
function cssEscapeString(s: string): string {
  const str = typeof s === 'string' ? s : String(s);
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    const ch = str.charAt(i);
    if (c === 0) out += '�';
    else if ((c >= 0x01 && c <= 0x1f) || c === 0x7f) out += hexEscape(c);
    else if (isHtmlUnsafe(ch)) out += hexEscape(c);
    else if (ch === '"' || ch === '\\') out += `\\${ch}`;
    else out += ch;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Value formatting                                                    */
/* ------------------------------------------------------------------ */

function isNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const s = String(n === 0 ? 0 : n);
  // Rounded values only reach exponential notation at absurd magnitudes.
  return s.includes('e') ? n.toFixed(4).replace(/\.?0+$/, '') : s;
}

function px(n: number): string {
  return `${fmt(roundPx(n))}px`;
}

/**
 * A breakpoint as a container-query length — EXACT, never rounded.
 *
 * Placement values round to the persisted 2-decimal precision, but a breakpoint
 * is a comparison bound: rounding `maxWidth: 600.005` to `600.01px` would make
 * the query true over a band where `activeSizesAt` (which compares the raw
 * number) says the size is inactive, and the JS fold and the CSS cascade would
 * disagree there.
 */
function queryPx(n: number): string {
  return `${fmt(Number.isFinite(n) ? n : 0)}px`;
}

/** A `Len` as a CSS value: `12px`, `50%` or `calc(50% + 12px)`. */
function lenExpr(len: Len | undefined): string {
  const parts = lenParts(len);
  const p = roundPct(parts.pct);
  const x = roundPx(parts.px);
  if (p === 0 && x === 0) return '0px';
  if (p === 0) return `${fmt(x)}px`;
  if (x === 0) return `${fmt(p)}%`;
  return `calc(${fmt(p)}% ${x < 0 ? '-' : '+'} ${fmt(Math.abs(x))}px)`;
}

/** Strip one level of `calc()` so the expression can be nested. */
function inner(expr: string): string {
  return expr.startsWith('calc(') && expr.endsWith(')') ? expr.slice(5, -1) : expr;
}

/**
 * Size expression with the item's limits folded in.
 *
 * CSS `clamp(MIN, VAL, MAX)` is `max(MIN, min(VAL, MAX))` — the minimum wins
 * over a smaller maximum, exactly like `resolveItem`'s clamp order. Negative
 * results inside math functions are clamped to zero by CSS itself for
 * `width`/`height` — but a BARE negative literal (`width:-50px`, `width:-10%`)
 * is a parse-time range violation the browser drops wholesale, leaving
 * `width:auto` (shrink-to-fit) while `resolveItem` floors the size to 0. Such
 * a literal always resolves to a floored 0 anyway, so it is emitted as `0px`.
 */
function sizeExpr(len: Len | undefined, min: number | undefined, max: number | undefined): string {
  const parts = lenParts(len);
  const negativeLiteral =
    (roundPct(parts.pct) === 0 && roundPx(parts.px) < 0) ||
    (roundPx(parts.px) === 0 && roundPct(parts.pct) < 0);
  const base = negativeLiteral ? '0px' : lenExpr(len);
  if (isNum(min) && isNum(max)) return `clamp(${px(min)}, ${base}, ${px(max)})`;
  if (isNum(min)) return `max(${px(min)}, ${base})`;
  if (isNum(max)) return `min(${px(max)}, ${base})`;
  return base;
}

/* ------------------------------------------------------------------ */
/* Per-axis emission                                                   */
/* ------------------------------------------------------------------ */

/** Logical (start/end/size) CSS values for one axis. */
interface AxisEmission {
  start: string;
  end: string;
  size: string;
}

const EMPTY_AXIS: AxisEmission = { start: '0px', end: 'auto', size: '0px' };

/**
 * Emit one axis as CSS values, in LOGICAL terms.
 *
 * | mode        | start           | end       | size          |
 * |-------------|-----------------|-----------|---------------|
 * | start/scale | `offset`        | `auto`    | `size`        |
 * | end         | `auto`          | `offset`  | `size`        |
 * | both        | `start`         | `end`     | `auto`        |
 * | center      | `50% + d − s/2` | `auto`    | `size`        |
 *
 * `both` never emits `left`+`right` with `width:auto`: when the insets
 * over-constrain (start+end exceeding the width, or size limits in play) the
 * edge CSS ignores depends on the containing block's direction, which the
 * stylesheet does not control. The derived size is emitted explicitly instead
 * (`width: calc(100% − start − end)`, clamped when limits exist), which pins
 * the start edge in any direction — the same thing `resolveItem` does.
 */
function emitAxis(
  p: AxisPlacement | undefined,
  min: number | undefined,
  max: number | undefined,
): AxisEmission {
  if (!p || typeof p !== 'object') return EMPTY_AXIS;
  const clamped = isNum(min) || isNum(max);
  switch (p.mode) {
    case 'start':
    case 'scale':
      return { start: lenExpr(p.offset), end: 'auto', size: sizeExpr(p.size, min, max) };
    case 'end':
      return { start: 'auto', end: lenExpr(p.offset), size: sizeExpr(p.size, min, max) };
    case 'both': {
      const s = lenParts(p.start);
      const e = lenParts(p.end);
      const derived: Len = { pct: 100 - s.pct - e.pct, px: -(s.px + e.px) };
      return { start: lenExpr(p.start), end: 'auto', size: sizeExpr(derived, min, max) };
    }
    case 'center': {
      const size = sizeExpr(p.size, min, max);
      const d = lenParts(p.offset);
      const s = lenParts(p.size);
      // A size expression with mixed signs can resolve negative at some widths.
      // CSS floors the USED size at zero but `left` is a fixed expression, so
      // the floor has to be written into it — otherwise the centre drifts by
      // half the negative overshoot and JS and CSS disagree.
      const nonNegative = (isNum(min) && min >= 0) || (s.pct >= 0 && s.px >= 0);
      if (!clamped && nonNegative) {
        // Fold the half-size into the affine constant. No transform, no
        // negative percentage margin.
        const folded: Len = { pct: 50 + d.pct - s.pct / 2, px: d.px - s.px / 2 };
        return { start: lenExpr(folded), end: 'auto', size };
      }
      const anchor: Len = { pct: 50 + d.pct, px: d.px };
      const half = nonNegative ? size : `max(0px, ${size})`;
      return { start: `calc(${inner(lenExpr(anchor))} - ${half} / 2)`, end: 'auto', size };
    }
    default:
      return EMPTY_AXIS;
  }
}

/**
 * Emit an axis as fixed pixels, resolved at `extent`.
 *
 * Used for the y axis under `height: 'auto'`: the container has no definite
 * height, so percentages and bottom anchoring are unresolvable (spec §1.6).
 * Freezing the axis at `base.height` degrades to `top`/`height` in pixels —
 * which is precisely the number `resolveItem` returns, so the JS and the CSS
 * cannot drift.
 */
function emitAxisFixed(
  p: AxisPlacement | undefined,
  extent: number,
  min: number | undefined,
  max: number | undefined,
): AxisEmission {
  const { pos, size } = resolveAxisClamped(p, extent, min, max);
  return { start: px(pos), end: 'auto', size: px(size) };
}

/**
 * The complete placement property set for one item at one cascade level.
 * Always six declarations, always in the same order, always including explicit
 * `auto` resets — a responsive block that switches modes must undo the
 * previous mode's properties.
 */
function placementDecls(item: LayoutItemBase, config: ContainerConfig, rtl: boolean): string[] {
  const x = emitAxis(item.x, item.minW, item.maxW);
  const y =
    config?.height === 'fill'
      ? emitAxis(item.y, item.minH, item.maxH)
      : emitAxisFixed(item.y, yExtentOf(config), item.minH, item.maxH);
  return [
    `left:${rtl ? x.end : x.start}`,
    `right:${rtl ? x.start : x.end}`,
    `width:${x.size}`,
    `top:${y.start}`,
    `bottom:${y.end}`,
    `height:${y.size}`,
  ];
}

/* ------------------------------------------------------------------ */
/* Stylesheet                                                          */
/* ------------------------------------------------------------------ */

/**
 * The `min-height` an `height: 'auto'` container needs: the lowest bottom edge
 * any item reaches at ANY cascade level, not just at the base placement.
 *
 * One reserved height covers every level at once: a size override that pushes
 * an item down would otherwise overflow a container sized only for the base
 * layout, and a single conservative bound keeps the sheet small and the
 * container from jumping in height as overrides activate.
 *
 * This is width-independent: under `'auto'` the y axis always resolves against
 * `base.height` (spec §1.6), so the only thing that varies across widths is
 * WHICH `at` overrides are folded in — hence one pass per cascade level, with
 * each level's own `hidden` state honored.
 *
 * `responsive: 'scale'` emits no `@container` blocks at all, so it has exactly
 * one level: the base one. Folding `at` overrides there would contradict the
 * item rules in the very same sheet.
 */
function containerMinHeight(
  items: readonly LayoutItemBase[],
  config: ContainerConfig,
  scaled: boolean,
): number {
  const yExtent = yExtentOf(config);
  const levels: string[][] = [[]];
  if (!scaled) {
    const sizeNames = activeSizesAt(config, 0);
    for (let k = 0; k < sizeNames.length; k++) levels.push(sizeNames.slice(0, k + 1));
  }
  let bottom = 0;
  for (const active of levels) {
    for (const item of items) {
      const folded = foldItem(item, active);
      if (folded.hidden) continue;
      const { pos, size } = resolveAxisClamped(folded.y, yExtent, folded.minH, folded.maxH);
      const b = pos + size;
      if (b > bottom) bottom = b;
    }
  }
  return bottom;
}

function rule(selector: string, decls: readonly string[], indent = ''): string {
  return `${indent}${selector}{${decls.join(';')}}`;
}

/**
 * Emit the complete static stylesheet for a document instance.
 *
 * The output is deterministic: same document + same instance id + same ranks
 * produce byte-identical CSS, which is what makes golden-file and
 * server/client differential tests meaningful.
 *
 * @param doc        the layout document (data payloads are irrelevant here)
 * @param instanceId unique per mounted dashboard; scopes every selector so two
 *                   dashboards with colliding item ids never cross-talk
 * @param zRanks     derived sparse z-index ranks, keyed by item id
 */
export function emitStylesheet<TData = unknown>(
  doc: LayoutDoc<TData>,
  instanceId: string,
  zRanks: ReadonlyMap<string, number>,
): string {
  const config: ContainerConfig = doc?.container ?? { base: { width: 0 } };
  const items: LayoutItemBase[] = (doc?.items ?? []) as unknown as LayoutItemBase[];
  const rtl = config.direction === 'rtl';
  const scaled = config.responsive === 'scale';
  const baseWidth = isNum(config.base?.width) ? config.base.width : 0;

  const root = `[data-vzb="${cssEscapeString(instanceId)}"]`;
  const wrap = `[data-vzb-container="${cssEscapeString(instanceId)}"]`;
  const containerName = `vzb-${cssEscapeIdent(instanceId)}`;
  const itemSelector = (id: string) => `${root} [data-vzb-item="${cssEscapeString(id)}"]`;

  const out: string[] = [];

  /* --- query container + positioning root ------------------------ */
  // Container queries resolve against the nearest ANCESTOR container — an
  // element can never match a query on itself. The query container is
  // therefore a dedicated WRAPPER element (`data-vzb-container`, rendered by
  // every adapter in reflow mode) around the positioning root, so `@container`
  // blocks below can legitimately restyle the root itself — the tier-3 stack
  // depends on that.
  if (!scaled) {
    const wrapDecls = ['container-type:inline-size', `container-name:${containerName}`];
    if (config.height === 'fill') wrapDecls.push('height:100%');
    out.push(rule(wrap, wrapDecls));
  }

  // `isolation:isolate` guarantees the root is a stacking context in EVERY
  // mode: derived sparse z-ranks can drift negative under repeated
  // sendToBack, which would otherwise paint items behind the page background.
  const containerDecls = ['position:relative', 'isolation:isolate'];
  if (scaled) {
    // No container queries in scale mode: the adapter wraps a fixed base-size
    // canvas and scales it with a transform on the WRAPPER (never on items).
    containerDecls.push(`width:${px(baseWidth)}`);
  }
  if (config.height === 'fill') {
    containerDecls.push('height:100%');
  } else {
    containerDecls.push(`min-height:${px(containerMinHeight(items, config, scaled))}`);
  }
  out.push(rule(root, containerDecls));

  /* --- base item rules ------------------------------------------- */
  // Tracks what the cascade has already established for each item so that a
  // responsive block only repeats itself when something actually changes.
  const emitted = new Map<string, { decls: string; hidden: boolean }>();

  for (const item of items) {
    const decls = placementDecls(item, config, rtl);
    const zIndex = zRanks?.get(item.id);
    const head = ['position:absolute', 'box-sizing:border-box'];
    if (isNum(zIndex)) head.push(`z-index:${Math.round(zIndex)}`);
    const hidden = item.hidden === true;
    const tail = hidden ? ['display:none'] : [];
    out.push(rule(itemSelector(item.id), [...head, ...decls, ...tail]));
    emitted.set(item.id, { decls: decls.join(';'), hidden });
  }

  /* --- responsive size blocks ------------------------------------ */
  if (!scaled) {
    // `activeSizesAt(config, 0)` yields every declared size in cascade order
    // (descending maxWidth, ties by name) — the exact order the JS fold uses.
    const sizeNames = activeSizesAt(config, 0);
    for (let k = 0; k < sizeNames.length; k++) {
      const active = sizeNames.slice(0, k + 1);
      const maxWidth = config.sizes?.[sizeNames[k]]?.maxWidth ?? 0;
      const body: string[] = [];
      for (const item of items) {
        const folded = foldItem(item, active);
        const decls = placementDecls(folded, config, rtl);
        const joined = decls.join(';');
        const hidden = folded.hidden === true;
        const prev = emitted.get(item.id);
        if (prev && prev.decls === joined && prev.hidden === hidden) continue;
        const display = prev && prev.hidden !== hidden ? [hidden ? 'display:none' : 'display:block'] : [];
        body.push(rule(itemSelector(item.id), [...decls, ...display], '  '));
        emitted.set(item.id, { decls: joined, hidden });
      }
      if (body.length === 0) continue;
      // `(max-width: X)` is INCLUSIVE, matching `activeSizesAt`'s `W <= maxWidth`.
      out.push(`@container ${containerName} (max-width:${queryPx(maxWidth)}){`);
      out.push(...body);
      out.push('}');
    }

    /* --- tier-3 stack blocks ------------------------------------- */
    const stackBelow = isNum(config.stackBelow) ? config.stackBelow : DEFAULT_STACK_BELOW;
    if (stackBelow > 0 && items.length > 0) {
      const yExtent = yExtentOf(config);
      // The stack must win over the size blocks above, so it is emitted last —
      // which means any declared size SMALLER than stackBelow needs its stacked
      // form re-emitted here too, or it would never take effect. Visibility is
      // deliberately untouched: `display` is already correct at every width
      // from the base rule and the size blocks.
      //
      // Level 0 covers the whole stacked band, which is the STRICT inequality
      // `W < stackBelow` (`isStackedAt`). It is emitted with range syntax
      // rather than `(max-width: stackBelow − 1px)`, which disagreed with the
      // JS predicate on every fractional width in between — and degenerated to
      // `(max-width: 0px)` for `stackBelow <= 1`. Sizes active across that
      // whole band are folded at `stackBelow` itself; a size whose `maxWidth`
      // is below it is active only on a sub-band and gets its own level.
      const levels = [stackBelow];
      for (const name of sizeNames) {
        const maxWidth = config.sizes?.[name]?.maxWidth ?? 0;
        if (maxWidth < stackBelow) levels.push(maxWidth);
      }

      const prevStack = new Map<string, string>();
      for (let level = 0; level < levels.length; level++) {
        const width = levels[level];
        const folded = items.map((item) => foldItem(item, activeSizesAt(config, width)));
        const rank = new Map<string, number>();
        stackOrder(folded, config).forEach((id, i) => rank.set(id, i));

        const body: string[] = [];
        if (level === 0) {
          // Absolute positioning is off and the column grows, so the
          // base-layout min-height no longer describes the container.
          body.push(
            rule(
              root,
              [
                'display:flex',
                'flex-direction:column',
                `gap:${STACK_GAP}px`,
                'height:auto',
                'min-height:0',
              ],
              '  ',
            ),
          );
        }
        for (const item of folded) {
          const { size } = resolveAxisClamped(item.y, yExtent, item.minH, item.maxH);
          const decls = [
            'position:static',
            'left:auto',
            'right:auto',
            'top:auto',
            'bottom:auto',
            'width:auto',
            `height:${px(size)}`,
            `order:${rank.get(item.id) ?? 0}`,
          ];
          const joined = decls.join(';');
          if (prevStack.get(item.id) === joined) continue;
          body.push(rule(itemSelector(item.id), decls, '  '));
          prevStack.set(item.id, joined);
        }
        if (body.length === 0) continue;
        const q = level === 0 ? `(width < ${queryPx(width)})` : `(max-width:${queryPx(width)})`;
        out.push(`@container ${containerName} ${q}{`);
        out.push(...body);
        out.push('}');
      }
    }
  }

  // Belt and braces. Every document-supplied string above goes through an
  // escaper that hex-escapes `<`, so this can never fire — but the return value
  // is destined for a `<style>` element filled with `dangerouslySetInnerHTML`,
  // and "no tag opener by construction" is worth asserting at the boundary
  // rather than trusting every future edit to remember. Only `</` is neutered:
  // a lone `<` is legitimate (and inert in raw text) as the tier-3 range query.
  const sheet = out.join('\n');
  return sheet.includes('</') ? sheet.replace(/<\//g, '\\3c /') : sheet;
}
