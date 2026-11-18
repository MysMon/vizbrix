import { useEffect, useRef, useState, type ReactElement } from 'react';
import { resolveVariant } from '../core/geometry';
import { BASE, PINS, type DashboardItem, type Pin, type Rect } from '../core/types';
import { useDashboardContext, useDashboardState } from './context';
import { MoreIcon } from './icons';

/** The per-brick "⋯" button and its popover. Rendered only while editing. */
export function ItemMenu({ item, name }: { item: DashboardItem; name: string }): ReactElement {
  const { messages: m } = useDashboardContext();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

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

  // Raise the whole brick while its menu is open so the popover is not
  // covered by bricks painted later.
  useEffect(() => {
    const host = wrap.current?.closest<HTMLElement>('[data-vbx-item]');
    if (!host) return;
    if (open) host.setAttribute('data-menu-open', '');
    else host.removeAttribute('data-menu-open');
    return () => host.removeAttribute('data-menu-open');
  }, [open]);

  return (
    <div className="vbx-item-menu" data-vbx-nodrag="" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="vbx-icon-button"
        aria-label={`${m.brickMenu}: ${name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreIcon />
      </button>
      {open ? <MenuPanel item={item} name={name} close={() => setOpen(false)} /> : null}
    </div>
  );
}

function MenuPanel({ item, name, close }: { item: DashboardItem; name: string; close: () => void }): ReactElement {
  const { store, bricks, messages: m, onEditItem, announce, reveal, inspect } = useDashboardContext();
  const hasSettings = !!(Object.prototype.hasOwnProperty.call(bricks, item.type) && bricks[item.type]!.settings);
  const variantName = useDashboardState((s) => s.variant);
  const rect = useDashboardState((s) => resolveVariant(s.doc, s.variant).rects.get(item.id));
  const locked = !!item.locked;

  const run = (fn: () => void) => () => {
    fn();
    close();
  };

  const setField = (key: keyof Rect, raw: string): void => {
    const value = Number(raw);
    if (!rect || raw.trim() === '' || !Number.isFinite(value)) return;
    const reason = key === 'w' || key === 'h' ? 'resize' : 'move';
    store.setRects({ [item.id]: { ...rect, [key]: value } }, reason, `field:${item.id}:${key}`);
  };

  const fields: [keyof Rect, string][] = [
    ['x', m.x],
    ['y', m.y],
    ['w', m.width],
    ['h', m.height],
  ];

  return (
    <div className="vbx-popover vbx-menu" role="dialog" aria-label={`${m.brickMenu}: ${name}`}>
      <label className="vbx-field">
        <span className="vbx-field-label">{m.rename}</span>
        <input
          className="vbx-input"
          type="text"
          value={item.title ?? ''}
          onChange={(e) => store.update(item.id, { title: e.target.value || undefined }, `title:${item.id}`)}
        />
      </label>

      <fieldset className="vbx-fieldset" disabled={locked}>
        <legend className="vbx-field-label">{m.positionAndSize}</legend>
        <div className="vbx-rect-fields">
          {fields.map(([key, label]) => (
            <label key={key} className="vbx-rect-field">
              <span aria-hidden="true">{label}</span>
              <input
                className="vbx-input"
                type="number"
                inputMode="numeric"
                aria-label={label}
                min={key === 'x' || key === 'y' ? 0 : 1}
                step={1}
                value={rect ? rect[key] : ''}
                onChange={(e) => setField(key, e.target.value)}
              />
            </label>
          ))}
        </div>
      </fieldset>

      {variantName === BASE ? (
        <label className="vbx-field">
          <span className="vbx-field-label">{m.pinLabel}</span>
          <select
            className="vbx-input"
            value={item.pin ?? 'scale'}
            disabled={locked}
            onChange={(e) => store.update(item.id, { pin: e.target.value as Pin })}
          >
            {PINS.map((pin) => (
              <option key={pin} value={pin}>
                {m.pin[pin]}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="vbx-menu-list" role="group">
        {onEditItem || hasSettings ? (
          <button type="button" className="vbx-menu-item" onClick={run(() => (onEditItem ? onEditItem(item) : inspect(item.id)))}>
            {m.editBrick}
          </button>
        ) : null}
        <button
          type="button"
          className="vbx-menu-item"
          onClick={run(() => {
            const [id] = store.duplicate([item.id]);
            if (id) {
              announce(m.duplicated(1));
              reveal(id);
            }
          })}
        >
          {m.duplicate}
          <kbd>Ctrl D</kbd>
        </button>
        <button type="button" className="vbx-menu-item" onClick={run(() => store.reorder(item.id, 'front'))}>
          {m.bringToFront}
          <kbd>]</kbd>
        </button>
        <button type="button" className="vbx-menu-item" onClick={run(() => store.reorder(item.id, 'back'))}>
          {m.sendToBack}
          <kbd>[</kbd>
        </button>
        <button type="button" className="vbx-menu-item" onClick={run(() => store.update(item.id, { locked: !locked }))}>
          {locked ? m.unlock : m.lock}
        </button>
        <button
          type="button"
          className="vbx-menu-item"
          data-danger=""
          disabled={locked}
          onClick={run(() => {
            store.remove([item.id]);
            announce(m.removed(1));
          })}
        >
          {m.remove}
          <kbd>Del</kbd>
        </button>
      </div>
    </div>
  );
}
