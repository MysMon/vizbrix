/**
 * CSS emission tests, including the symbolic half of the css-differential
 * marketing asset (spec §15.2): for seeded random documents and widths, the
 * emitted `calc()` expressions are parsed and evaluated back to numbers and
 * compared against `resolveItem` within 0.5 px.
 *
 * The evaluator below doubles as documentation of the emission grammar:
 *
 *   value  := 'auto' | dimension | fn
 *   fn     := 'calc(' expr ')' | 'clamp(' expr ',' expr ',' expr ')'
 *           | 'min(' expr (',' expr)+ ')' | 'max(' expr (',' expr)+ ')'
 *   expr   := term (('+' | '-') term)*
 *   term   := factor (('*' | '/') factor)*
 *   factor := ['+'|'-'] (dimension | number | fn | '(' expr ')')
 *   dimension := number ('px' | '%')
 */

import { describe, expect, it } from 'vitest';
import type {
  AxisMode,
  AxisPlacement,
  ContainerConfig,
  LayoutDoc,
  LayoutItemBase,
  Len,
} from '../schema/types';
import { cssEscapeIdent, emitStylesheet } from './css';
import { resolveItem } from './resolve';

/* ------------------------------------------------------------------ */
/* Test-only CSS value evaluator                                       */
/* ------------------------------------------------------------------ */

class ValueParser {
  private i = 0;
  constructor(
    private readonly s: string,
    private readonly extent: number,
  ) {}

  static evaluate(value: string, extent: number): number | 'auto' {
    const v = value.trim();
    if (v === 'auto') return 'auto';
    const p = new ValueParser(v, extent);
    const n = p.expr();
    p.ws();
    if (p.i !== p.s.length) throw new Error(`trailing input in ${JSON.stringify(value)} at ${p.i}`);
    return n;
  }

  private ws(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }

  private eat(token: string): boolean {
    this.ws();
    if (this.s.startsWith(token, this.i)) {
      this.i += token.length;
      return true;
    }
    return false;
  }

  private expect(token: string): void {
    if (!this.eat(token)) throw new Error(`expected ${token} at ${this.i} in ${this.s}`);
  }

  private expr(): number {
    let acc = this.term();
    for (;;) {
      this.ws();
      // '+'/'-' are only operators when surrounded by whitespace in CSS calc;
      // the emitter always writes them that way.
      if (this.s[this.i] === '+' && /\s/.test(this.s[this.i - 1] ?? '')) {
        this.i++;
        acc += this.term();
      } else if (this.s[this.i] === '-' && /\s/.test(this.s[this.i - 1] ?? '')) {
        this.i++;
        acc -= this.term();
      } else {
        return acc;
      }
    }
  }

  private term(): number {
    let acc = this.factor();
    for (;;) {
      if (this.eat('*')) acc *= this.factor();
      else if (this.eat('/')) acc /= this.factor();
      else return acc;
    }
  }

  private factor(): number {
    this.ws();
    if (this.eat('calc(')) {
      const v = this.expr();
      this.expect(')');
      return v;
    }
    if (this.eat('clamp(')) {
      const min = this.expr();
      this.expect(',');
      const val = this.expr();
      this.expect(',');
      const max = this.expr();
      this.expect(')');
      return Math.max(min, Math.min(val, max));
    }
    if (this.eat('min(') || this.eat('max(')) {
      const isMin = this.s.slice(this.i - 4, this.i) === 'min(';
      const args = [this.expr()];
      while (this.eat(',')) args.push(this.expr());
      this.expect(')');
      return isMin ? Math.min(...args) : Math.max(...args);
    }
    if (this.eat('(')) {
      const v = this.expr();
      this.expect(')');
      return v;
    }
    const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(px|%)?/.exec(this.s.slice(this.i));
    if (!m) throw new Error(`unparseable value at ${this.i} in ${this.s}`);
    this.i += m[0].length;
    const n = Number.parseFloat(m[0]);
    if (m[1] === '%') return (n / 100) * this.extent;
    return n;
  }
}

const evaluate = (value: string, extent: number) => ValueParser.evaluate(value, extent);

/* ------------------------------------------------------------------ */
/* Test-only stylesheet parser (matches the emitter's own format)      */
/* ------------------------------------------------------------------ */

interface ParsedRule {
  selector: string;
  decls: Record<string, string>;
}
interface ParsedBlock {
  maxWidth: number;
  rules: ParsedRule[];
}
interface ParsedSheet {
  rules: ParsedRule[];
  blocks: ParsedBlock[];
}

