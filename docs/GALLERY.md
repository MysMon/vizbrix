# ビジュアルギャラリー

vizbrix の見た目を画像で確認するためのページです。すべてプレイグラウンド
（`examples/playground`）を実ブラウザで撮影したもので、次のコマンドで撮り直せます。

```sh
node scripts/capture-docs.mjs
```

手元で動かして確認する場合は `cd examples/playground && pnpm install && pnpm dev` です。

- [全体像](#全体像)
- [ブリック一覧](#ブリック一覧)
- [操作と状態](#操作と状態)
- [レスポンシブ](#レスポンシブ)
- [編集モード](#編集モード)

---

## 全体像

組み込みブリックだけで組んだ営業ダッシュボードです。

**ライト**

![ダッシュボード全体（ライト）](./images/overview-light.png)

**ダーク**（`theme="dark"`）

![ダッシュボード全体（ダーク）](./images/overview-dark.png)

---

## ブリック一覧

### 数値タイル — `stat`

主要な数値、前期比（増減の良し悪しで色が変わる）、推移のスパークライン。

![数値タイル](./images/bricks-stats.png)

### 折れ線 — `line` ／ ドーナツ — `donut`

![折れ線グラフとドーナツ](./images/bricks-line-donut.png)

### 棒 — `bar` ／ 面 — `area` ／ ランキング — `barlist`

棒グラフは積み上げ＋基準線（`references`）の例です。

![棒グラフ、面グラフ、ランキング](./images/bricks-bar-area-ranking.png)

### ファネル — `funnel` ／ ヒートマップ — `heatmap` ／ 散布図 — `scatter`

![ファネル、ヒートマップ、散布図](./images/bricks-funnel-heatmap-scatter.png)

### 表 — `table` ／ メーター — `meter` ／ テキスト — `text`

表は検索ボックス、バッジ（ステージ）、進捗バー（確度）のセルを使った例です。

![表、メーター、テキスト](./images/bricks-table-meter.png)

---

## 操作と状態

### ホバー

折れ線は最寄りの位置に十字線がスナップし、全系列の値を一覧します。棒はカテゴリ全体がホバー領域です。
どちらも矢印キーで同じ値を読めます。

| 折れ線 | 棒 |
|---|---|
| ![折れ線のツールチップ](./images/hover-line.png) | ![棒のツールチップ](./images/hover-bar.png) |

### ドラッグでズーム

`zoom: true` の折れ線・面グラフは、ドラッグした範囲に絞り込めます。

| ドラッグ中 | ズーム後 |
|---|---|
| ![ズーム範囲の選択](./images/zoom-brush.png) | ![ズーム後](./images/zoom-result.png) |

### 再取得中の表示

データの再取得中は、前の描画を薄く残します。レイアウトは動きません。

![再取得中](./images/state-loading.png)

### エクスポート

`exportable` を付けると、ブリックにホバーしたときのメニューから CSV と画像を保存できます。

![エクスポートメニュー](./images/export-menu.png)

---

## レスポンシブ

同じレイアウト定義が、ダッシュボード自身の幅に応じて自動で組み替わります。

| タブレット幅（2 列） | スマートフォン幅（1 列） |
|---|---|
| ![タブレット幅](./images/responsive-tablet.png) | ![スマートフォン幅](./images/responsive-mobile.png) |

---

## 編集モード

`editable` を付けて「編集」を押した状態です。ツールバーに元に戻す／やり直す／追加が現れ、
各ブリックに「⋯」メニューが付きます。

![編集モード](./images/edit-mode.png)

### ドラッグとスナップ

ドラッグ中は、揃った辺にガイド線が出ます。

![ドラッグ中のガイド線](./images/edit-drag.png)

### ブリックのメニュー ／ 追加メニュー

| ブリックのメニュー | 追加メニュー |
|---|---|
| ![ブリックのメニュー](./images/edit-menu.png) | ![追加メニュー](./images/edit-add.png) |

### 設定パネル

データセット・軸・系列・書式などを画面上で選べます。変更はその場でブリックに反映されます。

![設定パネル](./images/edit-settings.png)

### 範囲選択と整列

空いた場所からドラッグして複数選択すると、ツールバーに整列・等間隔のボタンが現れます。

![範囲選択](./images/edit-marquee.png)

![整列ツール](./images/edit-align.png)

### 画面幅ごとのレイアウト

狭い幅で編集すると、ツールバーにいまのレイアウト名が表示されます。その幅で動かした配置は、
その幅専用として保存されます。

![幅ごとのレイアウト表示](./images/edit-breakpoint.png)
