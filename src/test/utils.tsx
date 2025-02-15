import { FC, ReactElement, ReactNode } from 'react';
import { ThemeProvider } from '../theme/ThemeProvider';
import { render, RenderResult } from '@testing-library/react';

// テスト用のラッパーコンポーネント
export const TestWrapper: FC<{ children: ReactNode }> = ({ children }) => {
  return (
    <ThemeProvider>
      {children}
    </ThemeProvider>
  );
};

// カスタムレンダー関数
export const renderWithTheme = (ui: ReactElement): RenderResult => {
  return render(
    <TestWrapper>
      {ui}
    </TestWrapper>
  );
};

// モックデータ生成ユーティリティ
export const generateMockData = {
  // XYデータポイントの生成
  xyData: (count = 5) => {
    return Array.from({ length: count }, (_, i) => ({
      x: `2024-01-${String(i + 1).padStart(2, '0')}`,
      y: Math.floor(Math.random() * 100)
    }));
  },

  // 名前と値のペアデータの生成
  nameValueData: (count = 5) => {
    return Array.from({ length: count }, (_, i) => ({
      name: `カテゴリー${i + 1}`,
      value: Math.floor(Math.random() * 100)
    }));
  },

  // ツリーマップデータの生成
  treemapData: (count = 3) => {
    return Array.from({ length: count }, (_, i) => ({
      name: `グループ${i + 1}`,
      value: Math.floor(Math.random() * 1000),
      children: Array.from({ length: 2 }, (_, j) => ({
        name: `サブグループ${i + 1}-${j + 1}`,
        value: Math.floor(Math.random() * 100)
      }))
    }));
  },

  // ローソク足データの生成
  candlestickData: (count = 5) => {
    return Array.from({ length: count }, (_, i) => {
      const base = Math.floor(Math.random() * 1000);
      return {
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        open: base,
        high: base + Math.floor(Math.random() * 100),
        low: base - Math.floor(Math.random() * 100),
        close: base + Math.floor(Math.random() * 200) - 100,
        volume: Math.floor(Math.random() * 10000)
      };
    });
  },

  // サンキーダイアグラムデータの生成
  sankeyData: (nodeCount = 3, linkCount = 3) => {
    const nodes = Array.from({ length: nodeCount }, (_, i) => ({
      name: `ノード${i + 1}`
    }));

    const links = Array.from({ length: linkCount }, (_, i) => ({
      source: i % nodeCount,
      target: (i + 1) % nodeCount,
      value: Math.floor(Math.random() * 100)
    }));

    return { nodes, links };
  },

  // ヒートマップデータの生成
  heatmapData: (seriesCount = 3, pointsPerSeries = 5) => {
    return Array.from({ length: seriesCount }, (_, i) => ({
      name: `シリーズ${i + 1}`,
      data: Array.from({ length: pointsPerSeries }, (_, j) => ({
        x: `2024-01-${String(j + 1).padStart(2, '0')}`,
        y: i,
        value: Math.floor(Math.random() * 100)
      }))
    }));
  },
}; 