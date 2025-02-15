import { ReactNode, CSSProperties } from 'react';
import { Layout } from 'react-grid-layout';
import {
  LineChartConfig,
  BarChartConfig,
  PieChartConfig,
  AreaChartConfig,
  ScatterChartConfig,
  RadarChartConfig,
  ComposedChartConfig,
  GaugeChartConfig,
  TreemapChartConfig,
  FunnelChartConfig,
  CandlestickChartConfig,
  SankeyChartConfig,
  HeatMapChartConfig,
} from './charts';

export type ChartType =
  | 'line'
  | 'bar'
  | 'pie'
  | 'area'
  | 'scatter'
  | 'radar'
  | 'composed'
  | 'gauge'
  | 'treemap'
  | 'funnel'
  | 'candlestick'
  | 'sankey'
  | 'heatmap';

export type ChartConfig =
  | ({ type: 'line' } & LineChartConfig)
  | ({ type: 'bar' } & BarChartConfig)
  | ({ type: 'pie' } & PieChartConfig)
  | ({ type: 'area' } & AreaChartConfig)
  | ({ type: 'scatter' } & ScatterChartConfig)
  | ({ type: 'radar' } & RadarChartConfig)
  | ({ type: 'composed' } & ComposedChartConfig)
  | ({ type: 'gauge' } & GaugeChartConfig)
  | ({ type: 'treemap' } & TreemapChartConfig)
  | ({ type: 'funnel' } & FunnelChartConfig)
  | ({ type: 'candlestick' } & CandlestickChartConfig)
  | ({ type: 'sankey' } & SankeyChartConfig)
  | ({ type: 'heatmap' } & HeatMapChartConfig);

export interface DashboardItemProps extends Layout {
  id: string;
  title: string;
  chartConfig: ChartConfig;
}

export interface DashboardProps {
  items: DashboardItemProps[];
  columns?: number;
  rowHeight?: number;
  gap?: number;
  isDraggable?: boolean;
  isResizable?: boolean;
  onLayoutChange?: (layout: Layout[]) => void;
}

export interface ChartContainerProps {
  title?: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onResize?: () => void;
  isLoading?: boolean;
  hasError?: boolean;
  isDraggable?: boolean;
} 