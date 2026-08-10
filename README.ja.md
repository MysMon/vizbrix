# vizbrix

**React ダッシュボードのための自由配置レイアウトエンジン。ピクセル単位で置けて、ちゃんとリフローする。**

[![CI](https://github.com/MysMon/vizbrix/actions/workflows/ci.yml/badge.svg)](https://github.com/MysMon/vizbrix/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen)](#バンドルサイズ)
[![types: included](https://img.shields.io/badge/types-included-blue)](#typescript)
[![React 18 | 19](https://img.shields.io/badge/react-18%20%7C%2019-61dafb)](#インストール)

ウィジェットはドロップした場所にそのまま置かれます。座標もサイズも自由、重ねても構いません。
それでいて、コンテナ幅が変わったときに破綻しません。

*[English README →](./README.md)*

---

## なぜ作ったか

主要なダッシュボードレイアウトライブラリは、位置を**グリッドのセル座標（整数）**として保存します。
[`react-grid-layout`](https://github.com/react-grid-layout/react-grid-layout) も
[`gridstack.js`](https://github.com/gridstack/gridstack.js) も、成熟し広く使われている優れたカラム
エンジンですが、いずれも `x, y, w, h` の意味は「列と行」です。これは表示上のデフォルトではなく、
保存形式そのものであり、衝突判定の単位であり、永続化フォーマットでもあります。したがって自由配置は
設定で到達できる場所にありません。エコシステムに存在する「フリー」モードは、別のモデルを表現している
のではなく、エンジン本来の挙動を**無効化する**フラグです。gridstack の `float: true` は詰め直しを
やめますが依然としてセルにスナップしますし、RGL の `allowOverlap` は衝突処理を手放すことで自由配置
らしさを得ます（Apache Superset は実際にこのトレードで「フリーフォーム」ダッシュボードを実現して
います）。

一方で、本当の自由配置を実現しているライブラリはダッシュボードの語彙を持ちません。
[interact.js](https://interactjs.io/) や
[react-moveable](https://github.com/daybrush/moveable) は任意のピクセル変形を見事に扱いますが、
衝突ポリシーも、永続化スキーマも、レスポンシブ戦略も、アクセシビリティもありません。各チームが
それらを手作業で組み上げてキャンバスエディタを作っている——製品ではなく、DIY のパターンです。

**vizbrix はその中間にあります。** 位置は連続的で解像度非依存な*式*として永続化されます。12カラム
グリッドは複数あるスナッププロバイダのひとつにすぎず、操作時に切り替わるだけでモデルには焼き込まれ
ません。レスポンシブはブレークポイントごとに手書きするレイアウト配列ではなく、アイテムごとの計算結果
です。そしてシリアライズされたドキュメントは、データベースに入れて構わないバージョン付きの契約です。

一行でいえば——**縮むだけの自由配置ではなく、リフローする自由配置。**

---

## インストール

```sh
npm install vizbrix      # pnpm add vizbrix · yarn add vizbrix
```

React 18 / 19 は**オプショナルな** peer 依存です。コアエンジンには React の import が一切なく
（CI で強制しています）、Vue / Svelte / バニラ用のアダプタを書くのに必要なのは公開されたコア API だけ
です。ランタイム依存はゼロです。

## 60秒でわかる使い方

```tsx
import { defineLayout } from 'vizbrix';
import { Vizbrix } from 'vizbrix/react';

const layout = defineLayout({
  container: { base: { width: 1200 }, sizes: { md: { maxWidth: 900 } } },
  items: [
    { id: 'revenue', x: 0, y: 0, w: 580, h: 260 },
    { id: 'signups', x: 620, y: 0, w: 580, h: 260, anchor: { x: 'end' } },
    { id: 'funnel', x: 0, y: 300, w: 1200, h: 320, anchor: { x: 'both' } },
  ],
});

export function Dashboard() {
  return (
    <Vizbrix defaultLayout={layout} mode="edit" onLayoutChange={(doc) => save(doc)}>
      {(item, ui) => (
        <article className="card">
          <header {...ui.handleProps}>{item.id}</header>
          <button {...ui.moveButtonProps}>移動</button>
          <Widget id={item.id} />
        </article>
      )}
    </Vizbrix>
  );
}
```

`defineLayout` はフラットなピクセル指定（基準設計幅における `x, y, w, h`）を受け取り、正規化された
ドキュメントに変換します。アンカーは基準幅で再エンコードされ、分数インデックスの `z` キーが生成され、
長さが正規化され、アイテムがソートされます。カードをドラッグすると、1ジェスチャにつき1回だけ
`onLayoutChange(doc, tx)` が発火し、新しいドキュメントとそれを生んだトランザクションが渡されます。

読み取り専用は prop ではなく別のエントリポイントです。

```tsx
import { VizbrixView } from 'vizbrix/react/view';   // 13.5 KB — センサーも履歴もなし
<VizbrixView layout={doc}>{(item) => <Widget id={item.id} />}</VizbrixView>
```

```tsx
import { VizbrixStatic } from 'vizbrix/react/static'; // 4.2 KB — RSC 対応、"use client" なし
<VizbrixStatic layout={doc}>{(item) => <Widget id={item.id} />}</VizbrixStatic>
```

**[入門ガイド →](./docs/getting-started.md)**

---

## 主な特徴

- **保存形式そのものが自由配置。** 位置は列インデックスではなく、コンテナ幅に対するアフィン式
  （`a·W + b`）です。兄弟要素の辺・中心、等間隔ギャップ、コンテナの辺——そしてグリッド
  （`snap={{ grid: 8 }}`、デフォルトはオフ）にスナップできます。ジェスチャ中に **Cmd/Ctrl** を押せば
  スナップを一時的に解除でき、修飾キーは `snap={{ bypassKey: 'alt' }}` で変更できます。スナップは
  あくまで操作なので、切り替えても保存内容は変わりません。

- **リフローする制約アンカー。** 各軸が `start | end | both | center | scale` のいずれかを持ちます。
  端に固定する、両端に張る、中央を保つ、比例して伸縮する。解決処理は純粋・全域的で計測不要なので、
  同じレイアウトが 1440px でも 380px でも——2つ目のレイアウトを書くことなく——正しく成立します。
  [レスポンシブガイド →](./docs/responsive.md)

- **設計としての SSR 正当性。** すべての配置は静的な CSS（`left: calc(50% + 12px)`、`inset`、
  `@container (max-width: …)`）にコンパイルされます。したがって初回描画は **JavaScript ゼロ**、
  幅の計測なしで正しくなります。`vizbrix/react/static` は本物の React Server Component 用エントリ
  です——`"use client"` バナーなし、フック・エフェクト・イベントハンドラなし。テストが自身のソース
  テキストを検査してそれを担保しています。[SSR ガイド →](./docs/ssr.md)

- **1つをドラッグしても他は再レンダリングされない。** レイアウトはアイテムごとのチャネルを持つ外部
  ストアに置かれ、ドラッグ中の1フレームが触れるのはドラッグ中ノードの `transform` とオーバーレイの
  ガイド線だけ、どちらも命令的な書き込みです。これは主張ではなく計測値です——
  `src/react/render-count.test.tsx` は **200アイテム中の1つを500フレーム動かし、兄弟の
  再レンダリング0回、ドラッグ中アイテムも0回、コミット時にちょうど1回**であることを検証します
  （StrictMode 下でも同様）。詰め直し処理そのものが存在しないので、O(n²) 系のレイアウトバグはここ
  には存在しません。

- **「あとで対応」ではないアクセシビリティ。** キーボードだけで配置できます（掴む／微調整／スナップ
  ジャンプ／取り消し／重ね順）。`role="button"` と `aria-roledescription`、画面外の操作説明、2つの
  ライブリージョン（ジェスチャの遷移は assertive、位置ステータスは polite）を備え、**タップ配置**に
  よって **WCAG 2.2 達成基準 2.5.7（ドラッグ動作、AA）**——すべてのドラッグにシングルポインタの非
  ドラッグ代替手段——を満たします。英語は組み込み、日本語は `vizbrix/locales/ja` として同梱。文字列は
  *関数*なので、翻訳者は固定テンプレートを埋めるのではなく節の順序ごと組み替えられます。
  [アクセシビリティガイド →](./docs/accessibility.md)

- **製品を賭けられる永続化契約。** `{ version, compat, container, items }` と、**決して例外を投げない**
  `load()`。戻り値は `ok | migrated | forward-degraded | incompatible | invalid` の5つのアームを
  持つ `LoadOutcome` です。新しいバージョンが書き込んだ未知のキーは `$unknown` に退避され、そのまま
  再出力されます。`serialize()` はキー順が安定しているのでレイアウトの差分がレビュー可能で、
  マイグレーション実行器は削除されたフィールドをすべてパス付きで報告します。
  [永続化ガイド →](./docs/persistence.md)

- **v0.1 から undo / redo。** 逆操作トランザクション、1ジェスチャ＝1エントリ、人が読めるラベル
  （「元に戻す: 移動 revenue (md)」）、invert 前の rebase、view モードではブロック、キャンセルされた
  ドラッグや原点へのドロップはエントリを残しません。ops は CRDT に適した形（分数 z キー、アクター
  単位のトランザクション）なので、マルチプレイヤーは書き直しではなく統合ガイドとして提供できます。

- **react-grid-layout からの移行経路。** `importFromRGL(layouts, { cols, rowHeight })` は単一
  レイアウトでも `{ lg, md, sm, … }` のレスポンシブ一式でも変換し、各アイテムのアンカーをグリッド
  との関係から推論します。互換シムではなく、意図的に一方向のコンバータです。
  [移行ガイド →](./docs/migrate-from-react-grid-layout.md)

- **ランタイム依存ゼロ。MIT。TypeScript で書かれ、型定義を同梱。**

---

## アンカーを20行で

アンカーは「コンテナ幅が変わったとき、この座標は何を意味するのか」に答えます。

```tsx
const layout = defineLayout({
  container: { base: { width: 1200 }, sizes: { md: { maxWidth: 900 } } },
  items: [
    // 左端に固定、幅は固定（デフォルト）
    { id: 'nav', x: 0, y: 0, w: 240, h: 600 },
    // 右端に固定 — どの幅でも右から 24px
    { id: 'alerts', x: 936, y: 0, w: 240, h: 300, anchor: { x: 'end' } },
    // 両端に張る — 幅は導出される
    { id: 'timeline', x: 264, y: 320, w: 912, h: 280, anchor: { x: 'both' } },
    // 比例 — 幅に対する取り分を保つ
    { id: 'kpi', x: 264, y: 0, w: 648, h: 300, anchor: { x: 'scale' } },
    // コンテナ幅 900px 以下でのみ効く手書きのオーバーライド
    {
      id: 'alerts-md', x: 0, y: 620, w: 240, h: 300,
      at: { md: { x: { mode: 'both', start: 16, end: 16 } } },
    },
  ],
});
```

3つの層が、この順に働きます。**アンカー**はあらゆる幅で連続的にリフローします。**名前付きサイズ**
（`sizes` と アイテムごとの `at`）は「意図」を変えたい箇所だけをデスクトップファーストでカスケード
します。ここでビューポートのメディアクエリではなくコンテナクエリを使うのは、ダッシュボードがサイド
バーや分割ペインに埋め込まれるからです。そして `stackBelow`（デフォルト 480px）を下回ると、読み順に
基づく決定的な1カラムスタックに畳まれます。`responsive: 'scale'` は、キオスクや大型ディスプレイの
ように一律拡大縮小が本当に正しい場面のための逃げ道です。

`start` 以外の垂直アンカーには、高さが確定したコンテナが必要です
（`container: { base: { width, height }, height: 'fill' }`）。それがない場合は開発時警告つきで
`start` に降格します。スクロールするコンテナには、アンカーすべき下端が存在しないからです。
[詳細 →](./docs/responsive.md)

## モードと制御

`mode` のデフォルトは `'view'` で、view モードでは**リスナーを一切登録しません**（無効化された
ハンドラを付けるのではなく、付けません）。ジオメトリはモード間でバイト単位まで同一なので、
`mode="edit"` に切り替えても1ピクセルもずれません。

```tsx
// 非制御: ドキュメントは vizbrix が持ち、こちらはコミットを観測する
<Vizbrix defaultLayout={doc} mode={editing ? 'edit' : 'view'} onLayoutChange={save}>…</Vizbrix>

// 制御: ドキュメントはこちらが持つ
<Vizbrix layout={doc} mode="edit" onLayoutChange={(next) => setDoc(next)}>…</Vizbrix>
```

制御モードでは、コミットはまずストアに入り、その後に親へ通知されます。親の処理が遅くてもドラッグが
カクつくことはありません。コミット後に親が prop をまったく変更しなかった場合、それは拒否とみなされ
ストアはロールバックします。ドキュメントを*変換*して返す親は尊重されます——「まったく変わらない」
だけが「No」を意味します。

---

## 比較

| | **vizbrix** | react-grid-layout | gridstack.js | interact.js / moveable |
|---|---|---|---|---|
| 保存モデル | 軸ごとのアフィン式（`a·W + b`） | 整数のグリッドセル（`x,y,w,h`） | 整数のグリッドセル | なし（アプリ側の責務） |
| 自由配置 | ネイティブなモデル | `allowOverlap`（衝突処理を放棄） | `float: true`（依然セルにスナップ） | ネイティブ |
| スナップ | 操作層: 兄弟の辺・中心、等間隔、コンテナ端、任意でグリッド | グリッドそのもの | グリッドそのもの | 自前実装 |
| レスポンシブ戦略 | アイテム単位のアンカー＋コンテナクエリのカスケード＋決定的スタック | ブレークポイントごとにレイアウト配列を手書き | カラム数ごとにレイアウト | なし |
| SSR / 初回描画 | 静的 CSS、JS ゼロで正しい。RSC 用エントリあり | ブレークポイント選択にコンテナ幅の計測が必要 | DOM が必要 | 該当なし |
| アクセシビリティ | キーボード配置、ライブリージョン、WCAG 2.2 SC 2.5.7 タップ配置、en + ja | 公開 API の一部ではない | 公開 API の一部ではない | 公開 API の一部ではない |
| undo / redo | 標準搭載、逆操作、1ジェスチャ＝1エントリ | アプリ側の責務 | アプリ側の責務 | アプリ側の責務 |
| 永続化のバージョニング | `{version, compat}`、マイグレーション連鎖、`$unknown` 退避、`load()` は例外を投げない | 素の配列、version フィールドなし | `save()`/`load()` JSON、version フィールドなし | 該当なし |
| ランタイム依存 | **0** | 6 | 0 | 0 |
| バンドル（gzip） | エディタ 26.8 KB・ビュー 13.5 KB・静的 4.2 KB | 22.8 KB | ビルド構成による | ビルド構成による |
| ライセンス | MIT | MIT | MIT | MIT |

他プロジェクトの数値は、執筆時点で公開されているパッケージと Issue から取ったものです。数値は変わり
ますし、4つとも意図的に別のことをしている良いライブラリです。詰め直しのある12カラムダッシュボードが
欲しいなら、react-grid-layout のほうが良い答えです。vizbrix を選ぶのは、グリッドのほうが邪魔になって
きたときです。

## バンドルサイズ

実際のエントリポイントごとに計測した値です（バンドル＋minify＋gzip、React は external）。prop で
動的 import を切り替えるような仕掛けはありません——import したものがそのまま出荷されます。

| エントリ | gzip | 中身 |
|---|---|---|
| `vizbrix/react/static` | **4.2 KB** | RSC 対応レンダラ。クライアント JS なし |
| `vizbrix/schema` | **8.5 KB** | 型 + validate/load/migrate/serialize。サーバー向け |
| `vizbrix/react/view` | **13.5 KB** | 読み取り専用。センサーも履歴もなし |
| `vizbrix/react` | **26.8 KB** | フルエディタ: スナップ、undo/redo、a11y、レスポンシブ |
| `vizbrix` | **28.9 KB** | フレームワーク非依存のコア全体 |

正直に読んでください。エディタ用エントリは react-grid-layout の 22.8 KB より*大きい*です。そのかわり
スナップエンジン、undo/redo、アクセシビリティ層、レスポンシブカスケード、バージョン付き永続化を含んで
おり（RGL ではいずれもアプリ側の責務です）、依存パッケージは6つ少なくなっています。そして実際に最も
多くデプロイされる形——保存済みダッシュボードを顧客向けアプリで読み取り専用に表示する——では、比較対象
は 13.5 KB、あるいはクライアント JS ゼロの 4.2 KB です。

これらの数値は CI が毎回レポートします。

## TypeScript

TypeScript で記述され、全エントリに `.d.ts` を同梱、ESM + CJS、`sideEffects: false`。ウィジェットの
データはレイアウト定義からレンダーコールバックまで、型注釈なしで流れます。

```tsx
type Widget = { kind: 'chart' | 'table'; title: string };

const layout = defineLayout<Widget>({
  container: { base: { width: 1200 } },
  items: [{ id: 'a', x: 0, y: 0, w: 400, h: 240, data: { kind: 'chart', title: 'Revenue' } }],
});

<Vizbrix defaultLayout={layout} mode="edit">
  {(item) => <Card title={item.data.title} />}   {/* item.data は Widget。undefined を含まない */}
</Vizbrix>
```

`data` は「`undefined` になり得ない `TData` を指定したときにちょうど必須になり」、指定しなければ
省略可能です。データを持たないダッシュボードにジェネリクスは要らず、型付きのダッシュボードに
null チェックは要りません。

## プレイグラウンド

対話的なプレイグラウンドが `examples/playground` にあります。

```sh
cd examples/playground
pnpm install
pnpm dev
```

## やらないこと

計画を立てられるよう、明文化しておきます。vizbrix v0.1 は次のものを**提供しません**。

1. **チャートやデータ可視化コンポーネント。** ウィジェットの*中身*はあなたのものです（Tremor、
   Recharts、何でも）。チャートを同梱した瞬間、これは「レイアウト機能付きのチャートキット」になって
   しまいます。
2. **無限キャンバス / ズーム・パンのカメラ。** ダッシュボードは有界なコンテナの中にあります。座標系は
   将来カメラを載せられる形を保ちますが、カメラ自体は出しません。
3. **リアルタイム共同編集や同期サーバー。** ops と z キーは CRDT に適した形にしてありますが、
   マルチプレイヤーは統合ガイド（Yjs / Loro）であり、こちらがホストする機能ではありません。
4. **React 以外のアダプタ。** コアはフレームワーク非依存で、CI がそれを維持しますが、現時点で出荷して
   いるのは React アダプタだけです。
5. **ドッキング、タブ、入れ子の分割ワークスペース。** IDE 的なタイリングは dockview、golden-layout、
   react-mosaic の領域です。別の製品です。
6. **ページビルダー／コンポーネントツリーの編集。** Puck や craft.js の領域です。
7. **テーマ／スタイリングシステム。** ヘッドレス＋最小限の構造 CSS のみ。`data-vzb-item`、
   `data-selected`、`data-dragging`、`data-locked` を自前の CSS で装飾してください。
8. **react-grid-layout の互換シム。** `importFromRGL` は一方向のコンバータです。シムを作れば、
   セルモデルがコアに逆流します。
9. **制約ソルバ、エディタの UI シェル／ツールバー、ウィジェット仮想化、そして `push` 衝突。**
   `push` は名前を変えた詰め直しであり、「うちには存在しない」と謳っている O(n²) 系そのものです。
   スキーマは線形制約系の厳密な部分集合になるよう設計してあるので、ソルバは後から永続化フォーマットを
   変えずに追加の逃げ道として載せられます。

## ロードマップ

- 同じコア上の Vue / Svelte アダプタ（コアに React import はないので、純粋な追加になります）。
- 既存のアクター単位 op ログを土台にした CRDT マルチプレイヤー統合ガイド（Yjs / Loro）。
- スキーマがすでに空けてある継ぎ目に、`constraints:` という逃げ道としてのオプショナルな線形制約ソルバ。
- CI でのブラウザ駆動 CSS 差分テスト（ユニットレベルの差分テストは現時点で出荷済み）。

## 開発体制

CI は push と pull request のたびに、型チェック、lint、全テスト（**576件**）、ビルド、エントリサイズの
レポートを実行します。冒頭のバッジがそのパイプラインです。

v0.1 時点での約束は2つです。

- **セマンティックバージョニング。** 公開 API の破壊的変更はメジャーを上げます。
- **バージョン付きスキーマ。** 永続化されるドキュメントは、誰かがレイアウトを保存するより前の初日から
  `version` とリーダー下限 `compat` を持ちます。`load()` は例外を投げず、未知の将来フィールドは往復
  しても失われず、スキーマ変更には必ず削除フィールドをパス付きで報告するマイグレーションが伴います。
  保存済みダッシュボードが、こちらのリファクタリングの人質になることはありません。

## ドキュメント

ガイドは現在すべて英語です。

| ガイド | |
|---|---|
| [Getting started](./docs/getting-started.md) | インストール、最初のダッシュボード、編集/表示、保存と読み込み |
| [Responsive layout](./docs/responsive.md) | アンカー、`at` カスケード、スタック、scale モード |
| [Persistence](./docs/persistence.md) | `LoadOutcome`、`$unknown`、マイグレーション、シリアライズ |
| [Accessibility](./docs/accessibility.md) | キーボード操作表、タップ配置、ライブリージョン、i18n |
| [SSR & RSC](./docs/ssr.md) | 静的レンダリング、ハイドレーション、`position: fixed` の注意点 |
| [Migrating from react-grid-layout](./docs/migrate-from-react-grid-layout.md) | `importFromRGL`、アンカー推論、引き継がれないもの |
| [Architecture](./docs/ARCHITECTURE.md) | v0.1 の確定仕様 |

## ライセンス

[MIT](./LICENSE) © MysMon
