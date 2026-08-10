import { describe, expect, it } from 'vitest';
import type { ItemStringContext, Transaction, VizbrixStrings } from '../schema/types';
import { fromMessages, MESSAGE_KEYS } from '../a11y/announce';
import { defaultStrings, en } from './en';
import { ja } from './ja';

const ctx: ItemStringContext = {
  label: 'Revenue chart',
  x: 240.4,
  y: 119.6,
  w: 320.2,
  h: 180.9,
  position: 2,
  count: 5,
};

const reorderCtxFront = { ...ctx, direction: 'front' as const };
const reorderCtxBack = { ...ctx, direction: 'back' as const };

function tx(kind: Transaction['label']['kind'], ids: string[], size?: string): Transaction {
  return {
    label: size !== undefined ? { kind, ids, size } : { kind, ids },
    ops: [],
    source: 'pointer',
  };
}

/** Every no-arg / ctx-taking method, run against a fixed ctx, for non-emptiness checks. */
function allOutputs(strings: VizbrixStrings): string[] {
  return [
    strings.itemRole(),
    strings.instructions(),
    strings.grabbed(ctx),
    strings.moved(ctx),
    strings.dropped(ctx),
    strings.canceled(ctx),
    strings.resized(ctx),
    strings.removed(ctx),
    strings.placingStarted(ctx),
    strings.placed(ctx),
    strings.reordered(reorderCtxFront),
    strings.reordered(reorderCtxBack),
    strings.undoLabel(tx('move', ['revenue'])),
    strings.redoLabel(tx('resize', ['a', 'b'], 'md')),
    strings.moveButtonLabel(ctx),
  ];
}

