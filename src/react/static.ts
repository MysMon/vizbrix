/**
 * `vizbrix/react/static` — the RSC-safe renderer.
 *
 * This file and everything it reaches must stay free of hooks, state, effects,
 * event handlers and the client-directive banner (tsup adds that banner to the
 * other React entries only). It exists so a saved dashboard can be rendered on
 * a server, at build time, or inside an email-grade HTML pipeline, with the
 * layout still exactly correct — because placement is an expression that
 * compiles to static CSS, not a measurement.
 */

export { VizbrixStatic } from './Static';
export type { VizbrixStaticProps } from './Static';

export type { ItemRenderer, ItemUI, ItemView } from './context';

export type { LayoutDoc, LayoutItem, LayoutItemBase, Rect } from '../core/schema/types';
