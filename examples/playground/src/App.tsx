/**
 * Host-app chrome around the dashboard.
 *
 * Everything in this file is plain React talking to vizbrix through its
 * public surface — nothing here reaches into vizbrix internals. The one
 * wrinkle: `useHistory()`/`useVizbrix()` only work INSIDE the `<Vizbrix>`
 * subtree (they read React context), but the undo/redo buttons live in the
 * toolbar, outside it. `Bridge` (rendered as part of the locked header
 * item's own content, see `widgets.tsx`) calls those hooks where they're
 * legal and lifts the result up via a plain `useState` setter — the hooks
 * are still the source of truth, just re-exposed one level up.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import { Vizbrix, useHistory, useVizbrix } from 'vizbrix/react';
import type { HistoryApi } from 'vizbrix/react';
import { load, serialize } from 'vizbrix';
import type { LayoutDoc, LayoutItemBase, Transaction, VizbrixStore } from 'vizbrix';
import { ja } from 'vizbrix/locales/ja';
import { makeDefaultLayout, makeItemRenderer } from './widgets';
import type { WidgetData } from './widgets';

const STORAGE_KEY = 'vizbrix-playground-layout-v1';
const INSTANCE_ID = 'vzbplayground';
const MIN_WIDTH = 320;
const MAX_WIDTH = 1400;

/**
 * Human labels for announcements and undo/redo labels (`strings.undoLabel`,
 * the a11y live regions, `moveButtonLabel`). `getLabel` receives a
 * `LayoutItemBase` — no `data` field — so this is the simplest correct way to
 * turn "notes" into "Standup notes" without casting.
 */
const ITEM_LABELS: Record<string, string> = {
  header: 'Dashboard title bar',
  'kpi-revenue': 'Revenue',
  'kpi-active-users': 'Active users',
  notes: 'Standup notes',
  'chart-sessions': 'Sessions chart',
  clock: 'Local time clock',
  'alert-banner': 'Incident banner',
  todo: 'Rollout checklist',
};

function getItemLabel(item: LayoutItemBase): string {
  return ITEM_LABELS[item.id] ?? item.id;
}

/* ------------------------------------------------------------------ */
/* Bridge: lifts store + history out of the <Vizbrix> subtree           */
/* ------------------------------------------------------------------ */

interface BridgeInfo {
  store: VizbrixStore<WidgetData>;
  history: HistoryApi;
}

