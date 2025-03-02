import { ReactNode } from 'react';
import { Layout } from 'react-grid-layout';
import {
  ChartConfig,
  ChartDataType,
} from './charts';
import { ChartError, CommonStyleProps } from './common';

export interface DashboardItemProps extends Layout {
  id: string;
  title: string;
  chartConfig: ChartConfig;
  data: ChartDataType[];
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

export interface ChartContainerProps extends CommonStyleProps {
  title?: string;
  children: ReactNode;
  onResize?: () => void;
  isLoading?: boolean;
  hasError?: boolean;
  isDraggable?: boolean;
}
