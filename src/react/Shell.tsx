import type { ReactElement, ReactNode } from 'react';
import type { Messages } from '../core/messages';
import type { DashboardItem } from '../core/types';
import type { BrickDefinition, BrickRegistry, BrickSelection, DataMap, DataStatus } from './brick';

/**
 * The brick's chrome: surface, title bar, body. Hook-free on purpose — the
 * editor, the read-only client view and the server-only static renderer all
 * produce exactly this markup, so switching between them never shifts a pixel.
 */
export function BrickShell(props: {
  item: DashboardItem;
  definition: BrickDefinition | undefined;
  titleId: string;
  children: ReactNode;
}): ReactElement {
  const { item, definition, titleId, children } = props;
  const chrome = definition?.chrome ?? 'card';
  return (
    <section
      className="vbx-brick"
      data-chrome={chrome}
      data-type={item.type}
      aria-labelledby={item.title ? titleId : undefined}
    >
      {item.title && chrome === 'card' ? (
        <header className="vbx-brick-header">
          <h3 className="vbx-brick-title" id={titleId} title={item.title}>
            {item.title}
          </h3>
        </header>
      ) : null}
      <div className="vbx-brick-body" data-flush={definition?.flush ? '' : undefined}>
        {children}
      </div>
    </section>
  );
}

/** Render a brick's content through the registry. */
export function renderBrick(
  item: DashboardItem,
  definition: BrickDefinition | undefined,
  env: {
    data: DataMap;
    editing: boolean;
    messages: Messages;
    status?: DataStatus;
    onRetry?: () => void;
    emit?: (selection: BrickSelection) => void;
  },
): ReactNode {
  if (!definition) {
    return <div className="vbx-brick-placeholder">{env.messages.unknownBrick(item.type)}</div>;
  }
  const state = typeof env.status === 'object' ? env.status.state : env.status;
  const name = datasetOf(item);
  const hasData = name !== undefined && env.data[name] !== undefined;
  // Nothing to show yet: say so. A failed load keeps no stale numbers on screen.
  if (state === 'error' || (state === 'loading' && !hasData)) {
    const message = typeof env.status === 'object' ? env.status.message : undefined;
    return (
      <div className="vbx-brick-placeholder" data-state={state} role={state === 'error' ? 'alert' : 'status'}>
        <span>{message ?? (state === 'error' ? env.messages.loadError : env.messages.loading)}</span>
        {state === 'error' && env.onRetry ? (
          <button type="button" className="vbx-button" data-vbx-nodrag="" onClick={env.onRetry}>
            {env.messages.retry}
          </button>
        ) : null}
      </div>
    );
  }
  const content = definition.render({
    item,
    props: item.props ?? {},
    data: env.data,
    editing: env.editing,
    lang: env.messages.lang,
    messages: env.messages,
    emit: env.editing ? undefined : env.emit,
  });
  // Refetching with data on screen: keep the previous render, dimmed, so the
  // layout does not jump and no skeleton flashes.
  return state === 'loading' ? (
    <div className="vbx-brick-stale" aria-busy="true">
      {content}
    </div>
  ) : (
    content
  );
}

/** Name of the dataset a brick is bound to, when its `data` prop is a reference. */
export function datasetOf(item: DashboardItem): string | undefined {
  const ref = item.props?.data;
  return typeof ref === 'string' ? ref : undefined;
}

export function definitionOf(item: DashboardItem, bricks: BrickRegistry): BrickDefinition | undefined {
  return Object.prototype.hasOwnProperty.call(bricks, item.type) ? bricks[item.type] : undefined;
}

/** Accessible name of a brick: its title, else its type's label, else a generic word. */
export function brickName(item: DashboardItem, bricks: BrickRegistry, messages: Messages): string {
  return item.title || definitionOf(item, bricks)?.label || messages.brickFallbackName;
}

export const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