function Bridge({ onReady }: { onReady: (info: BridgeInfo) => void }): null {
  const api = useVizbrix<WidgetData>();
  const history = useHistory();
  useEffect(() => {
    onReady({ store: api.store, history });
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* Live readout of the measured container width / active size          */
/* ------------------------------------------------------------------ */

function useActiveSizeLabel(store: VizbrixStore<WidgetData> | null): string {
  const subscribe = useCallback(
    (cb: () => void) => (store ? store.subscribeContainer(cb) : () => {}),
    [store],
  );
  const getSnapshot = useCallback((): string => {
    if (!store) return '—';
    const width = Math.round(store.getContainerWidth());
    const active = store.getActiveSizes();
    const sizeLabel = active.length > 0 ? active.join(' → ') : 'base';
    return `${width}px · ${sizeLabel}${store.isStacked() ? ' · stacked' : ''}`;
  }, [store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/* ------------------------------------------------------------------ */
/* Emitted-CSS pane                                                    */
/* ------------------------------------------------------------------ */

function EmittedCssPane(): ReactElement {
  const [open, setOpen] = useState(false);
  const [css, setCss] = useState('');

  useEffect(() => {
    if (!open) return;
    const read = (): void => {
      const el = document.querySelector<HTMLStyleElement>(`style[data-vzb-style="${INSTANCE_ID}"]`);
      setCss(el?.textContent ?? '');
    };
    read();
    const id = window.setInterval(read, 500);
    return () => window.clearInterval(id);
  }, [open]);

  return (
    <section className="css-pane">
      <button type="button" className="css-pane__toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? '▾' : '▸'} Show emitted CSS
      </button>
      {open ? (
        <pre className="css-pane__code">
          <code>{css || '/* no rules yet */'}</code>
        </pre>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                  */
/* ------------------------------------------------------------------ */

function loadInitialDoc(): LayoutDoc<WidgetData> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const outcome = load<WidgetData>(JSON.parse(raw));
      if (outcome.status === 'ok' || outcome.status === 'migrated') return outcome.doc;
      // 'forward-degraded' | 'incompatible' | 'invalid': fall through to the
      // built-in default rather than render nothing.
    }
  } catch {
    /* malformed localStorage entry — ignore and start fresh */
  }
  return makeDefaultLayout();
}

export function App(): ReactElement {
  const [mode, setMode] = useState<'view' | 'edit'>('edit');
  const [doc, setDoc] = useState<LayoutDoc<WidgetData>>(loadInitialDoc);
  const [snapOn, setSnapOn] = useState(true);
  const [gridOn, setGridOn] = useState(false);
  const [locale, setLocale] = useState<'en' | 'ja'>('en');
  const [containerWidth, setContainerWidth] = useState(1200);
  const [bridge, setBridge] = useState<BridgeInfo | null>(null);
  const [lastChange, setLastChange] = useState<string | null>(null);

  const handleLayoutChange = useCallback((next: LayoutDoc<WidgetData>, tx: Transaction) => {
    setDoc(next);
    setLastChange(tx.label.kind);
    try {
      localStorage.setItem(STORAGE_KEY, serialize(next));
    } catch {
      /* storage full / disabled — the demo still works, it just won't persist */
    }
  }, []);

  const handleReset = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setDoc(makeDefaultLayout());
    setLastChange(null);
  }, []);

  // Stable across renders: onReady itself never changes identity, and the
  // element wrapping it doesn't need to either — recreating it every render
  // would bump the item renderer's `renderVersion` for no reason.
  const bridgeElement = useRef(<Bridge onReady={setBridge} />).current;
  const children = useMemo(() => makeItemRenderer(mode, bridgeElement), [mode, bridgeElement]);

  const activeSizeLabel = useActiveSizeLabel(bridge?.store ?? null);
  const history = bridge?.history;

  const strings = locale === 'ja' ? ja : undefined;
  const snap = snapOn ? (gridOn ? { grid: 8 } : undefined) : false;

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar__brand">
          <span className="toolbar__logo">vizbrix</span>
          <span className="toolbar__tagline">free-placement layout, live</span>
        </div>

        <div className="toolbar__group" role="group" aria-label="Mode">
          <button
            type="button"
            className={`btn ${mode === 'view' ? 'btn--active' : ''}`}
            onClick={() => setMode('view')}
          >
            View
          </button>
          <button
            type="button"
            className={`btn ${mode === 'edit' ? 'btn--active' : ''}`}
            onClick={() => setMode('edit')}
          >
            Edit
          </button>
        </div>

        <div className="toolbar__group" role="group" aria-label="History">
          <button
            type="button"
            className="btn"
            onClick={history?.undo}
            disabled={!history?.canUndo}
            title={history?.undoLabel ?? 'Nothing to undo'}
          >
            ↶ Undo
          </button>
          <button
            type="button"
            className="btn"
            onClick={history?.redo}
            disabled={!history?.canRedo}
            title={history?.redoLabel ?? 'Nothing to redo'}
          >
            ↷ Redo
          </button>
        </div>

        <label className="field">
          <input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} />
          Snap
        </label>
        <label className="field">
          <input
            type="checkbox"
            checked={gridOn}
            disabled={!snapOn}
            onChange={(e) => setGridOn(e.target.checked)}
          />
          Grid (8px)
        </label>

        <label className="field">
          Locale
          <select value={locale} onChange={(e) => setLocale(e.target.value as 'en' | 'ja')}>
            <option value="en">English</option>
            <option value="ja">日本語</option>
          </select>
        </label>

        <button type="button" className="btn" onClick={handleReset}>
          Reset
        </button>
      </header>

      <div className="width-control">
        <label htmlFor="width-slider">Container width</label>
        <input
          id="width-slider"
          type="range"
          min={MIN_WIDTH}
          max={MAX_WIDTH}
          step={10}
          value={containerWidth}
          onChange={(e) => setContainerWidth(Number(e.target.value))}
        />
        <span className="width-control__value">{containerWidth}px</span>
        <span className="width-control__readout">{activeSizeLabel}</span>
      </div>

      <div className="canvas-shell">
        <div className="canvas-frame" style={{ width: `${containerWidth}px` }}>
          <Vizbrix<WidgetData>
            instanceId={INSTANCE_ID}
            layout={doc}
            onLayoutChange={handleLayoutChange}
            mode={mode}
            snap={snap}
            strings={strings}
            getLabel={getItemLabel}
            className="dashboard"
          >
            {children}
          </Vizbrix>
        </div>
      </div>

      <div className="status-line">
        {lastChange ? <span>last change: {lastChange}</span> : <span>loaded from {hasStoredLayout() ? 'localStorage' : 'built-in default'}</span>}
      </div>

      <EmittedCssPane />
    </div>
  );
}

function hasStoredLayout(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}
