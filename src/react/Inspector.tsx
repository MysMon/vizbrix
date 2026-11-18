import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { DashboardItem } from '../core/types';
import type { DataMap, SettingField } from './brick';
import { itemById, useDashboardContext, useDashboardState } from './context';
import { brickName, definitionOf } from './Shell';

const FORMATS = ['auto', 'number', 'integer', 'compact', 'percent', 'currency:JPY', 'currency:USD', 'currency:EUR'];

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Columns of the row dataset a field draws from, optionally numeric ones only. */
function columnsOf(item: DashboardItem, field: { dataset?: string; numeric?: boolean }, data: DataMap): string[] {
  const ref = item.props?.[field.dataset ?? 'data'];
  const rows = typeof ref === 'string' ? data[ref] : ref;
  if (!Array.isArray(rows) || !rows.length) return [];
  const sample = rows.slice(0, 25).filter(isPlainObject);
  const keys = [...new Set(sample.flatMap((row) => Object.keys(row)))];
  if (!field.numeric) return keys;
  return keys.filter((key) => {
    const value = sample.find((row) => row[key] !== null && row[key] !== undefined)?.[key];
    return typeof value === 'number';
  });
}

/** A JSON editor for an object-valued prop. Keeps the user's text; applies it only while it parses. */
function JsonField(props: { value: unknown; onChange: (value: unknown) => void }): ReactElement {
  const [text, setText] = useState(() => JSON.stringify(props.value ?? {}, null, 2));
  const [invalid, setInvalid] = useState(false);
  const applied = useRef(props.value);
  // Follow outside changes (undo, another editor) without clobbering what is being typed.
  useEffect(() => {
    if (props.value !== applied.current) {
      applied.current = props.value;
      setText(JSON.stringify(props.value ?? {}, null, 2));
      setInvalid(false);
    }
  }, [props.value]);
  return (
    <textarea
      className="vbx-input vbx-textarea vbx-code"
      rows={12}
      spellCheck={false}
      aria-invalid={invalid}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        try {
          const parsed: unknown = JSON.parse(e.target.value);
          setInvalid(false);
          applied.current = parsed;
          props.onChange(parsed);
        } catch {
          setInvalid(true);
        }
      }}
    />
  );
}

/**
 * The settings panel for one brick, generated from its definition's
 * `settings`. Every change is committed immediately — the brick behind the
 * panel is the preview — and typing coalesces into a single undo step.
 */
