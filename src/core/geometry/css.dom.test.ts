// @vitest-environment jsdom
/**
 * The other half of the escaping contract.
 *
 * `css.test.ts` proves the emitted stylesheet can never carry a tag opener out
 * of document data; this file proves the hardening did not cost us anything —
 * the escaped selectors still SELECT, and the escaped sheet still parses. Both
 * halves are needed: an escaper that is safe but no longer matches would break
 * every layout instead of leaking one.
 *
 * jsdom (not happy-dom) is the environment here on purpose: its selector engine
 * and CSSOM implement the real escape-resolution rules.
 */

import { describe, expect, it } from 'vitest';
import type { ContainerConfig, LayoutDoc, LayoutItemBase } from '../schema/types';
import { emitStylesheet } from './css';

const HOSTILE = [
  '</style><script>alert(1)</script>',
  'x" ]</style>',
  'a<b&c>d',
  'plain-id',
  '売上 グラフ',
  '2nd\\odd"one',
];

function doc(container: ContainerConfig, items: LayoutItemBase[]): LayoutDoc<never> {
  return { version: 1, container, items } as unknown as LayoutDoc<never>;
}

const mk = (id: string): LayoutItemBase => ({
  id,
  z: 'a0',
  x: { mode: 'start', offset: 0, size: 100 },
  y: { mode: 'start', offset: 0, size: 100 },
});

/** The item selector the emitter wrote for `id`, lifted back out of the sheet. */
function itemSelectorFrom(css: string, index: number): string {
  const line = css.split('\n').filter((l) => l.includes('[data-vzb-item='))[index];
  return line.slice(0, line.indexOf('{'));
}

describe('emitted selectors still match the DOM', () => {
  it('selects an element whose raw id attribute contains a tag opener', () => {
    const css = emitStylesheet(
      doc({ base: { width: 1000 }, stackBelow: 0 }, HOSTILE.map(mk)),
      'inst"<x>',
      new Map(HOSTILE.map((id, i) => [id, (i + 1) * 1024])),
    );

    const root = document.createElement('div');
    // React sets attributes through the DOM API, which escapes nothing and
    // needs to escape nothing — attribute VALUES are not markup.
    root.setAttribute('data-vzb', 'inst"<x>');
    for (const id of HOSTILE) {
      const el = document.createElement('div');
      el.setAttribute('data-vzb-item', id);
      root.appendChild(el);
    }
    document.body.appendChild(root);

    HOSTILE.forEach((id, i) => {
      const selector = itemSelectorFrom(css, i);
      const found = document.querySelectorAll(selector);
      expect(found.length, `${selector} (${id})`).toBe(1);
      expect(found[0].getAttribute('data-vzb-item'), selector).toBe(id);
    });
  });

  it('parses as a stylesheet: every emitted rule survives the CSS parser', () => {
    const css = emitStylesheet(
      doc({ base: { width: 1000, height: 400 }, sizes: { sm: { maxWidth: 600 } } }, [
        mk('</style>'),
        mk('ok'),
      ]),
      '</style>',
      new Map([['ok', 1024]]),
    );
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    const sheet = style.sheet!;
    // One rule per emitted top-level block: nothing was dropped as invalid.
    const emittedTopLevel = css.split('\n').filter((l) => !l.startsWith('  ') && l !== '}').length;
    expect(sheet.cssRules.length).toBe(emittedTopLevel);
    style.remove();
  });

  it('the sheet cannot terminate the <style> element it is injected into', () => {
    const payload = '</style><img src=x onerror=alert(1)>';
    const css = emitStylesheet(
      doc({ base: { width: 1000 } }, [mk(payload)]),
      payload,
      new Map([[payload, 1024]]),
    );
    const host = document.createElement('div');
    // The exact sink: StyleSheet.tsx / Static.tsx write this with
    // dangerouslySetInnerHTML, so parse it the same way and look for escapees.
    host.innerHTML = `<style>${css}</style>`;
    expect(host.querySelectorAll('style').length).toBe(1);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('script')).toBeNull();
    expect(host.children.length).toBe(1);
    expect((host.firstElementChild as HTMLStyleElement).textContent).toBe(css);
  });
});
