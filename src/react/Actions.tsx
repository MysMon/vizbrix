import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { DashboardItem } from '../core/types';
import { useDashboardContext } from './context';
import { brickRows, downloadBlob, elementToPng, safeFilename, toCsv } from './export';
import { MoreIcon } from './icons';

/** View-mode brick actions: download the data as CSV or the brick as an image. */
export function BrickActions({ item, name }: { item: DashboardItem; name: string }): ReactElement {
  const { data, messages: m } = useDashboardContext();
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

  useEffect(() => {
    const host = wrap.current?.closest<HTMLElement>('[data-vbx-item]');
    if (!host) return;
    if (open) host.setAttribute('data-menu-open', '');
    else host.removeAttribute('data-menu-open');
    return () => host.removeAttribute('data-menu-open');
  }, [open]);

  const rows = brickRows(item, data);
  const file = safeFilename(item.title || name);

  const csv = (): void => {
    setOpen(false);
    downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), `${file}.csv`);
  };

  const png = (): void => {
    setOpen(false);
    const brick = wrap.current?.closest('[data-vbx-item]')?.querySelector<HTMLElement>('.vbx-brick');
    if (!brick) return;
    // Wait a frame so the menu is gone from the picture.
    requestAnimationFrame(() => {
      elementToPng(brick)
        .then((blob) => downloadBlob(blob, `${file}.png`))
        .catch((error: unknown) => console.error(error));
    });
  };

  return (
    <div className="vbx-item-menu vbx-brick-actions" ref={wrap} data-open={open ? '' : undefined}>
      <button
        ref={button}
        type="button"
        className="vbx-icon-button"
        aria-label={`${m.brickActions}: ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreIcon />
      </button>
      {open ? (
        <div className="vbx-popover vbx-menu" role="menu" aria-label={m.brickActions}>
          <div className="vbx-menu-list" data-plain="">
            <button type="button" role="menuitem" className="vbx-menu-item" disabled={rows.length === 0} onClick={csv}>
              {m.exportCsv}
            </button>
            <button type="button" role="menuitem" className="vbx-menu-item" onClick={png}>
              {m.exportPng}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
