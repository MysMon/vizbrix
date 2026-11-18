import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { AlignMode } from '../core/ops';
import { BASE } from '../core/types';
import { newItemFor } from './brick';
import { useDashboardContext, useDashboardState } from './context';
import { CheckIcon, PencilIcon, PlusIcon, RedoIcon, UndoIcon } from './icons';

function AddMenu(): ReactElement | null {
  const { store, bricks, messages: m, announce, reveal, inspect, onEditItem } = useDashboardContext();
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
                  // A new brick shows sample data; open its settings so it can be pointed at real data.
                  if (def.settings && !onEditItem) inspect(id);
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

const ALIGN_ICONS: Record<AlignMode, string> = {
  left: 'M2.5 2v12M5 4.5h8v2.5H5zM5 9h5v2.5H5z',
  centerX: 'M8 2v12M3.5 4.5h9v2.5h-9zM5 9h6v2.5H5z',
  right: 'M13.5 2v12M3 4.5h8v2.5H3zM6 9h5v2.5H6z',
  top: 'M2 2.5h12M4.5 5v8H7V5zM9 5v5h2.5V5z',
  centerY: 'M2 8h12M4.5 3.5v9H7v-9zM9 5v6h2.5V5z',
  bottom: 'M2 13.5h12M4.5 3v8H7V3zM9 6v5h2.5V6z',
  distributeX: 'M2 2v12M14 2v12M6.75 4.5h2.5v7h-2.5z',
  distributeY: 'M2 2h12M2 14h12M4.5 6.75h7v2.5h-7z',
};

function AlignTools(): ReactElement | null {
  const { store, messages: m } = useDashboardContext();
  const count = useDashboardState((s) => s.selection.length);
  if (count < 2) return null;
  const modes = (Object.keys(ALIGN_ICONS) as AlignMode[]).filter((mode) => count >= 3 || !mode.startsWith('distribute'));
  return (
    <div className="vbx-align" role="group" aria-label={m.alignLabel}>
      {modes.map((mode) => (
        <button
          key={mode}
          type="button"
          className="vbx-icon-button"
          aria-label={m.align[mode]}
          title={m.align[mode]}
          onClick={() => store.align(mode)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
            <path d={ALIGN_ICONS[mode]} />
          </svg>
        </button>
      ))}
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
              <AlignTools />
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
