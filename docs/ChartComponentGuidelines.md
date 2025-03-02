# チャートコンポーネント実装ガイドライン

このドキュメントでは、Vizbrixプロジェクト内のすべてのチャートコンポーネントで遵守すべき実装ガイドラインを定義します。一貫した実装により、パフォーマンス向上、保守性向上、およびコード品質の向上を目指します。

## 目次

1. [基本構造](#基本構造)
2. [インポートパターン](#インポートパターン)
3. [データ検証](#データ検証)
4. [メモ化パターン](#メモ化パターン)
5. [ツールチップの実装](#ツールチップの実装)
6. [スタイリング](#スタイリング)
7. [命名規則](#命名規則)
8. [パフォーマンス最適化](#パフォーマンス最適化)

## 基本構造

すべてのチャートコンポーネントは以下の基本構造に従います：

```tsx
import { memo, useMemo, useCallback } from 'react';
import {
  [ChartName] as Recharts[ChartName],
  // その他のRechartsコンポーネント
} from 'recharts';
import { [ChartName]Props } from '../../types/charts';
import { useChartTheme } from '../../hooks/useChartTheme';
import { BaseChart } from './BaseChart';
import { chartUtils } from '../../utils/chartUtils';

/**
 * [日本語での説明]
 * [コンポーネントの機能説明]
 */
export const [ChartName] = memo(({ data, config, width, height, style, className }: [ChartName]Props) => {
  const { colors, tooltip, formatTooltip } = useChartTheme();

  // 設定から頻繁に使用される値を抽出
  const { 
    tooltipFormatter, 
    chartColors, 
    // その他の必要な設定
    title,
    error: configError,
    isLoading
  } = config;
  
  const primaryColor = chartColors?.[0] ?? colors.primary;

  // データの検証
  const { isValid, error } = useMemo(() => 
    chartUtils.validate[DataType]Data(data),
    [data]
  );

  // ツールチップフォーマッター
  const handleTooltip = useCallback((value: number, name: string, props: any) => {
    return formatTooltip(value, name, props, tooltipFormatter);
  }, [tooltipFormatter, formatTooltip]);

  // チャートコンテンツのメモ化
  const chartContent = useMemo(() => {
    if (!isValid) return null;

    return (
      <ResponsiveContainer width={width ?? '100%'} height={height ?? 400}>
        <Recharts[ChartName]
          data={data}
          margin={tooltip.margin}
        >
          {/* チャート特有の実装 */}
        </Recharts[ChartName]>
      </ResponsiveContainer>
    );
  }, [
    // 依存配列に必要な値をすべて含める
    isValid, 
    data, 
    width, 
    height, 
    tooltip.margin, 
    tooltip.contentStyle, 
    tooltip.labelStyle,
    // その他の依存値
  ]);

  return (
    <BaseChart
      title={title}
      error={error || configError}
      isLoading={isLoading}
      hasError={!isValid || !!configError}
      width={width}
      height={height}
      style={style}
      className={className}
    >
      {chartContent}
    </BaseChart>
  );
});

[ChartName].displayName = '[ChartName]';
```

## インポートパターン

すべてのチャートコンポーネントは以下のインポートパターンに従ってください：

1. **React フック**:
   ```tsx
   import { memo, useMemo, useCallback } from 'react';
   ```

2. **Rechartsコンポーネント**:
   ```tsx
   import {
     [ChartName] as Recharts[ChartName],
     // その他の必要なコンポーネント
   } from 'recharts';
   ```

3. **型定義**:
   ```tsx
   import { [ChartName]Props } from '../../types/charts';
   ```

4. **内部フック・ユーティリティ**:
   ```tsx
   import { useChartTheme } from '../../hooks/useChartTheme';
   import { BaseChart } from './BaseChart';
   import { chartUtils } from '../../utils/chartUtils';
   ```

## データ検証

データ検証には、`chartUtils` の専用検証関数を使用してください：

```tsx
// 基本的な検証パターン
const { isValid, error } = useMemo(() => 
  chartUtils.validateXYData(data),
  [data]
);

// または特定のチャート用の検証関数
const { isValid, error } = useMemo(() => 
  chartUtils.validateNameValueData(data),
  [data]
);

// カスタム検証ロジックが必要な場合
const { isValid, error } = useMemo(() => 
  chartUtils.validateChartData(data, (items) => 
    items.every(item => 
      // チャート固有のバリデーション条件
      item.x !== undefined && 
      item.y !== undefined
    )
  ),
  [data]
);
```

**注意**: 以前使用されていた `validateChartData` 関数は非推奨となり、代わりに `chartUtils` のメソッドを使用してください。

## メモ化パターン

チャートコンポーネントでは、以下の要素をメモ化してください：

1. **データ検証結果**:
   ```tsx
   const { isValid, error } = useMemo(() => 
     chartUtils.validateXYData(data),
     [data]
   );
   ```

2. **イベントハンドラ**:
   ```tsx
   const handleTooltip = useCallback((value: number, name: string, props: any) => {
     return formatTooltip(value, name, props, tooltipFormatter);
   }, [tooltipFormatter, formatTooltip]);
   ```

3. **カスタムレンダラー**:
   ```tsx
   const renderLabel = useCallback((props: any) => {
     // ラベルのレンダリングロジック
     return `${props.name}: ${props.value}`;
   }, []);
   ```

4. **チャートコンテンツ**:
   ```tsx
   const chartContent = useMemo(() => {
     if (!isValid) return null;
     
     return (
       // チャートのレンダリング内容
     );
   }, [
     // 詳細な依存配列
     isValid, data, width, height, 
     // スタイルの依存関係
     tooltip.margin, tooltip.contentStyle, tooltip.labelStyle,
     // 設定の依存関係
     xAxisLabel, yAxisLabel, primaryColor,
     // メモ化された関数
     handleTooltip, renderLabel
   ]);
   ```

### 依存配列の重要性

依存配列には、関数内で使用するすべての値を明示的にリストアップしてください：

```tsx
// 良い例
}, [
  isValid, 
  data, 
  width, 
  height, 
  tooltip.margin, 
  tooltip.contentStyle, 
  tooltip.labelStyle, 
  xAxisLabel, 
  yAxisLabel, 
  handleTooltip
]);

// 悪い例
}, [isValid, data]); // 依存関係が不完全
```

## ツールチップの実装

すべてのチャートは、共通のツールチップ実装パターンに従ってください：

```tsx
// ツールチップフォーマッター
const handleTooltip = useCallback((value: number, name: string, props: any) => {
  return formatTooltip(value, name, props, tooltipFormatter);
}, [tooltipFormatter, formatTooltip]);

// Tooltipコンポーネントの使用
<Tooltip
  formatter={handleTooltip}
  contentStyle={tooltip.contentStyle}
  labelStyle={tooltip.labelStyle}
/>
```

## スタイリング

スタイリングには、テーマからの値を使用してください：

```tsx
// 主要色の設定
const primaryColor = chartColors?.[0] ?? colors.primary;

// インデックスに基づく色の取得
const color = getColor(index, chartColors);

// 値に基づく色の取得
const color = chartUtils.getColorByValue(value, min, max, chartColors);
```

## 命名規則

1. **チャートコンポーネント**: `[ChartName]`
   - 例: `AreaChart`, `BarChart`

2. **Rechartsコンポーネント**: `Recharts[ChartName]`
   - 例: `RechartsAreaChart`, `RechartsBarChart`

3. **イベントハンドラ**:
   - ツールチップフォーマッター: `handleTooltip`
   - その他のハンドラ: `handle[Action]`

4. **カスタムレンダラー**: `render[Element]`
   - 例: `renderLabel`, `renderContent`

5. **その他の変数**:
   - データ検証結果: `{ isValid, error }`
   - メモ化されたチャートコンテンツ: `chartContent`
   - 色: `primaryColor`, `[element]Color`

## パフォーマンス最適化

チャートコンポーネントのパフォーマンスを最適化するためのポイント：

1. **不要な再レンダリングを防ぐ**
   - コンポーネントを `memo` でラップする
   - 依存配列に必要最小限の値のみを含める
   - オブジェクト全体（`config`など）ではなく、使用する個別のプロパティを依存配列に含める

2. **計算のキャッシュ**
   - 複雑な計算や変換は `useMemo` を使用する
   - データ処理ロジックは可能な限りメモ化する

3. **関数の安定性**
   - イベントハンドラや書式設定関数は `useCallback` で囲む
   - 関数の依存関係を最小限に保つ

4. **条件付きレンダリング**
   - データが無効な場合は早期に `null` を返す
   - 不要なレンダリングを避けるために条件チェックを行う

---

これらのガイドラインに従うことで、すべてのチャートコンポーネント間で一貫性のある実装が確保され、保守性とパフォーマンスが向上します。 