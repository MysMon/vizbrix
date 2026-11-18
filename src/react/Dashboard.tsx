import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { activeVariant, compileCss } from '../core/geometry';
import { attachInteractions } from '../core/interaction';
import { en, type Messages } from '../core/messages';
import { DEFAULT_SNAP, type SnapOptions } from '../core/snap';
import { createDashboardStore, type ChangeMeta, type DashboardStore } from '../core/store';
import type { DashboardDoc, DashboardItem } from '../core/types';
import type { BrickRegistry, BrickSelection, DataMap, StatusMap } from './brick';
import {
  DashboardContext,
  itemById,
  useDashboardContext,
  useDashboardState,
  type DashboardContextValue,
} from './context';
import { brickRows, downloadBlob, elementToPng, safeFilename, toCsv } from './export';
import { Inspector } from './Inspector';
import { Item } from './Item';
import { brickName } from './Shell';
import { Toolbar } from './Toolbar';

export interface DashboardProps {
  /** Controlled document. Pair with `onChange`. */
  value?: DashboardDoc;
  /** Initial document when uncontrolled. */
  defaultValue?: DashboardDoc;
  /** Called once per committed change — a finished drag, an undo, an added brick. */
  onChange?: (doc: DashboardDoc, meta: ChangeMeta) => void;
  /** Brick types this dashboard can render. */
  bricks?: BrickRegistry;
  /** Named datasets bricks can reference from their props. */
  data?: DataMap;
  /** Fallback renderer for brick types missing from `bricks`. */
  renderItem?: (item: DashboardItem, state: { editing: boolean }) => ReactNode;
  /** Whether the user may switch to edit mode. Default false: a read-only dashboard. */
  editable?: boolean;
  /** Controlled edit mode. */
  editing?: boolean;
  defaultEditing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  /** Show the built-in toolbar. Defaults to `editable`. */
  toolbar?: boolean;
  /** Content for the left side of the toolbar: a title, filters, a date range. */
  header?: ReactNode;
  /**
   * Loading state per dataset name. `'loading'` shows a placeholder until the
   * data arrives (and dims the previous render while refetching); `'error'`
   * shows a message with a retry button when `onRetry` is set.
   */
  status?: StatusMap;
  onRetry?: (dataset: string) => void;
  /** The user picked a mark or row inside a brick (view mode) — drill down, cross-filter. */
  onSelect?: (event: BrickSelection & { item: DashboardItem }) => void;
  /** Show per-brick actions (download CSV / image) on hover in view mode. */
  exportable?: boolean;
  /**
   * Replaces the built-in settings panel: called from each brick's
   * "Settings…" menu entry so the app can open its own UI.
   */
  onEditItem?: (item: DashboardItem) => void;
  snap?: Partial<SnapOptions> | false;
  /**
   * `'allow'` (default): bricks may overlap — free placement. `'avoid'`: a
   * dropped brick lands in the nearest free spot, and a resize that would
   * cover a neighbour is refused.
   */
  overlap?: 'allow' | 'avoid';
  /** Translations; English by default. See `vizbrix/locales/ja`. */
  locale?: Messages;
  /** Force a colour scheme. Omit to inherit from the page. */
  theme?: 'light' | 'dark' | 'auto';
  /** Undo steps to keep. Default 100. */
  historyLimit?: number;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
}

/** Imperative API, available through `ref` and `useDashboard()`. */
export interface DashboardHandle {
  store: DashboardStore;
  getValue(): DashboardDoc;
  add: DashboardStore['add'];
  remove: DashboardStore['remove'];
  update: DashboardStore['update'];
  undo(): void;
  redo(): void;
  setEditing(editing: boolean): void;
  /** Scroll a brick into view and focus it. */
  reveal(id: string): void;
  /** Open the built-in settings panel for a brick (edit mode), or close it with null. */
  inspect(id: string | null): void;
  /** The brick's data as CSV text (empty when it has none). */
  toCsv(id: string): string;
  /** Download a brick's data as a CSV file. */
  exportCsv(id: string): void;
  /** Download a brick as a PNG image. */
  exportPng(id: string): Promise<void>;
}