function parseSheet(css: string): ParsedSheet {
  const sheet: ParsedSheet = { rules: [], blocks: [] };
  let current: ParsedBlock | null = null;
  for (const raw of css.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('@container')) {
      const m = /max-width:\s*([-\d.]+)px/.exec(line);
      expect(m, `unparseable container query: ${line}`).toBeTruthy();
      current = { maxWidth: Number.parseFloat(m![1]), rules: [] };
      sheet.blocks.push(current);
      continue;
    }
    if (line === '}') {
      current = null;
      continue;
    }
    const open = line.indexOf('{');
    const selector = line.slice(0, open).trim();
    const body = line.slice(open + 1, line.lastIndexOf('}'));
    const decls: Record<string, string> = {};
    for (const decl of body.split(';')) {
      if (decl.trim() === '') continue;
      const colon = decl.indexOf(':');
      decls[decl.slice(0, colon).trim()] = decl.slice(colon + 1).trim();
    }
    (current ? current.rules : sheet.rules).push({ selector, decls });
  }
  return sheet;
}

/** The declarations that apply to `selector` at container width `width`. */
function computed(sheet: ParsedSheet, selector: string, width: number): Record<string, string> {
  const out: Record<string, string> = {};
  const apply = (rules: ParsedRule[]) => {
    for (const r of rules) if (r.selector === selector) Object.assign(out, r.decls);
  };
  apply(sheet.rules);
  for (const block of sheet.blocks) if (width <= block.maxWidth) apply(block.rules);
  return out;
}

