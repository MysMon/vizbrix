/**
 * The demo dashboard's content: a typed `data` payload per item, the default
 * layout document (mixed anchors, one locked item, one forbid-collision item,
 * `at` overrides, tier-3 stacking), and the widget bodies themselves.
 *
 * No chart library anywhere — the "chart" is an inline SVG polyline over a
 * percentage viewBox, which is also why it reflows for free when its item
 * resizes: no JS re-measurement, just the SVG's own scaling.
 */

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { defineLayout } from 'vizbrix';
import type { LayoutDoc } from 'vizbrix';
import type { ItemUI, ItemView } from 'vizbrix/react';

/* ------------------------------------------------------------------ */
/* Typed item data                                                     */
/* ------------------------------------------------------------------ */

export type WidgetData =
  | { kind: 'header'; title: string }
  | { kind: 'kpi'; label: string; value: string; delta: string; trend: 'up' | 'down' }
  | { kind: 'chart'; label: string; points: number[] }
  | { kind: 'notes'; label: string }
  | { kind: 'clock'; label: string }
  | { kind: 'list'; label: string; items: string[] }
  | { kind: 'alert'; label: string; message: string };

/* ------------------------------------------------------------------ */
/* Default layout                                                      */
/* ------------------------------------------------------------------ */

/**
 * Base canvas is 1200×700. `height:'fill'` is what makes the bottom-anchored
 * items (`end`, `both` on y) resolvable — see ARCHITECTURE.md §1.6: under
 * `height:'auto'` those degrade to `start` instead.
 */