const EMPTY_BRICKS: BrickRegistry = {};
const EMPTY_DATA: DataMap = {};
const EMPTY_STATUS: StatusMap = {};
const EMPTY_DOC: DashboardDoc = {
  version: 1,
  width: 1200,
  gap: 16,
  padding: 0,
  breakpoints: [],
  items: [],
  layouts: {},
};

export const Dashboard = forwardRef<DashboardHandle, DashboardProps>(function Dashboard(props, ref): ReactElement {
  const {
    value,
    defaultValue,
    onChange,
    bricks = EMPTY_BRICKS,
    data = EMPTY_DATA,
    renderItem,
    editable = false,
    editing: editingProp,
    defaultEditing = false,
    onEditingChange,
    toolbar = editable,
    header,
    status = EMPTY_STATUS,
    onRetry,
    onSelect,
    exportable = false,
    onEditItem,
    snap,
    overlap = 'allow',
    locale = en,
    theme,
    historyLimit,
    className,
    style,
  } = props;

  const [store] = useState(() =>
    createDashboardStore({
      doc: value ?? defaultValue ?? EMPTY_DOC,
      editing: editable && (editingProp ?? defaultEditing),
      historyLimit,
    }),
  );

  // Latest-value refs: the store and the interaction controller outlive
  // renders, so they read props through these instead of capturing them.
  const latest = useRef({ onChange, onEditingChange, editingProp, snap, locale, bricks, overlap });
  latest.current = { onChange, onEditingChange, editingProp, snap, locale, bricks, overlap };

  useEffect(() => {
    store.setOnChange((doc, meta) => latest.current.onChange?.(doc as DashboardDoc, meta));
    store.setAvoidOverlap(() => latest.current.overlap === 'avoid');
    return () => store.setOnChange(undefined);
  }, [store]);

  // Controlled document: adopt whatever the parent hands back. Echoing the
  // document we just emitted is a no-op, so undo history survives.
  useEffect(() => {
    if (value !== undefined) store.replace(value);
  }, [store, value]);

  useEffect(() => {
    if (!editable) store.setEditing(false);
    else if (editingProp !== undefined) store.setEditing(editingProp);
  }, [store, editable, editingProp]);

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const guidesRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  const announce = useCallback((text: string) => {
    const node = liveRef.current;
    if (!node) return;
    // Alternate a trailing no-break space so repeating the same message is still announced.
    node.textContent = node.textContent === text ? `${text} ` : text;
  }, []);

  const setEditing = useCallback(
    (next: boolean) => {
      if (latest.current.editingProp === undefined) store.setEditing(next);
      latest.current.onEditingChange?.(next);
    },
    [store],
  );

  const reveal = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      for (const child of canvas.children) {
        if (child instanceof HTMLElement && child.dataset.vbxItem === id) {
          child.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          child.focus({ preventScroll: true });
          return;
        }
      }
    });
  }, []);

  const [inspecting, inspect] = useState<string | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  useImperativeHandle(ref, () => {
    const find = (id: string): DashboardItem | undefined => itemById(store.getState(), id);
    const filename = (item: DashboardItem): string =>
      safeFilename(brickName(item, latest.current.bricks, latest.current.locale));
    const csv = (id: string): string => {
      const item = find(id);
      const rows = item ? brickRows(item, dataRef.current) : [];
      return rows.length ? toCsv(rows) : '';
    };
    return {
      store,
      getValue: () => store.getState().doc as DashboardDoc,
      add: store.add,
      remove: store.remove,
      update: store.update,
      undo: store.undo,
      redo: store.redo,
      setEditing,
      reveal,
      inspect,
      toCsv: csv,
      exportCsv(id) {
        const item = find(id);
        if (item) downloadBlob(new Blob([csv(id)], { type: 'text/csv;charset=utf-8' }), `${filename(item)}.csv`);
      },
      async exportPng(id) {
        const item = find(id);
        const canvas = canvasRef.current;
        if (!item || !canvas) return;
        for (const child of canvas.children) {
          if (child instanceof HTMLElement && child.dataset.vbxItem === id) {
            const brick = child.querySelector<HTMLElement>('.vbx-brick');
            if (brick) downloadBlob(await elementToPng(brick), `${filename(item)}.png`);
            return;
          }
        }
      },
    };
  }, [store, setEditing, reveal]);

  // Track which variant is on screen, so edits land in the layout the user sees.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    let width = canvas.getBoundingClientRect().width;
    const sync = (): void => {
      if (width > 0) store.setVariant(activeVariant(store.getState().doc, width));
    };
    const observer = new ResizeObserver((entries) => {
      width = entries[entries.length - 1]!.contentRect.width;
      sync();
    });
    observer.observe(canvas);
    sync();
    const unsubscribe = store.subscribe(sync);
    return () => {
      observer.disconnect();
      unsubscribe();
    };
  }, [store]);

  // Pointer and keyboard editing. Attached only when editing is possible:
  // a read-only dashboard registers no listeners at all.
  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const guides = guidesRef.current;
    if (!editable || !root || !canvas || !guides) return;
    return attachInteractions({
      root,
      canvas,
      guides,
      store,
      snap: () => {
        const s = latest.current.snap;
        return s === false ? { grid: 0, items: false, threshold: 0 } : { ...DEFAULT_SNAP, ...s };
      },
      messages: () => latest.current.locale,
      announce,
      nameOf: (id) => {
        const item = itemById(store.getState(), id);
        return item ? brickName(item, latest.current.bricks, latest.current.locale) : id;
      },
    });
  }, [store, editable, announce]);

  const context = useMemo<DashboardContextValue>(
    () => ({
      store,
      bricks,
      data,
      messages: locale,
      editable,
      onEditItem,
      renderItem,
      announce,
      setEditing,
      reveal,
      status,
      onRetry,
      onSelect,
      exportable,
      inspect,
    }),
    [store, bricks, data, locale, editable, onEditItem, renderItem, announce, setEditing, reveal, status, onRetry, onSelect, exportable],
  );

  return (
    <DashboardContext.Provider value={context}>
      <div
        ref={rootRef}
        className={className ? `vbx ${className}` : 'vbx'}
        style={style}
        data-vbx-theme={theme}
        lang={locale.lang}
      >
        {toolbar || header ? <Toolbar header={header} /> : null}
        <Surface canvasRef={canvasRef} guidesRef={guidesRef} label={props['aria-label'] ?? locale.dashboard} />
        {inspecting ? <Inspector id={inspecting} /> : null}
        <div ref={liveRef} className="vbx-sr-only" aria-live="polite" aria-atomic="true" />
      </div>
    </DashboardContext.Provider>
  );
});

