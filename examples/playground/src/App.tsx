import { useEffect, useMemo, useRef, useState } from 'react';
import type { StatusMap } from 'vizbrix/react';
import { parseDashboard, serializeDashboard, type DashboardDoc } from 'vizbrix';
import { builtinBricks, withLabels } from 'vizbrix/bricks';
import { brickLabelsJa, ja } from 'vizbrix/locales/ja';
import { Dashboard, type DashboardHandle } from 'vizbrix/react';
import { buildData } from './data';
import { initialLayout } from './layout';

const STORAGE_KEY = 'vizbrix-playground:v4';
const bricks = withLabels(builtinBricks, brickLabelsJa);

function loadLayout(): DashboardDoc {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const result = parseDashboard(stored);
      if (result.ok) return result.doc;
      console.warn('Stored layout was repaired or rejected:', result.issues);
    }
  } catch {
    // storage unavailable
  }
  return initialLayout;
}

const WIDTHS = [
  { label: 'フル', value: '100%' },
  { label: 'タブレット', value: '820px' },
  { label: 'モバイル', value: '390px' },
];

export function App() {
  const [layout, setLayout] = useState(loadLayout);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light',
  );
  const [width, setWidth] = useState(() => new URLSearchParams(location.search).get('width') ?? '100%');
  const [range, setRange] = useState(1);
  const [editing, setEditing] = useState(() => new URLSearchParams(location.search).has('edit'));
  const ref = useRef<DashboardHandle>(null);
  const [loaded, setLoaded] = useState(range);
  const [status, setStatus] = useState<StatusMap>({});
  const [picked, setPicked] = useState('');
  const data = useMemo(() => buildData(loaded), [loaded]);

  // Simulate a refetch when the period changes: datasets go to "loading",
  // bricks keep their previous render dimmed, then the new data arrives.
  useEffect(() => {
    if (range === loaded) return;
    setStatus(Object.fromEntries(Object.keys(data).map((key) => [key, 'loading' as const])));
    const timer = setTimeout(() => {
      setLoaded(range);
      setStatus({});
    }, 700);
    return () => clearTimeout(timer);
  }, [range, loaded, data]);

  useEffect(() => {
    document.documentElement.dataset.vbxTheme = theme;
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, serializeDashboard(layout));
    } catch {
      // storage unavailable
    }
  }, [layout]);

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          vizbrix
          <span className="tag">playground</span>
        </div>
        <div className="controls">
          <div className="segmented" role="group" aria-label="プレビュー幅">
            {WIDTHS.map((w) => (
              <button key={w.value} type="button" aria-pressed={width === w.value} onClick={() => setWidth(w.value)}>
                {w.label}
              </button>
            ))}
          </div>
          <button type="button" className="ghost" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
            {theme === 'light' ? 'ダーク' : 'ライト'}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setLayout(initialLayout);
            }}
          >
            初期化
          </button>
        </div>
      </header>

      <main className="stage" style={{ maxWidth: width }}>
        <Dashboard
          ref={ref}
          value={layout}
          onChange={setLayout}
          bricks={bricks}
          data={data}
          status={status}
          exportable
          overlap="avoid"
          onSelect={({ item, datum }) => setPicked(`${item.title ?? item.type}: ${JSON.stringify(datum)}`)}
          locale={ja}
          editable
          editing={editing}
          onEditingChange={setEditing}
          aria-label="営業ダッシュボード"
          header={
            <>
              <h1 className="title">営業ダッシュボード</h1>
              <div className="segmented" role="group" aria-label="期間">
                {[
                  { label: '今期', value: 1 },
                  { label: '前期', value: 0.82 },
                ].map((r) => (
                  <button key={r.value} type="button" aria-pressed={range === r.value} onClick={() => setRange(r.value)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </>
          }
        />
        {picked ? (
          <p className="picked" role="status">
            選択: {picked}
          </p>
        ) : null}
      </main>
    </div>
  );
}
