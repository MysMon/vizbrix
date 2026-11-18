import type { ReactNode } from 'react';
import type { DashboardItem } from '../core/types';

/** Named datasets handed to the dashboard; bricks reference them by key. */
export type DataMap = Readonly<Record<string, unknown>>;

export interface BrickContext<P = Record<string, unknown>> {
  item: DashboardItem<P>;
  /** The brick's stored configuration (`item.props`, or `{}`). */
  props: P;
  /** Everything passed to the dashboard's `data` prop. */
  data: DataMap;
  editing: boolean;
  /** BCP 47 language tag of the active locale, for number/date formatting. */
  lang: string;
}

export interface BrickDefaults<P> {
  w?: number;
  h?: number;
  minW?: number;
  minH?: number;
  title?: string;
  props?: Partial<P>;
}

export interface BrickDefinition<P = Record<string, unknown>> {
  /** Name shown in the "Add" menu. Bricks without a label are not offered there. */
  label?: string;
  description?: string;
  icon?: ReactNode;
  /** Geometry and props a newly added brick of this type starts with. */
  defaults?: BrickDefaults<P>;
  /** `card` (default) draws the surface and title bar; `bare` draws nothing. */
  chrome?: 'card' | 'bare';
  /** Remove the body padding, for content that should touch the card edge (tables, maps). */
  flush?: boolean;
  render: (ctx: BrickContext<P>) => ReactNode;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BrickRegistry = Readonly<Record<string, BrickDefinition<any>>>;

/** Identity helper that infers and checks a brick's prop type. */
export function defineBrick<P = Record<string, unknown>>(definition: BrickDefinition<P>): BrickDefinition<P> {
  return definition;
}

/**
 * Resolve a brick's data reference: a string is looked up in the dashboard's
 * `data` map, anything else is used as given. This is what keeps documents
 * serializable — the layout names its data, the app supplies it.
 */
export function resolveData<T = unknown>(ref: unknown, data: DataMap): T | undefined {
  if (typeof ref === 'string') return data[ref] as T | undefined;
  return (ref ?? undefined) as T | undefined;
}

/** Geometry and props for a new brick of a registered type. */
export function newItemFor(type: string, registry: BrickRegistry): Partial<DashboardItem> & { type: string } {
  const defaults = registry[type]?.defaults;
  return {
    type,
    ...(defaults?.w !== undefined ? { w: defaults.w } : {}),
    ...(defaults?.h !== undefined ? { h: defaults.h } : {}),
    ...(defaults?.minW !== undefined ? { minW: defaults.minW } : {}),
    ...(defaults?.minH !== undefined ? { minH: defaults.minH } : {}),
    ...(defaults?.title !== undefined ? { title: defaults.title } : {}),
    ...(defaults?.props ? { props: { ...defaults.props } } : {}),
  };
}