export function Inspector({ id }: { id: string }): ReactElement | null {
  const { store, bricks, data, messages: m, inspect } = useDashboardContext();
  const item = useDashboardState((s) => itemById(s, id));
  const editing = useDashboardState((s) => s.editing);
  const panel = useRef<HTMLElement>(null);
  const gone = !item || !editing;

  useEffect(() => {
    if (gone) inspect(null);
  }, [gone, inspect]);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus({ preventScroll: true });
  }, [id]);

  if (!item || !editing) return null;
  const definition = definitionOf(item, bricks);
  const fields = definition?.settings ?? [];
  const props = item.props ?? {};

  const set = (key: string, value: unknown): void => {
    const next: Record<string, unknown> = { ...props };
    if (value === undefined || value === '') delete next[key];
    else next[key] = value;
    store.update(id, { props: next }, `prop:${id}:${key}`);
  };

  const label = (field: SettingField): string => field.label ?? m.fields[field.key] ?? field.key;
  const optionLabel = (value: string): string =>
    value.startsWith('currency:') ? value.slice(9) : (m.options[value] ?? value);

  const control = (field: SettingField): ReactNode => {
    const value = props[field.key];
    const name = label(field);
    switch (field.type) {
      case 'text':
        return <input className="vbx-input" type="text" value={typeof value === 'string' ? value : ''} onChange={(e) => set(field.key, e.target.value)} />;
      case 'textarea':
        return <textarea className="vbx-input vbx-textarea" rows={4} value={typeof value === 'string' ? value : ''} onChange={(e) => set(field.key, e.target.value)} />;
      case 'number':
        return (
          <input
            className="vbx-input"
            type="number"
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => set(field.key, e.target.value === '' ? undefined : Number(e.target.value))}
          />
        );
      case 'boolean':
        return null; // rendered as a checkbox row below
      case 'json':
        return <JsonField value={value} onChange={(next) => set(field.key, next)} />;
      case 'select':
        return (
          <select className="vbx-input" value={typeof value === 'string' ? value : ''} onChange={(e) => set(field.key, e.target.value)}>
            {field.optional || typeof value !== 'string' ? <option value="">{field.optional ? m.none : ''}</option> : null}
            {field.options.map((o) => (
              <option key={o} value={o}>
                {optionLabel(o)}
              </option>
            ))}
          </select>
        );
      case 'format': {
        const current = typeof value === 'string' ? value : value === undefined ? 'auto' : '__custom';
        return (
          <select className="vbx-input" value={current} onChange={(e) => set(field.key, e.target.value === 'auto' ? undefined : e.target.value)}>
            {current === '__custom' ? <option value="__custom">{m.custom}</option> : null}
            {(FORMATS.includes(current) || current === '__custom' ? FORMATS : [...FORMATS, current]).map((o) => (
              <option key={o} value={o}>
                {optionLabel(o)}
              </option>
            ))}
          </select>
        );
      }
      case 'dataset': {
        const names = Object.keys(data).filter((key) => (field.shape === 'object' ? isPlainObject(data[key]) : Array.isArray(data[key])));
        const inline = value !== undefined && typeof value !== 'string';
        return (
          <select className="vbx-input" value={inline ? '__inline' : typeof value === 'string' ? value : ''} onChange={(e) => set(field.key, e.target.value)}>
            {inline ? <option value="__inline">{m.inlineData}</option> : null}
            {!inline && (typeof value !== 'string' || !names.includes(value)) ? <option value={typeof value === 'string' ? value : ''}>{typeof value === 'string' ? value : m.none}</option> : null}
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        );
      }
      case 'field': {
        const columns = columnsOf(item, field, data);
        const current = typeof value === 'string' ? value : '';
        return (
          <select className="vbx-input" value={current} onChange={(e) => set(field.key, e.target.value)}>
            {field.optional || !current ? <option value="">{m.none}</option> : null}
            {current && !columns.includes(current) ? <option value={current}>{current}</option> : null}
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        );
      }
      case 'fields': {
        const list = Array.isArray(value) ? (value as (string | { key: string })[]) : [];
        const keyOf = (entry: string | { key: string }): string => (typeof entry === 'string' ? entry : entry.key);
        const chosen = list.map(keyOf);
        const columns = [...new Set([...columnsOf(item, field, data), ...chosen])];
        const toggle = (column: string, on: boolean): void => {
          // Keep existing entries (with their labels and colours) and their order.
          const next = on ? [...list, column] : list.filter((entry) => keyOf(entry) !== column);
          set(field.key, next.length ? next : undefined);
        };
        return (
          <div className="vbx-checks" role="group" aria-label={name}>
            {columns.length === 0 ? <span className="vbx-field-hint">{m.noData}</span> : null}
            {columns.map((c) => (
              <label key={c} className="vbx-check">
                <input type="checkbox" checked={chosen.includes(c)} onChange={(e) => toggle(c, e.target.checked)} />
                <span>{c}</span>
              </label>
            ))}
          </div>
        );
      }
    }
  };

  return (
    <aside className="vbx-inspector" ref={panel} aria-label={`${m.settings}: ${brickName(item, bricks, m)}`} data-vbx-nodrag="">
      <header className="vbx-inspector-head">
        <div>
          <div className="vbx-field-label">{m.settings}</div>
          <div className="vbx-inspector-title">{brickName(item, bricks, m)}</div>
        </div>
        <button type="button" className="vbx-icon-button" aria-label={m.close} onClick={() => inspect(null)}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>
      <div className="vbx-inspector-body">
        <label className="vbx-field">
          <span className="vbx-field-label">{m.rename}</span>
          <input
            className="vbx-input"
            type="text"
            value={item.title ?? ''}
            onChange={(e) => store.update(id, { title: e.target.value || undefined }, `title:${id}`)}
          />
        </label>
        {fields.map((field) =>
          field.type === 'boolean' ? (
            <label key={field.key} className="vbx-check">
              <input type="checkbox" checked={props[field.key] === true} onChange={(e) => set(field.key, e.target.checked || undefined)} />
              <span>{label(field)}</span>
            </label>
          ) : field.type === 'fields' ? (
            <div key={field.key} className="vbx-field">
              <span className="vbx-field-label">{label(field)}</span>
              {control(field)}
            </div>
          ) : (
            <label key={field.key} className="vbx-field">
              <span className="vbx-field-label">{label(field)}</span>
              {control(field)}
            </label>
          ),
        )}
      </div>
    </aside>
  );
}