describe('en strings', () => {
  it('every method returns a non-empty string for a representative ctx', () => {
    for (const out of allOutputs(en)) {
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('defaultStrings is the same object as en', () => {
    expect(defaultStrings).toBe(en);
  });

  it('grabbed announcement includes label, rounded coordinates, and position/count', () => {
    const out = en.grabbed(ctx);
    expect(out).toContain('Revenue chart');
    expect(out).toContain('240');
    expect(out).toContain('120');
    expect(out).toContain('2');
    expect(out).toContain('5');
  });

  it('reordered distinguishes front vs back', () => {
    expect(en.reordered(reorderCtxFront)).not.toBe(en.reordered(reorderCtxBack));
  });
});

describe('ja strings', () => {
  it('every method returns a non-empty string for a representative ctx', () => {
    for (const out of allOutputs(ja)) {
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('mirrors en: same method surface, distinct (localized) output', () => {
    expect(ja.itemRole()).not.toBe(en.itemRole());
    expect(ja.grabbed(ctx)).not.toBe(en.grabbed(ctx));
    expect(ja.grabbed(ctx)).toContain('Revenue chart');
  });
});

describe('undoLabel / redoLabel', () => {
  const kinds: Transaction['label']['kind'][] = ['move', 'resize', 'add', 'remove', 'reorder', 'edit'];

  it.each(kinds)('en: formats kind=%s with ids and no size', (kind) => {
    const out = en.undoLabel(tx(kind, ['a', 'b']));
    expect(out).toContain('a, b');
    expect(out.toLowerCase()).not.toContain('undefined');
  });

  it.each(kinds)('en: formats kind=%s with ids AND size', (kind) => {
    const out = en.redoLabel(tx(kind, ['a', 'b'], 'md'));
    expect(out).toContain('a, b');
    expect(out).toContain('(md)');
  });

  it.each(kinds)('ja: formats kind=%s with ids and no size', (kind) => {
    const out = ja.undoLabel(tx(kind, ['x']));
    expect(out).toContain('x');
    expect(out).not.toContain('undefined');
  });

  it.each(kinds)('ja: formats kind=%s with ids AND size', (kind) => {
    const out = ja.redoLabel(tx(kind, ['x', 'y'], 'sm'));
    expect(out).toContain('x, y');
    expect(out).toContain('(sm)');
  });

  it('single vs multi id transactions produce different labels', () => {
    expect(en.undoLabel(tx('move', ['a']))).not.toBe(en.undoLabel(tx('move', ['a', 'b'])));
  });

  it('size-present vs size-absent transactions produce different labels', () => {
    expect(en.undoLabel(tx('move', ['a']))).not.toBe(en.undoLabel(tx('move', ['a'], 'md')));
  });
});

describe('fromMessages', () => {
  it('every method returns non-empty output for a full bundle', () => {
    const bundle: Record<string, string> = {
      itemRole: 'custom widget role',
      instructions: 'custom instructions',
      grabbed: '{label} grabbed at {x}, {y} ({position}/{count})',
      moved: '{label} moved to {x}, {y}',
      dropped: '{label} dropped at {x}, {y}',
      canceled: '{label} canceled, back to {x}, {y}',
      resized: '{label} resized to {w}x{h}',
      removed: '{label} removed, {count} left',
      placingStarted: 'placing {label}',
      placed: '{label} placed at {x}, {y}',
      reordered: '{label} sent to {direction}, {position}/{count}',
      undoLabel: 'undo {kind} {ids} {size}',
      redoLabel: 'redo {kind} {ids} {size}',
      moveButtonLabel: 'move {label}',
    };
    const strings = fromMessages(bundle);
    for (const out of allOutputs(strings)) {
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('substitutes {token} placeholders from ctx', () => {
    const strings = fromMessages({ grabbed: '{label} @ {x},{y} pos {position}/{count}' });
    expect(strings.grabbed(ctx)).toBe('Revenue chart @ 240,120 pos 2/5');
  });

  it('substitutes transaction tokens for undoLabel, size defaults to empty string', () => {
    const strings = fromMessages({ undoLabel: '[{kind}] {ids} size={size}' });
    expect(strings.undoLabel(tx('move', ['a', 'b']))).toBe('[move] a, b size=');
    expect(strings.undoLabel(tx('move', ['a', 'b'], 'md'))).toBe('[move] a, b size=md');
  });

  it('substitutes direction for reordered', () => {
    const strings = fromMessages({ reordered: '{label} -> {direction}' });
    expect(strings.reordered(reorderCtxFront)).toBe('Revenue chart -> front');
    expect(strings.reordered(reorderCtxBack)).toBe('Revenue chart -> back');
  });

  it('falls back to the fallback strings per-key when a key is missing from the bundle', () => {
    const strings = fromMessages({ grabbed: 'only grabbed is overridden: {label}' });
    expect(strings.grabbed(ctx)).toBe('only grabbed is overridden: Revenue chart');
    // Every other key falls back to `en` (the default fallback) verbatim.
    expect(strings.moved(ctx)).toBe(en.moved(ctx));
    expect(strings.itemRole()).toBe(en.itemRole());
    expect(strings.instructions()).toBe(en.instructions());
    expect(strings.undoLabel(tx('move', ['a']))).toBe(en.undoLabel(tx('move', ['a'])));
  });

  it('falls back to a custom fallback strings object, not always en', () => {
    const strings = fromMessages({}, ja);
    expect(strings.itemRole()).toBe(ja.itemRole());
    expect(strings.grabbed(ctx)).toBe(ja.grabbed(ctx));
  });

  it('an empty bundle reproduces the fallback exactly for every method', () => {
    const strings = fromMessages({});
    const fallbackOut = allOutputs(en);
    const bundleOut = allOutputs(strings);
    expect(bundleOut).toEqual(fallbackOut);
  });

  it('leaves unknown {tokens} in a template untouched rather than throwing', () => {
    const strings = fromMessages({ grabbed: '{label} {notAToken}' });
    expect(strings.grabbed(ctx)).toBe('Revenue chart {notAToken}');
  });
});

describe('MESSAGE_KEYS completeness', () => {
  it('is a readonly, deduplicated list', () => {
    expect(new Set(MESSAGE_KEYS).size).toBe(MESSAGE_KEYS.length);
  });

  it('every key maps to a real VizbrixStrings method (round-trips through fromMessages)', () => {
    const strings = en;
    const methodNames = new Set(
      Object.keys(strings as unknown as Record<string, unknown>).filter(
        (k) => typeof (strings as unknown as Record<string, unknown>)[k] === 'function',
      ),
    );
    for (const key of MESSAGE_KEYS) {
      expect(methodNames.has(key)).toBe(true);
    }
    // And no VizbrixStrings method is missing from MESSAGE_KEYS.
    expect(methodNames.size).toBe(MESSAGE_KEYS.length);
  });

  it('each key produces a distinct, substituted string when overridden individually', () => {
    const outputs = new Map<string, string>();
    for (const key of MESSAGE_KEYS) {
      const bundle: Record<string, string> = { [key]: `MARKER::${key}::{label}` };
      const strings = fromMessages(bundle);
      let out: string;
      switch (key) {
        case 'itemRole':
          out = strings.itemRole();
          break;
        case 'instructions':
          out = strings.instructions();
          break;
        case 'undoLabel':
          out = strings.undoLabel(tx('move', ['a']));
          break;
        case 'redoLabel':
          out = strings.redoLabel(tx('move', ['a']));
          break;
        case 'reordered':
          out = strings.reordered(reorderCtxFront);
          break;
        default:
          out = strings[key](ctx);
      }
      expect(out.startsWith(`MARKER::${key}::`)).toBe(true);
      outputs.set(key, out);
    }
    // Every key's marker output is distinct from every other key's.
    expect(new Set(outputs.values()).size).toBe(MESSAGE_KEYS.length);
  });
});
