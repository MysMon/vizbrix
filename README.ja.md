# vizbrix

**React のためのダッシュボード・ブリック。自由に置けて、ちゃんとリフローするレイアウト。そこに並べるチャートと数値タイル。そして並べ替えるためのエディタ。**

[![CI](https://github.com/MysMon/vizbrix/actions/workflows/ci.yml/badge.svg)](https://github.com/MysMon/vizbrix/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

*[English README →](./README.md)*

```tsx
import { createDashboard } from 'vizbrix';
import { Dashboard } from 'vizbrix/react';
import { builtinBricks } from 'vizbrix/bricks';
import 'vizbrix/styles.css';

const layout = createDashboard({
  items: [
    { id: 'mrr', type: 'stat', title: 'MRR', x: 0, y: 0, w: 300, h: 148,
      props: { data: 'mrr', format: 'currency:JPY', deltaLabel: '前月比' } },
    { id: 'sales', type: 'line', title: '売上推移', x: 300, y: 0, w: 900, h: 320,
      props: { data: 'sales', x: 'month', series: ['実績', '計画'] } },
  ],
});

export function Page() {
  const [doc, setDoc] = useState(layout);
  return (
    <Dashboard
      value={doc}
      onChange={setDoc}          // ドラッグ1回・undo1回につき1度だけ呼ばれる
      bricks={builtinBricks}
      data={{ mrr: { value: 62_380_000, delta: 0.057 }, sales: rows }}
      editable                   // 「編集」ボタン・追加・undo/redo が付く
    />
  );
}
```

これで、KPI タイルと折れ線グラフが並び、利用者がドラッグとリサイズで組み替えられ、タブレット幅で
2 列・スマートフォン幅で 1 列に自動で組み替わるダッシュボードになります。ランタイム依存はゼロです。

---

## 考え方

**ダッシュボードはブリックの集まり。** ブリックは「種類 (`type`)・位置・設定 (`props`)」だけを持つ
JSON で、描画方法はレジストリ (`bricks`) が、データは `data` が与えます。レイアウト定義はそのまま
データベースに保存でき、データは画面側で差し替えられます。

**自由配置が保存形式。** 位置は列番号ではなく、設計幅（既定 1200）に対する矩形 `x, y, w, h` です。
グリッドは保存モデルではなく、操作時のスナップ先のひとつにすぎません。

**それでもリフローする。** 自由配置を「縮小するだけ」で終わらせません。

- 矩形は**タイル**として保存されます。隣り合うブリックは辺を共有し、ブリック間の余白 (`gap`) は
  描画時に引かれます。だから幅が変わっても余白は常に同じピクセル数です。
- 横方向の追従はブリックごとに選べます (`pin`)。既定は `scale`（幅に比例）。`left` / `right`
  （固定幅で端に固定）、`stretch`（両端固定で幅が伸縮）、`center` も選べます。
- ブレークポイント未満では、読み順（行ごとに左から右）でブリックを N 列に流し込んだレイアウトが
  **自動で導出**されます。その幅で一度でも手で動かすと、その幅専用の配置として保存されます。
- ブレークポイントはビューポートではなく**ダッシュボード自身の幅**（コンテナクエリ）で切り替わり
  ます。サイドバーの開閉や分割ペインの中でも正しく動きます。

**レイアウトは静的な CSS。** どの幅の配置も `left: calc(25% + 4px)` のような CSS にコンパイルされ
ます。サーバーは画面幅を知らなくても正しい初回描画を返せ、レイアウトのための JavaScript は実行
されません。

---

## インストール

```sh
npm install vizbrix
```

React 18 / 19 に対応しています。スタイルは `import 'vizbrix/styles.css'` で読み込みます。

| エントリ | 中身 | gzip |
|---|---|---|
| `vizbrix` | ドキュメントモデル、読み込み/保存、ジオメトリ、ストア（フレームワーク非依存） | 約 12 KB |
| `vizbrix/react` | `<Dashboard>` — 表示とエディタ | 約 18 KB |
| `vizbrix/react/static` | `<DashboardStatic>` — フックなしの Server Component | 約 3 KB |
| `vizbrix/charts` | チャートと数値タイル。単体でも使えます | 約 16 KB |
| `vizbrix/bricks` | 組み込みブリックのレジストリ | 約 3 KB |
| `vizbrix/locales/ja` | 日本語の文言とブリック名 | 約 2 KB |
| `vizbrix/styles.css` | テーマ（ライト/ダーク） | 約 7 KB |

---

## 組み込みブリック

| type | 用途 | 主な props |
|---|---|---|
| `stat` | 主要な数値・前期比・スパークライン | `value` `format` `delta` `deltaLabel` `upIsGood` `trend` |
| `line` / `area` | 時系列。複数系列、積み上げ、スムージング | `data` `x` `series` `stacked` `curve` `xType` `yFormat` |
| `bar` | カテゴリ比較。並列/積み上げ、縦/横、折れ線の重ね描き（`lines`） | `data` `x` `series` `lines` `stacked` `horizontal` `labels` |
| `scatter` | 2 指標の関係。グループ色分け、バブル | `data` `x` `y` `group` `label` `size` |
| `heatmap` | 2 分類にまたがる量（曜日×時間帯など） | `data` `x` `y` `value` `labels` |
| `funnel` | 段階ごとの数と転換率 | `data` `label` `value` |
| `donut` / `segmented` | 構成比 | `data` `label` `value` `format` `centerLabel` |
| `barlist` | ランキング | `data` `label` `value` `limit` |
| `meter` | 目標に対する進捗 | `value` `max` `status` `statusLabel` |
| `table` | 並べ替え・検索・列幅変更ができる表。行は仮想化 | `data` `columns` `searchable` |
| `text` | 見出し・注記（枠なし） | `text` `variant` |

`data` には行の配列を直接書くか、`<Dashboard data={…}>` に渡したデータセットの**名前**を書きます。
`stat` と `meter` は、名前で指したオブジェクトの `value` や `delta` を取り込みます。

`format` は保存できる値です: `'auto'`（1 万以上で自動的に短縮表記）、`'number'`、`'integer'`、
`'compact'`、`'percent'`、`'currency:JPY'`、または `Intl.NumberFormatOptions`。

日本語のブリック名にするには:

```tsx
import { builtinBricks, withLabels } from 'vizbrix/bricks';
import { ja, brickLabelsJa } from 'vizbrix/locales/ja';

<Dashboard bricks={withLabels(builtinBricks, brickLabelsJa)} locale={ja} … />
```

折れ線・棒には `references: [{ value: 2300, label: '月次目標' }]` で基準線を引けます。折れ線は
`zoom: true` でドラッグによる期間ズームができます。表の列は `kind` で見せ方を選べます:

```ts
columns: [
  { key: 'name', kind: 'link', href: '/deals/{id}' },                      // {列名} は行の値に置換
  { key: 'stage', kind: 'badge', tones: { 契約: 'good', 見積: 'warning' } },
  { key: 'probability', kind: 'progress' },
]
```

### 自前のブリック

```tsx
import { defineBrick, resolveData } from 'vizbrix/react';

const map = defineBrick<{ data?: string; zoom?: number }>({
  label: '地図',                       // 「追加」メニューに出る名前
  defaults: { w: 600, h: 400, title: '拠点', props: { zoom: 5 } },
  flush: true,                         // 本文の余白をなくす
  settings: [                          // 設定パネルの項目（任意）
    { key: 'data', type: 'dataset' },
    { key: 'zoom', type: 'number', label: 'ズーム' },
  ],
  render: ({ props, data }) => <StoreMap points={resolveData(props.data, data)} zoom={props.zoom} />,
});

<Dashboard bricks={{ ...builtinBricks, map }} … />
```

レジストリにない `type` は `renderItem` で受けられます。どちらにもなければプレースホルダを表示し、
描画中に例外を投げたブリックはそのブリックだけがエラー表示になります。

---

## チャートを単体で使う

`vizbrix/charts` はダッシュボードなしでも使えます。親要素の大きさに合わせて描画するので、高さの
決まった要素に入れるか `height` を渡します。

```tsx
import { LineChart, BarChart, StatTile, DataTable } from 'vizbrix/charts';

<LineChart data={rows} x="date" series={[{ key: 'pv', label: 'PV' }, 'uu']} height={280} lang="ja" />
<BarChart data={rows} x="region" series={['sales']} horizontal labels height={240} />
<StatTile label="契約社数" value={1284} delta={0.042} deltaLabel="前月比" />
<DataTable data={deals} columns={[{ key: 'name' }, { key: 'amount', format: 'currency:JPY' }]} height={360} />
```

- 軸は 1 本。棒に折れ線を重ねる複合グラフ（`lines`）も同じ軸を共有します。系列の色は宣言順で固定され、系列を隠しても残りの色は変わりません。
- 折れ線は最寄りの X にスナップする十字線と、全系列を並べたツールチップ。棒はカテゴリ全体がホバー
  領域です。どちらも矢印キーで同じ値を読めます。
- 折れ線・棒グラフは表表示に切り替えられ、構成比のチャートは数値を凡例に併記します。色だけで系列を区別させません。
- 描画点数は表示ピクセル数に合わせて間引かれます（LTTB）。10 万点の系列でも 1,000 点とほぼ同じ
  コストです。`DataTable` は表示範囲の行だけをマウントします。
- 既定の配色は、隣り合う系列が色覚多様性のもとでも区別できる順序で検証済みです。

---

## 編集

`editable` を付けるとツールバーに「編集」が現れます。編集モードでは:

| 操作 | 方法 |
|---|---|
| 移動 | ドラッグ／矢印キー（Alt で 1 単位） |
| サイズ変更 | 8 方向のハンドル／Shift＋矢印キー |
| 複数選択 | Shift（または Ctrl/⌘）＋クリック。まとめて移動できます |
| スナップ | 他ブリックの辺・中心、キャンバスの端、8px グリッド。Ctrl/⌘ を押している間は無効 |
| 追加・複製・削除 | 「追加」メニュー／Ctrl+D／Delete |
| 重ね順 | `]` で最前面、`[` で最背面 |
| 元に戻す・やり直す | Ctrl+Z／Ctrl+Shift+Z（連続したキー操作は 1 手にまとまります） |
| 範囲選択 | 空いた場所からドラッグ。Ctrl+A ですべて選択 |
| 整列・等間隔 | 2 つ以上選択するとツールバーに表示 |
| コピー＆ペースト | Ctrl+C／Ctrl+V（同じページの別ダッシュボードにも貼れます） |
| キャンセル | ドラッグ中に Esc |

各ブリックの「⋯」メニューからは、名前の変更、**数値での位置・サイズ指定**（ドラッグなしで配置
できる代替手段）、幅の追従方法、ロック、削除ができます。

**設定パネル。** メニューの「設定…」（またはブリックのダブルクリック）で、データセット・軸・系列・
書式などを画面上で選べます。変更はその場でブリックに反映されます。項目はブリック定義の `settings`
から生成されるので、自前のブリックにも同じパネルが付きます。アプリ独自の設定画面を使いたい場合は
`onEditItem` を渡すと、そちらが呼ばれます。

**重なりの扱い。** 既定では重なりを許します。`overlap="avoid"` にすると、ドロップしたブリックは
最寄りの空き位置に収まり、隣を覆うリサイズは拒否されます。

ドラッグ中は対象要素のスタイルを直接書き換えるだけで、React の再レンダリングは起きません。確定は
離した瞬間の 1 回で、変更のあったブリックだけが再描画されます。編集不可 (`editable` なし) の
ダッシュボードはイベントリスナーを一切登録しません。

### 主な props

| prop | 説明 |
|---|---|
| `value` / `defaultValue` / `onChange(doc, meta)` | 制御／非制御。`meta.reason` は `move` `resize` `add` `undo` など |
| `bricks` / `data` / `renderItem` | ブリックのレジストリ、データセット、未登録 type の描画 |
| `editable` / `editing` / `defaultEditing` / `onEditingChange` | 編集の可否と編集モード |
| `toolbar` / `header` | ツールバーの表示、左側に置くタイトルやフィルタ |
| `snap` | `{ grid, items, threshold }` または `false` |
| `locale` / `theme` | 文言（既定は英語）、`'light' \| 'dark' \| 'auto'` |
| `status` / `onRetry` | データセットごとの読み込み状態（下記） |
| `onSelect` | ブリック内の点・棒・セル・行がクリックされた |
| `exportable` | 表示モードで CSV／画像のダウンロードを出す |
| `overlap` | `'allow'`（既定）または `'avoid'` |
| `onEditItem` | 標準の設定パネルの代わりに呼ばれる |
| `ref` | `add` `remove` `update` `undo` `redo` `getValue` `reveal` `inspect` `toCsv` `exportCsv` `exportPng` `store` |

---

## データの状態・クリック・エクスポート

```tsx
<Dashboard
  data={{ sales: salesQuery.data }}
  status={{ sales: salesQuery.isFetching ? 'loading' : salesQuery.isError ? 'error' : undefined }}
  onRetry={(dataset) => refetch(dataset)}
  onSelect={({ item, datum, index }) => router.push(`/deals?month=${datum.month}`)}
  exportable
/>
```

- **読み込み中**: データがまだ無ければプレースホルダ、すでにあれば前の描画を薄く残します
  （レイアウトが跳ねず、スケルトンが点滅しません）。**失敗**: メッセージと再試行ボタンを表示します。
- **クリック**: チャートの点・棒・セル、構成比の要素、表の行が、元の行 (`datum`) とその位置
  (`index`) を返します。キーボードでは Enter です。編集モード中は発火しません。
- **エクスポート**: `exportable` でブリックにホバーメニューが付き、CSV（Excel で開ける BOM 付き
  UTF-8）と PNG を保存できます。`ref` からも呼べます。印刷時は編集用の UI が隠れます。
  画像出力は SVG の `foreignObject` 描画を使うため、Safari では動作しない場合があります（CSV は可）。

## 保存と読み込み

```ts
import { parseDashboard, serializeDashboard } from 'vizbrix';

await save(serializeDashboard(doc));        // キー順が安定。同じ内容なら同じバイト列

const { doc, ok, issues } = parseDashboard(await load());
if (!ok) report(issues);                     // 例: [{ path: 'items[3].w', message: '…', severity: 'error' }]
```

`parseDashboard` は**例外を投げません**。壊れた JSON でも、必ず描画できるドキュメントと、修復した
箇所の一覧を返します。ドキュメントは `version` を持ち、未知のキーは読み書きを通じて保持されるので、
新しいバージョンが書いたデータを古いバージョンが壊すことはありません。

セルベースのグリッドレイアウト（`{ i, x, y, w, h }`）からは `importFromGrid(cells, { cols, rowHeight })`
で変換できます。

## サーバーレンダリング

```tsx
import { DashboardStatic } from 'vizbrix/react/static';   // "use client" なし
import { builtinBricks } from 'vizbrix/bricks';

export default async function Page() {
  return <DashboardStatic id="sales" value={await loadLayout()} bricks={builtinBricks} data={await loadData()} />;
}
```

`<DashboardStatic>` はフックもイベントハンドラも持たない Server Component で、`<Dashboard>` と同一の
マークアップを出力します。レイアウトは CSS なので、クライアントで実行されるのはチャート自身の
コードだけです。

## テーマ

すべての色・角丸・書体は CSS カスタムプロパティです。

```css
:root {
  --vbx-accent: #0f766e;
  --vbx-radius: 8px;
  --vbx-series-1: #0f766e;   /* 系列色は順序ごと差し替えてください */
}
```

`theme="dark"`（または祖先要素の `data-vbx-theme="dark"`）でダーク、`"auto"` で OS 設定に従います。

## アクセシビリティ

- 編集はキーボードだけで完結し、移動・サイズ変更・追加・削除はライブリージョンで読み上げられます。
- ドラッグを要する操作には、メニューの数値入力という単一ポインタ・非ドラッグの代替手段があります
  （WCAG 2.2 達成基準 2.5.7）。
- 折れ線・棒グラフは矢印キーで値を読め、表表示に切り替えられます。状態色は必ずラベルと併用されます。
- `prefers-reduced-motion` を尊重します。

## やらないこと

- **詰め直し・押し出し。** ブリックは置いた場所に留まります。他のブリックを動かすことはしません。
- **データ取得。** `data` に渡すところまでがアプリの責務です。
- **二軸グラフ・無限キャンバス・共同編集。**

## 開発

```sh
pnpm install
pnpm check          # 型チェック + lint + テスト
pnpm build && pnpm size && pnpm smoke
pnpm e2e --project=chromium   # 実ブラウザでのテスト（CI では Firefox・WebKit・タッチも実行）

cd examples/playground && pnpm install && pnpm dev
```

設計の詳細は [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) にあります。

## ライセンス

[MIT](./LICENSE) © MysMon