export function makeDefaultLayout(): LayoutDoc<WidgetData> {
  return defineLayout<WidgetData>({
    container: {
      base: { width: 1200, height: 700 },
      height: 'fill',
      sizes: { md: { maxWidth: 900 }, sm: { maxWidth: 600 } },
      stackBelow: 480,
    },
    items: [
      // Locked title bar — pinned to both edges (stretches with the
      // container) and cannot be moved or resized in edit mode.
      {
        id: 'header',
        x: 0,
        y: 0,
        w: 1200,
        h: 56,
        anchor: { x: 'both', y: 'start' },
        locked: true,
        order: -2,
        data: { kind: 'header', title: 'Ops Dashboard — free-placement demo' },
      },
      // Fixed distance from the left edge (`start`): stays put as the
      // container shrinks, until tier-3 stacking takes over.
      {
        id: 'kpi-revenue',
        x: 24,
        y: 76,
        w: 210,
        h: 120,
        minW: 160,
        minH: 90,
        data: { kind: 'kpi', label: 'Revenue', value: '$482,910', delta: '+4.8%', trend: 'up' },
      },
      // Also `start`, but carries an `at.sm` override that hides it below
      // 600px — a size-cascade override, not a media query.
      {
        id: 'kpi-active-users',
        x: 250,
        y: 76,
        w: 210,
        h: 120,
        minW: 160,
        minH: 90,
        data: { kind: 'kpi', label: 'Active users', value: '3,214', delta: '-1.2%', trend: 'down' },
        at: { sm: { hidden: true } },
      },
      // `center`: the item's CENTER stays offset from the container's
      // center, so it visibly re-centers as the container is resized.
      {
        id: 'notes',
        x: 490,
        y: 76,
        w: 220,
        h: 160,
        anchor: { x: 'center', y: 'start' },
        order: 3,
        data: { kind: 'notes', label: 'Standup notes' },
      },
      // `end`: pinned a fixed distance from the RIGHT edge — slides with the
      // container instead of staying at a fixed x. Also carries an `at.md`
      // override that shrinks it at the md size (a real AxisPlacement
      // replacement, not a partial merge — §2: modes replace wholesale).
      {
        id: 'chart-sessions',
        x: 710,
        y: 76,
        w: 460,
        h: 260,
        minW: 220,
        minH: 140,
        anchor: { x: 'end', y: 'start' },
        order: 1,
        data: {
          kind: 'chart',
          label: 'Sessions (7d)',
          points: [12, 18, 14, 26, 22, 34, 30, 42, 38, 50, 46, 58],
        },
        at: {
          md: {
            x: { mode: 'end', offset: 20, size: 300 },
            y: { mode: 'start', offset: 60, size: 200 },
          },
        },
      },
      // `scale`: resolves like `start` but reencodes as a fraction of the
      // container — genuinely proportional, not just pinned.
      {
        id: 'clock',
        x: 24,
        y: 252,
        w: 210,
        h: 150,
        anchor: 'scale',
        order: 2,
        data: { kind: 'clock', label: 'Local time' },
      },
      // `collision:'forbid'` — try dragging this onto another widget in edit
      // mode: the ghost tracks the pointer but the drop snaps back to the
      // last valid position (§1.12).
      {
        id: 'alert-banner',
        x: 250,
        y: 252,
        w: 440,
        h: 70,
        collision: 'forbid',
        order: 0,
        data: { kind: 'alert', label: 'Incident', message: 'Elevated latency on checkout-api (p99 380ms)' },
      },
      // `both` on x, `end` on y: stretches full width, pinned to the bottom
      // edge — only resolvable because `container.height:'fill'` is set.
      {
        id: 'todo',
        x: 0,
        y: 506,
        w: 1200,
        h: 170,
        anchor: { x: 'both', y: 'end' },
        order: 4,
        data: {
          kind: 'list',
          label: 'Rollout checklist',
          items: ['Ship behind flag', 'Notify on-call', 'Watch error budget', 'Announce in #releases'],
        },
      },
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Widget chrome                                                       */
/* ------------------------------------------------------------------ */

interface ChromeProps {
  title: string;
  editing: boolean;
  ui: ItemUI;
  locked?: boolean;
  accent?: 'default' | 'alert';
  children: ReactElement | null;
}

/**
 * Shared card frame. The title bar carries `ui.handleProps`, so only the bar
 * — not the whole card — starts a pointer drag; the body stays free for
 * ordinary interaction (typing in the notes textarea, selecting chart text,
 * etc). `ui.moveButtonProps` renders the tap-to-place affordance required for
 * WCAG 2.2 SC 2.5.7 (a non-drag way to move the item).
 */
function WidgetChrome({ title, editing, ui, locked, accent = 'default', children }: ChromeProps): ReactElement {
  return (
    <div className={`widget${accent === 'alert' ? ' widget--alert' : ''}`}>
      <div className="widget__bar" {...(editing && !locked ? ui.handleProps : {})}>
        <span className="widget__title">{title}</span>
        {editing ? (
          <span className="widget__tools">
            {!locked ? (
              <button type="button" className="widget__iconbtn" onClick={ui.bringToFront} title="Bring to front">
                ⬆
              </button>
            ) : null}
            {!locked ? <button {...ui.moveButtonProps} className="widget__iconbtn" title="Move (keyboard)">
              ⤢
            </button> : null}
            {locked ? <span className="widget__lockbadge" title="Locked">🔒</span> : null}
          </span>
        ) : null}
      </div>
      <div className="widget__body">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Widget bodies                                                       */
/* ------------------------------------------------------------------ */

function KpiBody({ data }: { data: Extract<WidgetData, { kind: 'kpi' }> }): ReactElement {
  return (
    <div className="kpi">
      <div className="kpi__value">{data.value}</div>
      <div className={`kpi__delta kpi__delta--${data.trend}`}>
        {data.trend === 'up' ? '▲' : '▼'} {data.delta}
      </div>
    </div>
  );
}

/** No chart library: a percentage-viewBox SVG polyline that scales for free. */
function ChartBody({ data }: { data: Extract<WidgetData, { kind: 'chart' }> }): ReactElement {
  const max = Math.max(...data.points);
  const min = Math.min(...data.points);
  const span = max - min || 1;
  const step = 100 / (data.points.length - 1);
  const coords = data.points
    .map((p, i) => `${(i * step).toFixed(2)},${(38 - ((p - min) / span) * 34).toFixed(2)}`)
    .join(' ');
  const areaCoords = `0,40 ${coords} 100,40`;
  return (
    <svg className="chart" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={areaCoords} className="chart__area" />
      <polyline points={coords} className="chart__line" />
    </svg>
  );
}

function NotesBody(): ReactElement {
  return <textarea className="notes" defaultValue={'- ship v0.1\n- write migration guide'} spellCheck={false} />;
}

function ClockBody(): ReactElement {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <div className="clock">{now.toLocaleTimeString()}</div>;
}

function ListBody({ data }: { data: Extract<WidgetData, { kind: 'list' }> }): ReactElement {
  return (
    <ul className="list">
      {data.items.map((entry) => (
        <li key={entry}>{entry}</li>
      ))}
    </ul>
  );
}

function AlertBody({ data }: { data: Extract<WidgetData, { kind: 'alert' }> }): ReactElement {
  return <p className="alert__message">{data.message}</p>;
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                             */
/* ------------------------------------------------------------------ */

/**
 * Builds the `children` render callback for `<Vizbrix>`. `mode` is closed
 * over rather than read off `ui` because the chrome (drag handle, toolbar,
 * move button) must match the ACTUAL prop passed to `<Vizbrix mode=…>`, not
 * be reverse-engineered from ARIA attributes the library happens to emit.
 */
export function makeItemRenderer(mode: 'view' | 'edit', bridge?: ReactElement | null) {
  const editing = mode === 'edit';
  return function renderItem(item: ItemView<WidgetData>, ui: ItemUI): ReactElement | null {
    const { data } = item;
    if (!data) return null;

    if (data.kind === 'header') {
      return (
        <div className="widget widget--header">
          <span className="widget__title">{data.title}</span>
          {bridge ?? null}
        </div>
      );
    }

    switch (data.kind) {
      case 'kpi':
        return (
          <WidgetChrome title={data.label} editing={editing} ui={ui} locked={item.locked}>
            <KpiBody data={data} />
          </WidgetChrome>
        );
      case 'chart':
        return (
          <WidgetChrome title={data.label} editing={editing} ui={ui} locked={item.locked}>
            <ChartBody data={data} />
          </WidgetChrome>
        );
      case 'notes':
        return (
          <WidgetChrome title={data.label} editing={editing} ui={ui} locked={item.locked}>
            <NotesBody />
          </WidgetChrome>
        );
      case 'clock':
        return (
          <WidgetChrome title={data.label} editing={editing} ui={ui} locked={item.locked}>
            <ClockBody />
          </WidgetChrome>
        );
      case 'list':
        return (
          <WidgetChrome title={data.label} editing={editing} ui={ui} locked={item.locked}>
            <ListBody data={data} />
          </WidgetChrome>
        );
      case 'alert':
        return (
          <WidgetChrome title={data.label} editing={editing} ui={ui} locked={item.locked} accent="alert">
            <AlertBody data={data} />
          </WidgetChrome>
        );
      default:
        return null;
    }
  };
}
