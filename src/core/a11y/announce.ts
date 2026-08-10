/**
 * `fromMessages` — a flat `{ key: template }` bundle adapter over the
 * `VizbrixStrings` function contract (§1.24), for TMS/localization
 * pipelines that can only round-trip flat JSON key/value pairs.
 *
 * HONEST LIMITATION: this is a degraded shape. `VizbrixStrings` methods are
 * FUNCTIONS precisely so a translator can reorder clauses, drop a clause a
 * target language doesn't need, apply plural/counter rules, or restructure
 * a sentence around a different word order (see `ja.ts` for a real example —
 * item label + quotation marks leading the sentence instead of trailing it).
 * A `{token}`-substitution template can do none of that: it can only
 * interpolate values into a FIXED sentence shape. Treat a message bundle as
 * a fallback path for pipelines that cannot ship code, not as the primary
 * localization contract — implementing `VizbrixStrings` directly (as `en.ts`
 * and `ja.ts` do) is always preferred when it's an option.
 *
 * Supported placeholders (not every key uses every token):
 * `{label} {x} {y} {w} {h} {position} {count} {direction} {kind} {ids} {size}`
 * — `x`/`y`/`w`/`h` are rounded to whole px before substitution, `ids` is the
 * transaction's id list joined with `", "`, and `size` substitutes to an
 * empty string when the transaction has no active named size.
 *
 * Any key missing from `messages` falls back to calling the corresponding
 * method on `fallback` (default: the built-in `en` strings) directly — NOT
 * a template lookup — so a partial bundle degrades gracefully per key.
 */

import type { ItemStringContext, Transaction, VizbrixStrings } from '../schema/types';
import { en } from '../locales/en';

/** The complete, stable set of message keys a bundle may provide. */
export const MESSAGE_KEYS = [
  'itemRole',
  'instructions',
  'grabbed',
  'moved',
  'dropped',
  'canceled',
  'resized',
  'removed',
  'placingStarted',
  'placed',
  'reordered',
  'undoLabel',
  'redoLabel',
  'moveButtonLabel',
] as const;

export type MessageKey = (typeof MESSAGE_KEYS)[number];

type TokenValue = string | number;

const round = (n: number): number => Math.round(n);

function substitute(template: string, tokens: Record<string, TokenValue>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? String(tokens[key]) : whole,
  );
}

function itemTokens(ctx: ItemStringContext): Record<string, TokenValue> {
  return {
    label: ctx.label,
    x: round(ctx.x),
    y: round(ctx.y),
    w: round(ctx.w),
    h: round(ctx.h),
    position: ctx.position,
    count: ctx.count,
  };
}

function txTokens(tx: Transaction): Record<string, TokenValue> {
  return {
    kind: tx.label.kind,
    ids: tx.label.ids.join(', '),
    size: tx.label.size ?? '',
  };
}

/**
 * Build a `VizbrixStrings` implementation from a flat message bundle.
 *
 * @param messages Flat `{ key: template }` map keyed by `MESSAGE_KEYS`
 *   (untyped `Record<string, string>` so a raw TMS JSON export can be passed
 *   straight through — validate against `MESSAGE_KEYS` at the call site if
 *   you want compile/lint-time coverage checking).
 * @param fallback Strings implementation used verbatim for any key absent
 *   from `messages`, and for `itemRole`/`instructions` which take no ctx.
 *   Defaults to the built-in English strings.
 */
export function fromMessages(messages: Record<string, string>, fallback: VizbrixStrings = en): VizbrixStrings {
  return {
    itemRole(): string {
      const t = messages['itemRole'];
      return t !== undefined ? t : fallback.itemRole();
    },

    instructions(): string {
      const t = messages['instructions'];
      return t !== undefined ? t : fallback.instructions();
    },

    grabbed(ctx: ItemStringContext): string {
      const t = messages['grabbed'];
      return t !== undefined ? substitute(t, itemTokens(ctx)) : fallback.grabbed(ctx);
    },

    moved(ctx: ItemStringContext): string {
      const t = messages['moved'];
      return t !== undefined ? substitute(t, itemTokens(ctx)) : fallback.moved(ctx);
    },

    dropped(ctx: ItemStringContext): string {
      const t = messages['dropped'];
      return t !== undefined ? substitute(t, itemTokens(ctx)) : fallback.dropped(ctx);
    },

    canceled(ctx: ItemStringContext): string {
      const t = messages['canceled'];
      return t !== undefined ? substitute(t, itemTokens(ctx)) : fallback.canceled(ctx);
    },

    resized(ctx: ItemStringContext): string {
      const t = messages['resized'];
      return t !== undefined ? substitute(t, itemTokens(ctx)) : fallback.resized(ctx);
    },

    removed(ctx: ItemStringContext): string {
      const t = messages['removed'];
      return t !== undefined ? substitute(t, itemTokens(ctx)) : fallback.removed(ctx);
    },

    placingStarted(ctx: ItemStringContext): string {
      const t = messages['placingStarted'];
      return t !== undefined ? substitute(t, itemTokens(ctx)) : fallback.placingStarted(ctx);
    },

    placed(ctx: ItemStringContext): string {
      const t = messages['placed'];
      return t !== undefined ? substitute(t, itemTokens(ctx)) : fallback.placed(ctx);
    },

    reordered(ctx: ItemStringContext & { direction: 'front' | 'back' }): string {
      const t = messages['reordered'];
      return t !== undefined
        ? substitute(t, { ...itemTokens(ctx), direction: ctx.direction })
        : fallback.reordered(ctx);
    },

    undoLabel(tx: Transaction): string {
      const t = messages['undoLabel'];
      return t !== undefined ? substitute(t, txTokens(tx)) : fallback.undoLabel(tx);
    },

    redoLabel(tx: Transaction): string {
      const t = messages['redoLabel'];
      return t !== undefined ? substitute(t, txTokens(tx)) : fallback.redoLabel(tx);
    },

    moveButtonLabel(ctx: ItemStringContext): string {
      const t = messages['moveButtonLabel'];
      return t !== undefined ? substitute(t, itemTokens(ctx)) : fallback.moveButtonLabel(ctx);
    },
  };
}