/**
 * The canvas and its stylesheet. Split out so a document change re-renders
 * this list (cheap: memoized items keyed by id) and not the toolbar's parent.
 */
function Surface(props: {
  canvasRef: Ref<HTMLDivElement>;
  guidesRef: Ref<HTMLDivElement>;
  label: string;
}): ReactElement {
  const { messages, editable } = useDashboardContext();
  const scope = useId();
  const doc = useDashboardState((s) => s.doc);
  const editing = useDashboardState((s) => s.editing);
  const css = useMemo(() => compileCss(doc, scope), [doc, scope]);

  return (
    <div className="vbx-viewport" data-vbx-scope={scope} data-editing={editing ? '' : undefined}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="vbx-canvas" ref={props.canvasRef} role="region" aria-label={props.label}>
        {doc.items.map((item) => (
          <Item key={item.id} id={item.id} />
        ))}
        <div className="vbx-guides" ref={props.guidesRef} aria-hidden="true" />
      </div>
      {doc.items.length === 0 ? (
        <div className="vbx-empty">
          <p className="vbx-empty-title">{messages.emptyTitle}</p>
          <p className="vbx-empty-hint">{editable && editing ? messages.emptyHintEditing : messages.emptyHint}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Access the dashboard's imperative API from a brick or a toolbar slot. */
export function useDashboard(): Pick<DashboardHandle, 'store' | 'setEditing' | 'reveal'> {
  const { store, setEditing, reveal } = useDashboardContext();
  return { store, setEditing, reveal };
}
