import { ReactNode, CSSProperties } from 'react';
import { Layout } from 'react-grid-layout';
import {
  ChartConfig,
  XYDataPoint,
  NameValueDataPoint,
  TreemapDataPoint,
  CandlestickDataPoint,
  SankeyChartData,
  HeatMapSeries,
} from './charts';
import { ChartError } from './common';

export interface DashboardItemProps extends Layout {
  id: string;
  title: string;
  chartConfig: ChartConfig;
  data: XYDataPoint[] | NameValueDataPoint[] | TreemapDataPoint[] | CandlestickDataPoint[] | SankeyChartData | HeatMapSeries[];
}

export interface DashboardProps {
  items: DashboardItemProps[];
  columns?: number;
  rowHeight?: number;
  gap?: number;
  isDraggable?: boolean;
  isResizable?: boolean;
  onLayoutChange?: (layout: Layout[]) => void;
  onError?: (error: ChartError) => void;
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
