import { Component, memo, useId, useMemo, type ReactElement, type ReactNode } from 'react';
import type { Messages } from '../core/messages';
import type { DashboardItem } from '../core/types';
import { BrickActions } from './Actions';
import type { BrickDefinition, BrickSelection, DataMap, DataStatus } from './brick';
import { itemById, useDashboardContext, useDashboardState } from './context';
import { LockIcon } from './icons';
import { ItemMenu } from './ItemMenu';
import { BrickShell, HANDLES, brickName, datasetOf, definitionOf, renderBrick } from './Shell';

interface BoundaryProps {
  messages: Messages;
  resetKey: unknown;
  children: ReactNode;
}

/** One broken brick must not take the dashboard down with it. */
class BrickBoundary extends Component<BoundaryProps, { error: Error | null; key: unknown }> {
  override state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  static getDerivedStateFromProps(
    props: BoundaryProps,
    state: { error: Error | null; key: unknown },
  ): { error: null; key: unknown } | null {
    // New props for the brick are a fresh chance to render.
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="vbx-brick-placeholder" role="alert">
        <span>{this.props.messages.brickError}</span>
        <button type="button" className="vbx-button" data-vbx-nodrag="" onClick={() => this.setState({ error: null })}>
          {this.props.messages.retry}
        </button>
      </div>
    );
  }
}

interface BodyProps {
  item: DashboardItem;
  definition: BrickDefinition | undefined;
  data: DataMap;
  editing: boolean;
  messages: Messages;
  status: DataStatus | undefined;
  onRetry: (() => void) | undefined;
  emit: ((selection: BrickSelection) => void) | undefined;
  custom?: (item: DashboardItem, state: { editing: boolean }) => ReactNode;
}

/**
 * Brick content, memoized on exactly what a brick can depend on. Selecting,
 * dragging or editing a *different* brick leaves these props untouched, so
 * the (potentially expensive) content does not re-render.
 */
const BrickBody = memo(function BrickBody(props: BodyProps) {
  const { item, definition, data, editing, messages, custom, status, onRetry, emit } = props;
  if (!definition && custom) return <>{custom(item, { editing })}</>;
  return <>{renderBrick(item, definition, { data, editing, messages, status, onRetry, emit })}</>;
});

export const Item = memo(function Item({ id }: { id: string }): ReactElement | null {
  const { bricks, data, messages, renderItem, status, onRetry, onSelect, inspect, onEditItem, exportable } =
    useDashboardContext();
  const item = useDashboardState((s) => itemById(s, id));
  const editing = useDashboardState((s) => s.editing);
  const selected = useDashboardState((s) => s.selection.includes(id));
  const sole = useDashboardState((s) => s.selection.length === 1);
  const titleId = useId();
  const hintId = useId();
  const dataset = item ? datasetOf(item) : undefined;
  const retry = useMemo(() => (onRetry && dataset ? () => onRetry(dataset) : undefined), [onRetry, dataset]);
  const emit = useMemo(
    () => (onSelect && item ? (selection: BrickSelection) => onSelect({ ...selection, item }) : undefined),
    [onSelect, item],
  );
  if (!item) return null;

  const definition = definitionOf(item, bricks);
  const name = brickName(item, bricks, messages);
  const locked = !!item.locked;

  return (
    <div
      className="vbx-item"
      data-vbx-item={id}
      data-selected={editing && selected ? '' : undefined}
      data-locked={locked ? '' : undefined}
      tabIndex={editing ? 0 : undefined}
      role={editing ? 'group' : undefined}
      aria-label={editing ? name : undefined}
      aria-roledescription={editing ? messages.brickFallbackName : undefined}
      aria-describedby={editing ? hintId : undefined}
    >
      <BrickShell item={item} definition={definition} titleId={titleId}>
        <BrickBoundary messages={messages} resetKey={item}>
          <BrickBody
            item={item}
            definition={definition}
            data={data}
            editing={editing}
            messages={messages}
            status={dataset ? status[dataset] : undefined}
            onRetry={retry}
            emit={emit}
            custom={renderItem}
          />
        </BrickBoundary>
      </BrickShell>
      {editing ? (
        <>
          <div
            className="vbx-grip"
            aria-hidden="true"
            onDoubleClick={definition?.settings && !onEditItem ? () => inspect(id) : undefined}
          />
          <span id={hintId} hidden>
            {messages.itemInstructions}
          </span>
          {locked ? (
            <span className="vbx-lock-badge" aria-hidden="true">
              <LockIcon />
            </span>
          ) : null}
          <ItemMenu item={item} name={name} />
          {selected && sole && !locked
            ? HANDLES.map((h) => <span key={h} className="vbx-handle" data-vbx-handle={h} aria-hidden="true" />)
            : null}
        </>
      ) : exportable ? (
        <BrickActions item={item} name={name} />
      ) : null}
    </div>
  );
});
