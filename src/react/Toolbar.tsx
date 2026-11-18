import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { BASE } from '../core/types';
import { newItemFor } from './brick';
import { useDashboardContext, useDashboardState } from './context';
import { CheckIcon, PencilIcon, PlusIcon, RedoIcon, UndoIcon } from './icons';

function AddMenu(): ReactElement | null {
  const { store, bricks, messages: m, announce, reveal } = useDashboardContext();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const types = Object.keys(bricks).filter((type) => bricks[type]!.label);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent): void => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (!types.length) return null;

  const onListKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div className="vbx-add" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="vbx-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <PlusIcon />
        {m.addBrick}
      </button>
      {open ? (
        <div className="vbx-popover vbx-add-list" role="menu" aria-label={m.addBrick} onKeyDown={onListKey}>
          {types.map((type, i) => {
            const def = bricks[type]!;
            return (
              <button
                key={type}
                type="button"
                role="menuitem"
                className="vbx-add-item"
                autoFocus={i === 0}
                onClick={() => {
                  const id = store.add(newItemFor(type, bricks));
                  setOpen(false);
                  announce(m.added(def.label!));
                  reveal(id);
                }}
              >
                {def.icon ? <span className="vbx-add-icon">{def.icon}</span> : null}
                <span className="vbx-add-text">
                  <span className="vbx-add-label">{def.label}</span>
                  {def.description ? <span className="vbx-add-desc">{def.description}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** The default toolbar: header slot, layout indicator, undo/redo, add, edit toggle. */
export function Toolbar({ header }: { header?: ReactNode }): ReactElement {
  const { store, messages: m, editable, announce, setEditing } = useDashboardContext();
  const editing = useDashboardState((s) => s.editing);
  const canUndo = useDashboardState((s) => s.canUndo);
  const canRedo = useDashboardState((s) => s.canRedo);
  const variant = useDashboardState((s) => s.variant);
  const custom = useDashboardState((s) => s.variant in s.doc.layouts);

  return (
    <div className="vbx-toolbar">
      <div className="vbx-toolbar-header">{header}</div>
      {editable ? (
        <div className="vbx-toolbar-actions" role="toolbar" aria-label={m.dashboard}>
          {editing && variant !== BASE ? (
            <span className="vbx-chip">
              {m.variantLabel(variant)} · {custom ? m.customLayout : m.autoLayout}
              {custom ? (
                <button type="button" className="vbx-link" onClick={() => store.resetLayout()}>
                  {m.resetLayout}
                </button>
              ) : null}
            </span>
          ) : null}
          {editing ? (
            <>
              <button
                type="button"
                className="vbx-icon-button"
                aria-label={m.undo}
                title={m.undo}
                disabled={!canUndo}
                onClick={() => {
                  store.undo();
                  announce(m.undone);
                }}
              >
                <UndoIcon />
              </button>
              <button
                type="button"
                className="vbx-icon-button"
                aria-label={m.redo}
                title={m.redo}
                disabled={!canRedo}
                onClick={() => {
                  store.redo();
                  announce(m.redone);
                }}
              >
                <RedoIcon />
              </button>
              <AddMenu />
            </>
          ) : null}
          <button
            type="button"
            className="vbx-button"
            data-variant={editing ? 'primary' : undefined}
            aria-pressed={editing}
            onClick={() => setEditing(!editing)}
          >
            {editing ? <CheckIcon /> : <PencilIcon />}
            {editing ? m.done : m.edit}
          </button>
        </div>
      ) : null}
    </div>
  );
}
