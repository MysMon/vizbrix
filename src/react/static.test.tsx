/**
 * The RSC-safe renderer. Runs in the NODE environment on purpose — no jsdom
 * pragma — because "renders correctly without a DOM" is the property under
 * test, not an implementation detail.
 *
 * A saved layout must produce correct, positioned markup on a server, with no
 * client JavaScript, no measurement and no hydration step. That is only
 * possible because placement is an expression that compiles to static CSS.
 */

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { LayoutDoc } from '../core/schema/types';
import { defineLayout } from '../core/schema/normalize';
import { buildServerViews } from '../core/store/server-view';
import { VizbrixStatic } from './Static';
// Vite's `?raw` suffix — the source text itself is under test. There is no
// ambient declaration for it in this project, hence the suppressions.
// @ts-expect-error -- untyped ?raw import
import staticEntrySource from './static.ts?raw';
// @ts-expect-error -- untyped ?raw import
import staticComponentSource from './Static.tsx?raw';

function makeDoc(): LayoutDoc {
  return defineLayout({
    container: { base: { width: 1000 }, sizes: { md: { maxWidth: 700 } }, stackBelow: 0 },
    items: [
      {
        id: 'a',
        x: 10,
        y: 20,
        w: 100,
        h: 50,
        at: { md: { x: { mode: 'start', offset: 5, size: 90 } } },
      },
      { id: 'b', x: 300, y: 20, w: 200, h: 80, anchor: 'scale' },
      { id: 'locked', x: 0, y: 200, w: 50, h: 50, locked: true },
    ],
  });
}

describe('VizbrixStatic', () => {
  it('runs without any DOM global', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
    expect(() =>
      renderToString(<VizbrixStatic layout={makeDoc()}>{(item) => <p>{item.id}</p>}</VizbrixStatic>),
    ).not.toThrow();
  });

  it('emits item shells and the generated stylesheet', () => {
    const html = renderToString(
      <VizbrixStatic layout={makeDoc()} instanceId="srv">
        {(item) => <p>{item.id}</p>}
      </VizbrixStatic>,
    );

    expect(html).toContain('data-vzb="srv"');
    expect(html).toContain('data-vzb-item="a"');
    expect(html).toContain('data-vzb-item="b"');
    expect(html).toContain('<style');
    // dangerouslySetInnerHTML: the sheet is emitted verbatim, so child
    // combinators and quoted attribute selectors survive unescaped.
    expect(html).toContain('[data-vzb="srv"] [data-vzb-item="a"]');
    expect(html).toContain('position:absolute');
    expect(html).toContain('container-type:inline-size');
    // Responsive overrides are container queries in the sheet, not JavaScript.
    expect(html).toContain('@container');
    // The consumer's own content is rendered.
    expect(html).toContain('<p>a</p>');
    expect(html).toContain('data-locked=""');
  });

  it('writes no inline placement and no event handlers', () => {
    const html = renderToString(
      <VizbrixStatic layout={makeDoc()}>{(item) => <p>{item.id}</p>}</VizbrixStatic>,
    );
    expect(html).not.toMatch(/\son[a-z]+=/i);
    // §1.3: placement lives in the stylesheet, never in a style attribute.
    expect(html).not.toMatch(/style="[^"]*left:/);
    expect(html).not.toMatch(/style="[^"]*top:/);
  });

  it('hands the render callback the base-width rect (hydration parity)', () => {
    const doc = makeDoc();
    const seen: Record<string, { x: number; w: number }> = {};
    renderToString(
      <VizbrixStatic layout={doc}>
        {(item) => {
          seen[item.id] = { x: item.rect.x, w: item.rect.w };
          return null;
        }}
      </VizbrixStatic>,
    );

    // Identical to what the store freezes for hydration (§1.21).
    const views = buildServerViews(doc);
    for (const [id, view] of views) {
      expect(seen[id]).toEqual({ x: view.rect.x, w: view.rect.w });
    }
    expect(seen.a).toEqual({ x: 10, w: 100 });
  });

  it('inert ui: the callbacks exist and do nothing', () => {
    let calls = 0;
    renderToString(
      <VizbrixStatic layout={makeDoc()}>
        {(item, ui) => {
          if (item.id === 'a') {
            expect(ui.isSelected).toBe(false);
            expect(ui.isDragging).toBe(false);
            expect(ui.moveButtonProps.disabled).toBe(true);
            ui.remove();
            ui.select();
            ui.bringToFront();
            calls += 1;
          }
          return null;
        }}
      </VizbrixStatic>,
    );
    expect(calls).toBe(1);
  });
});

/**
 * The entry's own source text is part of its contract: tsup adds the client
 * banner to the OTHER React entries, so this one is only server-safe as long as
 * nobody writes the directive by hand or reaches into a client module.
 */
describe('the static entry stays server-safe', () => {
  const files: ReadonlyArray<readonly [string, string]> = [
    ['static.ts', staticEntrySource],
    ['Static.tsx', staticComponentSource],
  ];

  it('carries no client directive', () => {
    for (const [name, text] of files) {
      expect(`${name}:${/use client/.test(text)}`).toBe(`${name}:false`);
    }
  });

  it('imports nothing from the client entries', () => {
    for (const [name, text] of files) {
      const reaches = /from '\.\/(index|view|Vizbrix|View|Overlay|hooks|Item|StyleSheet)'/.test(text);
      expect(`${name}:${reaches}`).toBe(`${name}:false`);
    }
  });

  it('uses no hooks', () => {
    for (const [name, text] of files) {
      expect(`${name}:${/\buse[A-Z]\w*\(/.test(text)}`).toBe(`${name}:false`);
    }
  });
});