/** Reproduce the CSS box-model solve for an absolutely positioned child. */
function boxFromCss(
  decls: Record<string, string>,
  startProp: string,
  endProp: string,
  sizeProp: string,
  extent: number,
): { pos: number; size: number } {
  const start = evaluate(decls[startProp], extent);
  const end = evaluate(decls[endProp], extent);
  const declared = evaluate(decls[sizeProp], extent);
  if (declared !== 'auto') {
    const size = Math.max(0, declared);
    const pos = start !== 'auto' ? start : extent - (end as number) - size;
    return { pos, size };
  }
  // width:auto with both edges pinned — the derived size, floored at 0, with
  // the start edge winning when over-constrained.
  const size = Math.max(0, extent - (start as number) - (end as number));
  return { pos: start as number, size };
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function doc(container: ContainerConfig, items: LayoutItemBase[]): LayoutDoc<never> {
  return { version: 1, container, items } as unknown as LayoutDoc<never>;
}

function item(partial: Partial<LayoutItemBase> & { id: string }): LayoutItemBase {
  return {
    x: { mode: 'start', offset: 0, size: 100 },
    y: { mode: 'start', offset: 0, size: 100 },
    z: 'a0',
    ...partial,
  };
}

const ranks = (...ids: string[]) => new Map(ids.map((id, i) => [id, (i + 1) * 1024]));

/* ------------------------------------------------------------------ */
/* cssEscapeIdent                                                      */
/* ------------------------------------------------------------------ */

describe('cssEscapeIdent', () => {
  it('passes safe identifier characters through', () => {
    expect(cssEscapeIdent('chart-1_a')).toBe('chart-1_a');
    expect(cssEscapeIdent('ABCxyz0123')).toBe('ABCxyz0123');
  });

  it('escapes quotes, backslashes, whitespace and punctuation', () => {
    expect(cssEscapeIdent('a"b')).toBe('a\\"b');
    expect(cssEscapeIdent('a\\b')).toBe('a\\\\b');
    expect(cssEscapeIdent('a b')).toBe('a\\ b');
    expect(cssEscapeIdent('a.b#c[d]')).toBe('a\\.b\\#c\\[d\\]');
    expect(cssEscapeIdent('«r0»')).toBe('«r0»');
  });

  it('hex-escapes a leading digit and a digit after a leading hyphen', () => {
    expect(cssEscapeIdent('1item')).toBe('\\31 item');
    expect(cssEscapeIdent('-1item')).toBe('-\\31 item');
    expect(cssEscapeIdent('a1')).toBe('a1');
  });

  it('handles the degenerate cases the CSSOM algorithm calls out', () => {
    expect(cssEscapeIdent('')).toBe('');
    expect(cssEscapeIdent('-')).toBe('\\-');
    expect(cssEscapeIdent('--custom')).toBe('--custom');
    expect(cssEscapeIdent('a\0b')).toBe('a�b');
    expect(cssEscapeIdent('a\x01b')).toBe('a\\1 b');
  });

  it('keeps non-ASCII intact (valid ident characters, no DOM needed)', () => {
    expect(cssEscapeIdent('売上グラフ')).toBe('売上グラフ');
    expect(cssEscapeIdent('emoji-🎯')).toBe('emoji-🎯');
  });
});

/* ------------------------------------------------------------------ */
/* Structure                                                           */
/* ------------------------------------------------------------------ */

describe('emitStylesheet — container rule', () => {
  it('scopes the instance and declares the query container', () => {
    const css = emitStylesheet(
      doc({ base: { width: 1000 } }, [item({ id: 'a' })]),
      'inst',
      ranks('a'),
    );
    expect(css.split('\n')[0]).toBe(
      '[data-vzb="inst"]{position:relative;container-type:inline-size;container-name:vzb-inst;min-height:100px}',
    );
  });

  it('emits height:100% under height:"fill" and min-height otherwise', () => {
    const items = [
      item({ id: 'a', y: { mode: 'start', offset: 40, size: 200 } }),
      item({ id: 'b', y: { mode: 'start', offset: 10, size: 90 } }),
    ];
    const fill = emitStylesheet(
      doc({ base: { width: 1000, height: 600 }, height: 'fill', stackBelow: 0 }, items),
      'i',
      ranks(),
    );
    expect(fill).toContain('height:100%');
    expect(fill).not.toContain('min-height');

    const auto = emitStylesheet(doc({ base: { width: 1000 } }, items), 'i', ranks());
    expect(auto.split('\n')[0]).toContain('min-height:240px');
  });

  it('ignores hidden items when sizing the auto container', () => {
    const items = [
      item({ id: 'a', y: { mode: 'start', offset: 40, size: 200 } }),
      item({ id: 'b', hidden: true, y: { mode: 'start', offset: 900, size: 100 } }),
    ];
    expect(emitStylesheet(doc({ base: { width: 1000 } }, items), 'i', ranks()).split('\n')[0]).toContain(
      'min-height:240px',
    );
  });

  it('escapes the instance id in both the selector and the container name', () => {
    const css = emitStylesheet(doc({ base: { width: 100 } }, [item({ id: 'a' })]), '«r0»', ranks('a'));
    expect(css).toContain('[data-vzb="«r0»"]');
    expect(css).toContain('container-name:vzb-«r0»');

    const quoted = emitStylesheet(doc({ base: { width: 100 } }, [item({ id: 'a' })]), 'a"b\\c', ranks('a'));
    expect(quoted).toContain('[data-vzb="a\\"b\\\\c"]');
    expect(quoted).toContain('container-name:vzb-a\\"b\\\\c');
  });
});

describe('emitStylesheet — item rules', () => {
  it('emits instance-scoped, escaped selectors', () => {
    const css = emitStylesheet(
      doc({ base: { width: 1000 } }, [item({ id: 'chart 1' }), item({ id: '2nd' })]),
      'i',
      ranks('chart 1', '2nd'),
    );
    expect(css).toContain('[data-vzb="i"] [data-vzb-item="chart 1"]{');
    expect(css).toContain('[data-vzb="i"] [data-vzb-item="2nd"]{');
  });

  it('emits the derived sparse z-index, and omits it when unranked', () => {
    const css = emitStylesheet(
      doc({ base: { width: 1000 } }, [item({ id: 'a' }), item({ id: 'b' })]),
      'i',
      new Map([['a', 2048]]),
    );
    const sheet = parseSheet(css);
    expect(sheet.rules[1].decls['z-index']).toBe('2048');
    expect(sheet.rules[2].decls['z-index']).toBeUndefined();
  });

  it('emits the mode → CSS table', () => {
    const config: ContainerConfig = { base: { width: 1000, height: 500 }, height: 'fill' };
    const cases: Array<[AxisPlacement, Record<string, string>]> = [
      [
        { mode: 'start', offset: 24, size: { pct: 30 } },
        { left: '24px', right: 'auto', width: '30%' },
      ],
      [
        { mode: 'end', offset: { pct: 5, px: 8 }, size: 120 },
        { left: 'auto', right: 'calc(5% + 8px)', width: '120px' },
      ],
      [
        { mode: 'both', start: 16, end: { pct: 10 } },
        { left: '16px', right: '10%', width: 'auto' },
      ],
      [
        { mode: 'center', offset: 0, size: 200 },
        { left: 'calc(50% - 100px)', right: 'auto', width: '200px' },
      ],
      [
        // centre: P = 50 + d.pct − s.pct/2, X = d.px − s.px/2
        { mode: 'center', offset: { pct: 10, px: 4 }, size: { pct: 20, px: 8 } },
        { left: '50%', right: 'auto', width: 'calc(20% + 8px)' },
      ],
      [
        { mode: 'scale', offset: { pct: 12.5 }, size: { pct: 25 } },
        { left: '12.5%', right: 'auto', width: '25%' },
      ],
    ];
    for (const [x, expected] of cases) {
      const css = emitStylesheet(doc(config, [item({ id: 'a', x })]), 'i', ranks());
      const decls = parseSheet(css).rules[1].decls;
      expect({ left: decls.left, right: decls.right, width: decls.width }).toEqual(expected);
    }
  });

  it('never writes transform, translate or negative percentage margins', () => {
    const css = emitStylesheet(
      doc({ base: { width: 1000, height: 800 }, height: 'fill' }, [
        item({
          id: 'a',
          x: { mode: 'center', offset: 0, size: { pct: 40 } },
          y: { mode: 'center', offset: 0, size: { pct: 40 } },
        }),
      ]),
      'i',
      ranks('a'),
    );
    expect(css).not.toContain('transform');
    expect(css).not.toContain('translate');
    expect(css).not.toContain('margin');
    // 50% + 0 − 40%/2 folded into one affine constant
    expect(css).toContain('top:30%');
  });

  it('folds min/max limits into the size expression, never into min-width', () => {
    const css = emitStylesheet(
      doc({ base: { width: 1000, height: 800 }, height: 'fill' }, [
        item({ id: 'a', x: { mode: 'start', offset: 0, size: { pct: 50 } }, minW: 240, maxW: 600 }),
        item({ id: 'b', x: { mode: 'start', offset: 0, size: { pct: 50 } }, minW: 240 }),
        item({ id: 'c', x: { mode: 'start', offset: 0, size: { pct: 50 } }, maxW: 600 }),
      ]),
      'i',
      ranks(),
    );
    const rules = parseSheet(css).rules;
    expect(rules[1].decls.width).toBe('clamp(240px, 50%, 600px)');
    expect(rules[2].decls.width).toBe('max(240px, 50%)');
    expect(rules[3].decls.width).toBe('min(600px, 50%)');
    expect(css).not.toContain('min-width');
    expect(css).not.toContain('max-width:600px');
  });

  it('keeps the centre pinned when a clamp binds', () => {
    const css = emitStylesheet(
      doc({ base: { width: 1000, height: 800 }, height: 'fill' }, [
        item({ id: 'a', x: { mode: 'center', offset: 0, size: { pct: 90 } }, maxW: 400 }),
      ]),
      'i',
      ranks(),
    );
    const decls = parseSheet(css).rules[1].decls;
    expect(decls.left).toBe('calc(50% - min(400px, 90%) / 2)');
    expect(evaluate(decls.left, 1000)).toBe(300);
  });

  it('floors a mixed-sign centre size at zero inside the left expression', () => {
    // `50% − 300px` is negative below 600px wide. CSS floors the USED width at
    // zero but not the `left` expression, so the floor must be written in.
    const config: ContainerConfig = { base: { width: 1000, height: 800 }, height: 'fill', stackBelow: 0 };
    const it0 = item({ id: 'a', x: { mode: 'center', offset: 0, size: { pct: 50, px: -300 } } });
    const decls = parseSheet(emitStylesheet(doc(config, [it0]), 'i', ranks())).rules[1].decls;
    expect(decls.left).toBe('calc(50% - max(0px, calc(50% - 300px)) / 2)');
    for (const width of [1000, 800, 600, 400, 320]) {
      const expected = resolveItem(it0, config, width, 800);
      expect(evaluate(decls.left, width), `left @${width}`).toBeCloseTo(expected.x, 6);
      expect(Math.max(0, evaluate(decls.width, width) as number)).toBeCloseTo(expected.w, 6);
    }
  });

  it('pins the start edge for a clamped both-mode instead of over-constraining', () => {
    const css = emitStylesheet(
      doc({ base: { width: 1000, height: 800 }, height: 'fill' }, [
        item({ id: 'a', x: { mode: 'both', start: 100, end: 800 }, minW: 400 }),
      ]),
      'i',
      ranks(),
    );
    const decls = parseSheet(css).rules[1].decls;
    expect(decls.right).toBe('auto');
    expect(decls.width).toBe('max(400px, calc(100% - 900px))');
    expect(evaluate(decls.width, 1000)).toBe(400);
    expect(evaluate(decls.left, 1000)).toBe(100);
  });
});

describe('emitStylesheet — vertical degradation', () => {
  it('freezes every y axis to pixels under height:"auto"', () => {
    const css = emitStylesheet(
      doc({ base: { width: 1000, height: 600 }, stackBelow: 0 }, [
        item({ id: 'a', y: { mode: 'end', offset: 40, size: 100 } }),
        item({ id: 'b', y: { mode: 'center', offset: 0, size: { pct: 50 } } }),
        item({ id: 'c', y: { mode: 'both', start: 20, end: 20 } }),
      ]),
      'i',
      ranks(),
    );
    expect(css).not.toContain('bottom:0');
    expect(css.split('\n').filter((l) => l.includes('data-vzb-item')).length).toBe(3);
    for (const rule of parseSheet(css).rules.slice(1)) {
      expect(rule.decls.bottom).toBe('auto');
      expect(rule.decls.top).toMatch(/^-?[\d.]+px$/);
      expect(rule.decls.height).toMatch(/^[\d.]+px$/);
    }
    const rules = parseSheet(css).rules;
    expect(rules[1].decls.top).toBe('460px'); // 600 − 40 − 100
    expect(rules[2].decls.top).toBe('150px'); // 300 − 300/2
    expect(rules[3].decls.height).toBe('560px');
  });

  it('honors bottom anchoring under height:"fill"', () => {
    const css = emitStylesheet(
      doc({ base: { width: 1000, height: 600 }, height: 'fill' }, [
        item({ id: 'a', y: { mode: 'end', offset: 40, size: 100 } }),
      ]),
      'i',
      ranks(),
    );
    const decls = parseSheet(css).rules[1].decls;
    expect(decls).toMatchObject({ top: 'auto', bottom: '40px', height: '100px' });
  });
});

describe('emitStylesheet — responsive blocks', () => {
  const config: ContainerConfig = {
    base: { width: 1200, height: 800 },
    height: 'fill',
    stackBelow: 0,
    sizes: { sm: { maxWidth: 600 }, lg: { maxWidth: 1000 }, md: { maxWidth: 800 } },
  };

  it('emits @container blocks in descending maxWidth order', () => {
    const css = emitStylesheet(
      doc(config, [
        item({
          id: 'a',
          at: {
            sm: { x: { mode: 'start', offset: 0, size: { pct: 100 } } },
            md: { x: { mode: 'start', offset: 8, size: { pct: 80 } } },
            lg: { x: { mode: 'start', offset: 16, size: { pct: 60 } } },
          },
        }),
      ]),
      'i',
      ranks('a'),
    );
    expect(parseSheet(css).blocks.map((b) => b.maxWidth)).toEqual([1000, 800, 600]);
    expect(css.indexOf('max-width:1000px')).toBeLessThan(css.indexOf('max-width:600px'));
  });

  it('re-emits the COMPLETE property set for both axes in every block', () => {
    const css = emitStylesheet(
      doc(config, [
        item({
          id: 'a',
          x: { mode: 'both', start: 10, end: 10 },
          at: { sm: { x: { mode: 'end', offset: 4, size: 100 } } },
        }),
      ]),
      'i',
      ranks('a'),
    );
    const block = parseSheet(css).blocks.find((b) => b.maxWidth === 600)!;
    expect(Object.keys(block.rules[0].decls).sort()).toEqual([
      'bottom',
      'height',
      'left',
      'right',
      'top',
      'width',
    ]);
    // switching from both → end must reset what both set
    expect(block.rules[0].decls.left).toBe('auto');
    expect(block.rules[0].decls.width).toBe('100px');
  });

  it('skips items whose folded placement did not change at that size', () => {
    const css = emitStylesheet(
      doc(config, [
        item({ id: 'a', at: { sm: { x: { mode: 'start', offset: 5, size: 5 } } } }),
        item({ id: 'b' }),
      ]),
      'i',
      ranks('a', 'b'),
    );
    const sheet = parseSheet(css);
    expect(sheet.blocks).toHaveLength(1);
    expect(sheet.blocks[0].rules).toHaveLength(1);
    expect(sheet.blocks[0].rules[0].selector).toContain('data-vzb-item="a"');
  });

  it('toggles display only when the hidden state actually changes', () => {
    const css = emitStylesheet(
      doc(config, [
        item({ id: 'a', at: { md: { hidden: true } } }),
        item({ id: 'b', hidden: true, at: { md: { hidden: false } } }),
      ]),
      'i',
      ranks('a', 'b'),
    );
    const sheet = parseSheet(css);
    expect(sheet.rules[1].decls.display).toBeUndefined();
    expect(sheet.rules[2].decls.display).toBe('none');
    const md = sheet.blocks.find((b) => b.maxWidth === 800)!;
    expect(md.rules[0].decls.display).toBe('none');
    expect(md.rules[1].decls.display).toBe('block');
    // sm inherits md's state → nothing more to say
    expect(sheet.blocks.find((b) => b.maxWidth === 600)).toBeUndefined();
  });

  it('matches activeSizesAt: the JS fold and the CSS cascade pick the same override', () => {
    const it0 = item({
      id: 'a',
      x: { mode: 'start', offset: 0, size: 100 },
      at: {
        lg: { x: { mode: 'start', offset: 0, size: 200 } },
        md: { x: { mode: 'start', offset: 0, size: 300 } },
        sm: { x: { mode: 'start', offset: 0, size: 400 } },
      },
    });
    const sheet = parseSheet(emitStylesheet(doc(config, [it0]), 'i', ranks('a')));
    const selector = '[data-vzb="i"] [data-vzb-item="a"]';
    for (const width of [1200, 1001, 1000, 999, 801, 800, 601, 600, 320]) {
      const decls = computed(sheet, selector, width);
      expect(evaluate(decls.width, width), `width ${width}`).toBe(
        resolveItem(it0, config, width, 800).w,
      );
    }
  });
});

describe('emitStylesheet — tier-3 stack', () => {
  const config: ContainerConfig = { base: { width: 1000, height: 800 }, height: 'fill' };
  const mk = (id: string, y: number, extra: Partial<LayoutItemBase> = {}) =>
    item({ id, y: { mode: 'start', offset: y, size: 60 }, ...extra });

  it('emits a flex column with deterministic order, last in the sheet', () => {
    const css = emitStylesheet(doc(config, [mk('c', 200), mk('a', 100), mk('b', 0)]), 'i', ranks());
    const sheet = parseSheet(css);
    const stack = sheet.blocks[sheet.blocks.length - 1];
    expect(stack.maxWidth).toBe(479);
    expect(stack.rules[0].decls).toMatchObject({
      display: 'flex',
      'flex-direction': 'column',
      gap: '8px',
      height: 'auto',
      'min-height': '0',
    });
    const orders = Object.fromEntries(
      stack.rules.slice(1).map((r) => [/item="(.*)"/.exec(r.selector)![1], r.decls.order]),
    );
    expect(orders).toEqual({ b: '0', a: '1', c: '2' });
    for (const rule of stack.rules.slice(1)) {
      expect(rule.decls).toMatchObject({
        position: 'static',
        left: 'auto',
        right: 'auto',
        top: 'auto',
        bottom: 'auto',
        width: 'auto',
        height: '60px',
      });
    }
  });

  it('respects stackBelow and disables at 0', () => {
    const at320 = parseSheet(emitStylesheet(doc({ ...config, stackBelow: 320 }, [mk('a', 0)]), 'i', ranks()));
    expect(at320.blocks[0].maxWidth).toBe(319);
    const off = parseSheet(emitStylesheet(doc({ ...config, stackBelow: 0 }, [mk('a', 0)]), 'i', ranks()));
    expect(off.blocks).toHaveLength(0);
  });

  it('re-emits the stacked form for sizes declared below stackBelow', () => {
    // The stack block is last so it wins; a size smaller than stackBelow would
    // otherwise never reach the stacked layout.
    const cfg: ContainerConfig = { ...config, sizes: { xs: { maxWidth: 400 } } };
    const css = emitStylesheet(
      doc(cfg, [
        mk('a', 0, { at: { xs: { y: { mode: 'start', offset: 0, size: 24 }, order: 9 } } }),
        mk('b', 100),
      ]),
      'i',
      ranks(),
    );
    const blocks = parseSheet(css).blocks;
    const stackLevels = blocks.filter((b) => b.rules.some((r) => r.decls.position === 'static'));
    expect(stackLevels.map((b) => b.maxWidth)).toEqual([479, 400]);
    expect(stackLevels[1].rules).toHaveLength(2);
    const xs = Object.fromEntries(
      stackLevels[1].rules.map((r) => [/item="(.*)"/.exec(r.selector)![1], r.decls]),
    );
    expect(xs.a).toMatchObject({ height: '24px', order: '1' });
    expect(xs.b).toMatchObject({ height: '60px', order: '0' });
    // …and the stack blocks never touch item visibility
    for (const b of stackLevels) {
      for (const r of b.rules) {
        if (r.selector.includes('data-vzb-item')) expect(r.decls.display).toBeUndefined();
      }
    }
  });

  it('applies per-size order and height overrides at the stack width', () => {
    const cfg: ContainerConfig = { ...config, sizes: { sm: { maxWidth: 600 } } };
    const css = emitStylesheet(
      doc(cfg, [
        mk('a', 0, { at: { sm: { order: 5 } } }),
        mk('b', 100, { at: { sm: { y: { mode: 'start', offset: 0, size: 20 } } } }),
      ]),
      'i',
      ranks(),
    );
    const sheet = parseSheet(css);
    const stack = sheet.blocks[sheet.blocks.length - 1];
    const rules = Object.fromEntries(
      stack.rules.slice(1).map((r) => [/item="(.*)"/.exec(r.selector)![1], r.decls]),
    );
    expect(rules.a.order).toBe('1');
    expect(rules.b.order).toBe('0');
    expect(rules.b.height).toBe('20px');
  });
});

describe('emitStylesheet — direction and responsive:"scale"', () => {
  it('swaps the physical edges under direction:"rtl"', () => {
    const cfg: ContainerConfig = { base: { width: 1000, height: 800 }, height: 'fill', direction: 'rtl' };
    const items = [
      item({ id: 'a', x: { mode: 'start', offset: 24, size: 100 } }),
      item({ id: 'b', x: { mode: 'end', offset: 24, size: 100 } }),
      item({ id: 'c', x: { mode: 'both', start: 10, end: 20 } }),
    ];
    const sheet = parseSheet(emitStylesheet(doc(cfg, items), 'i', ranks()));
    expect(sheet.rules[1].decls).toMatchObject({ right: '24px', left: 'auto' });
    expect(sheet.rules[2].decls).toMatchObject({ left: '24px', right: 'auto' });
    expect(sheet.rules[3].decls).toMatchObject({ right: '10px', left: '20px' });
    // the y axis is unaffected by direction
    expect(sheet.rules[1].decls.top).toBe('0px');
    // and content is not mirrored — the `direction` property is never written
    expect(emitStylesheet(doc(cfg, items), 'i', ranks())).not.toMatch(/[;{]direction:/);
  });

  it('emits a fixed base-size canvas and no container queries under scale', () => {
    const cfg: ContainerConfig = {
      base: { width: 1440, height: 900 },
      responsive: 'scale',
      sizes: { sm: { maxWidth: 600 } },
    };
    const css = emitStylesheet(doc(cfg, [item({ id: 'a', at: { sm: { hidden: true } } })]), 'i', ranks('a'));
    expect(css).not.toContain('@container');
    expect(css).not.toContain('container-type');
    expect(css.split('\n')[0]).toContain('width:1440px');
  });
});

/* ------------------------------------------------------------------ */
/* Symbolic differential (spec §15.2)                                  */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MODES: AxisMode[] = ['start', 'end', 'both', 'center', 'scale'];

function randomDoc(seed: number): { doc: LayoutDoc<never>; config: ContainerConfig; height: number } {
  const rng = mulberry32(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
  const len = (): Len => {
    const r = rng();
    if (r < 0.4) return Math.round(rng() * 400);
    if (r < 0.7) return { pct: Math.round(rng() * 6000) / 100 };
    return { pct: Math.round(rng() * 4000) / 100, px: Math.round((rng() - 0.5) * 200) };
  };
  const placement = (mode: AxisMode): AxisPlacement =>
    mode === 'both' ? { mode, start: len(), end: len() } : { mode, offset: len(), size: len() };

  const config: ContainerConfig = {
    base: { width: 1200, height: 800 },
    height: pick(['fill', 'auto'] as const),
    stackBelow: 0,
    sizes: { lg: { maxWidth: 1000 }, md: { maxWidth: 800 }, sm: { maxWidth: 560 } },
  };

  const items: LayoutItemBase[] = [];
  const count = 4 + Math.floor(rng() * 6);
  for (let i = 0; i < count; i++) {
    const it: LayoutItemBase = {
      id: `i${i}`,
      z: `a${i}`,
      x: placement(pick(MODES)),
      y: placement(pick(MODES)),
    };
    if (rng() < 0.35) it.minW = Math.round(rng() * 300);
    if (rng() < 0.35) it.maxW = 300 + Math.round(rng() * 500);
    if (rng() < 0.35) it.minH = Math.round(rng() * 200);
    if (rng() < 0.35) it.maxH = 200 + Math.round(rng() * 400);
    if (rng() < 0.5) {
      const at: NonNullable<LayoutItemBase['at']> = {};
      for (const size of ['lg', 'md', 'sm']) {
        if (rng() < 0.5) continue;
        at[size] = rng() < 0.25 ? { hidden: true } : { x: placement(pick(MODES)), y: placement(pick(MODES)) };
      }
      it.at = at;
    }
    items.push(it);
  }
  return { doc: doc(config, items), config, height: 700 };
}

describe('css-differential (symbolic)', () => {
  it('emitted calc() expressions evaluate to resolveItem, within 0.5px', () => {
    const widths = [1200, 1100, 1000, 999, 900, 800, 700, 600, 560, 559, 480, 375, 320];
    let checks = 0;
    let worst = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { doc: d, config, height } = randomDoc(seed);
      const sheet = parseSheet(emitStylesheet(d, 'inst', new Map()));
      const yExtent = config.height === 'fill' ? height : (config.base.height ?? 0);
      for (const width of widths) {
        for (const it of d.items as unknown as LayoutItemBase[]) {
          const decls = computed(sheet, `[data-vzb="inst"] [data-vzb-item="${it.id}"]`, width);
          if (decls.display === 'none') continue;
          const expected = resolveItem(it, config, width, height);
          const x = boxFromCss(decls, 'left', 'right', 'width', width);
          const y = boxFromCss(decls, 'top', 'bottom', 'height', yExtent);
          const deltas = [
            Math.abs(x.pos - expected.x),
            Math.abs(x.size - expected.w),
            Math.abs(y.pos - expected.y),
            Math.abs(y.size - expected.h),
          ];
          for (const d2 of deltas) {
            if (d2 > worst) worst = d2;
            expect(d2, `seed ${seed} item ${it.id} at ${width}px: ${JSON.stringify(decls)}`).toBeLessThan(0.5);
          }
          checks++;
        }
      }
    }
    expect(checks).toBeGreaterThan(3000);
    expect(worst).toBeLessThan(0.5);
  });

  it('agrees on a right-to-left document as well', () => {
    const { doc: d, config, height } = randomDoc(11);
    const rtlConfig: ContainerConfig = { ...config, direction: 'rtl' };
    const rtlDoc = doc(rtlConfig, d.items as unknown as LayoutItemBase[]);
    const sheet = parseSheet(emitStylesheet(rtlDoc, 'inst', new Map()));
    const yExtent = rtlConfig.height === 'fill' ? height : (rtlConfig.base.height ?? 0);
    for (const width of [1200, 900, 700, 500]) {
      for (const it of d.items as unknown as LayoutItemBase[]) {
        const decls = computed(sheet, `[data-vzb="inst"] [data-vzb-item="${it.id}"]`, width);
        if (decls.display === 'none') continue;
        const expected = resolveItem(it, rtlConfig, width, height);
        // logical start is the RIGHT edge under rtl
        const x = boxFromCss(decls, 'right', 'left', 'width', width);
        const y = boxFromCss(decls, 'top', 'bottom', 'height', yExtent);
        expect(Math.abs(x.pos - expected.x)).toBeLessThan(0.5);
        expect(Math.abs(x.size - expected.w)).toBeLessThan(0.5);
        expect(Math.abs(y.pos - expected.y)).toBeLessThan(0.5);
        expect(Math.abs(y.size - expected.h)).toBeLessThan(0.5);
      }
    }
  });
});

describe('determinism', () => {
  it('produces byte-identical output for identical input', () => {
    const { doc: d } = randomDoc(42);
    const a = emitStylesheet(d, 'i', ranks('i0', 'i1'));
    const b = emitStylesheet(d, 'i', ranks('i0', 'i1'));
    expect(a).toBe(b);
  });

  it('does not mutate the document', () => {
    const { doc: d } = randomDoc(43);
    const snapshot = JSON.stringify(d);
    emitStylesheet(d, 'i', new Map());
    expect(JSON.stringify(d)).toBe(snapshot);
  });

  it('survives an empty document', () => {
    const css = emitStylesheet(doc({ base: { width: 0 } }, []), 'i', new Map());
    expect(css).toBe(
      '[data-vzb="i"]{position:relative;container-type:inline-size;container-name:vzb-i;min-height:0px}',
    );
  });
});
