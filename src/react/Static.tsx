import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { compileCss } from '../core/geometry';
import { en, type Messages } from '../core/messages';
import type { DashboardDoc, DashboardItem } from '../core/types';
import type { BrickRegistry, DataMap } from './brick';
import { BrickShell, definitionOf, renderBrick } from './Shell';

export interface DashboardStaticProps {
  value: DashboardDoc;
  bricks?: BrickRegistry;
  data?: DataMap;
  renderItem?: (item: DashboardItem) => ReactNode;
  /**
   * Unique id for this dashboard on the page; scopes its stylesheet.
   * Required because a hook-free component cannot generate one.
   */
  id: string;
  header?: ReactNode;
  locale?: Messages;
  theme?: 'light' | 'dark' | 'auto';
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
}

/**
 * Read-only renderer with no hooks, no effects and no event handlers — a
 * React Server Component. The layout, breakpoints included, is plain CSS, so
 * the page ships no layout JavaScript and the first paint is already correct.
 * Markup is identical to `<Dashboard>`, which makes the two interchangeable.
 */
export function DashboardStatic(props: DashboardStaticProps): ReactElement {
  const { value: doc, bricks = {}, data = {}, renderItem, id, header, locale = en, theme, className, style } = props;
  return (
    <div className={className ? `vbx ${className}` : 'vbx'} style={style} data-vbx-theme={theme} lang={locale.lang}>
      {header ? (
        <div className="vbx-toolbar">
          <div className="vbx-toolbar-header">{header}</div>
        </div>
      ) : null}
      <div className="vbx-viewport" data-vbx-scope={id}>
        <style dangerouslySetInnerHTML={{ __html: compileCss(doc, id) }} />
        <div className="vbx-canvas" role="region" aria-label={props['aria-label'] ?? locale.dashboard}>
          {doc.items.map((item) => {
            const definition = definitionOf(item, bricks);
            return (
              <div className="vbx-item" data-vbx-item={item.id} key={item.id}>
                <BrickShell item={item} definition={definition} titleId={`${id}-${item.id}-title`}>
                  {!definition && renderItem
                    ? renderItem(item)
                    : renderBrick(item, definition, { data, editing: false, messages: locale })}
                </BrickShell>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
