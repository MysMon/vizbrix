import type { ReactElement, ReactNode } from 'react';
import type { Messages } from '../core/messages';
import type { DashboardItem } from '../core/types';
import type { BrickDefinition, BrickRegistry, DataMap } from './brick';

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
  env: { data: DataMap; editing: boolean; messages: Messages },
): ReactNode {
  if (!definition) {
    return <div className="vbx-brick-placeholder">{env.messages.unknownBrick(item.type)}</div>;
  }
  return definition.render({ item, props: item.props ?? {}, data: env.data, editing: env.editing, lang: env.messages.lang });
}

export function definitionOf(item: DashboardItem, bricks: BrickRegistry): BrickDefinition | undefined {
  return Object.prototype.hasOwnProperty.call(bricks, item.type) ? bricks[item.type] : undefined;
}

/** Accessible name of a brick: its title, else its type's label, else a generic word. */
export function brickName(item: DashboardItem, bricks: BrickRegistry, messages: Messages): string {
  return item.title || definitionOf(item, bricks)?.label || messages.brickFallbackName;
}

export const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
