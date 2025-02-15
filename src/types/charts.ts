import { CSSProperties, ReactNode } from 'react';
import { Payload } from 'recharts/types/component/DefaultTooltipContent';

export type TooltipPayload<T = Record<string, unknown>> = Payload<string | number, string> & T;

export interface BaseProps {
  width?: number;
  height?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export interface TooltipProps {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
}

export type TooltipFormatter = (
  value: string | number,
  name: string,
  payload: TooltipPayload
) => string | number;

// 共通のデータ型
export interface BaseDataPoint {
  id?: string | number;
  [key: string]: string | number | undefined;
}

export interface XYDataPoint extends BaseDataPoint {
  x: string | number;
  y: number;
  [key: string]: string | number | undefined;
}

export interface NameValueDataPoint {
  name: string;
  value: number;
  [key: string]: string | number | undefined;
}

export interface TreemapDataPoint extends Record<string, unknown> {
  name: string;
  value: number;
  children?: TreemapDataPoint[];
}

export interface CandlestickDataPoint {
  date: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface SankeyNode {
  name: string;
  value?: number;
}

export interface SankeyLink {
  source: number;
  target: number;
  value: number;
}

export interface HeatMapDataPoint {
  x: string | number;
  y: number;
  value: number;
}

export interface HeatMapSeries extends Record<string, unknown> {
  name: string;
  data: HeatMapDataPoint[];
}

// 共通のチャートプロパティ
export interface BaseChartConfig {
  title?: string;
  className?: string;
  style?: CSSProperties;
  tooltipFormatter?: TooltipFormatter;
  showLegend?: boolean;
  error?: string;
  isLoading?: boolean;
  chartColors?: string[];
  xAxisLabel?: string;
  yAxisLabel?: string;
}

// 各チャートの設定
export interface LineChartConfig extends BaseChartConfig {
  type: 'line';
  data: XYDataPoint[];
  xAxisKey: string;
  yAxisKey: string;
  smooth?: boolean;
  showDots?: boolean;
  dotSize?: number;
}

export interface BarChartConfig extends BaseChartConfig {
  type: 'bar';
  data: XYDataPoint[];
  xAxisKey: string;
  yAxisKey: string;
  layout?: 'vertical' | 'horizontal';
  stackedKeys?: string[];
}

export interface PieChartConfig extends BaseChartConfig {
  type: 'pie';
  data: NameValueDataPoint[];
  nameKey: string;
  valueKey: string;
  innerRadius?: string | number;
  outerRadius?: string | number;
  labelLine?: boolean;
}

export interface AreaChartConfig extends BaseChartConfig {
  type: 'area';
  data: XYDataPoint[];
  xAxisKey: string;
  yAxisKey: string;
  stackedKeys?: string[];
  fillOpacity?: number;
  smooth?: boolean;
}

export interface ScatterChartConfig extends BaseChartConfig {
  type: 'scatter';
  data: XYDataPoint[];
  xAxisKey: string;
  yAxisKey: string;
  dotSize?: number;
  showLabels?: boolean;
  zAxisKey?: string;
}

export interface RadarChartConfig extends BaseChartConfig {
  type: 'radar';
  data: Record<string, number>[];
  dataKeys: string[];
  nameKey: string;
  fillOpacity?: number;
}

export interface ComposedChartConfig extends BaseChartConfig {
  type: 'composed';
  data: XYDataPoint[];
  xAxisKey: string;
  yAxisKey: string;
  series: Array<{
    type: 'line' | 'bar' | 'area';
    dataKey: string;
    name?: string;
  }>;
}

export interface GaugeChartConfig extends BaseChartConfig {
  type: 'gauge';
  value: number;
  min?: number;
  max?: number;
  showValue?: boolean;
}

export interface TreemapChartConfig extends BaseChartConfig {
  type: 'treemap';
  data: TreemapDataPoint[];
}

export interface FunnelChartConfig extends BaseChartConfig {
  type: 'funnel';
  data: NameValueDataPoint[];
}

export interface CandlestickChartConfig extends BaseChartConfig {
  type: 'candlestick';
  data: CandlestickDataPoint[];
  upColor?: string;
  downColor?: string;
}

export interface SankeyChartConfig extends BaseChartConfig {
  type: 'sankey';
  data: {
    nodes: SankeyNode[];
    links: SankeyLink[];
  };
  nodeWidth?: number;
  nodePadding?: number;
}

export interface HeatMapChartConfig extends BaseChartConfig {
  type: 'heatmap';
  data: HeatMapSeries[];
  xAxisFormatter?: (value: unknown) => string;
  yAxisFormatter?: (value: unknown) => string;
}

export type ChartConfig =
  | LineChartConfig
  | BarChartConfig
  | PieChartConfig
  | AreaChartConfig
  | ScatterChartConfig
  | RadarChartConfig
  | ComposedChartConfig
  | GaugeChartConfig
  | TreemapChartConfig
  | FunnelChartConfig
  | CandlestickChartConfig
  | SankeyChartConfig
  | HeatMapChartConfig;

// チャートコンポーネントのProps型
export interface LineChartProps extends BaseChartProps<XYDataPoint> {
  config: LineChartConfig;
}

export interface BarChartProps extends BaseChartProps<XYDataPoint> {
  config: BarChartConfig;
}

export interface PieChartProps extends BaseChartProps<NameValueDataPoint> {
  config: PieChartConfig;
}

export interface AreaChartProps extends BaseChartProps<XYDataPoint> {
  config: AreaChartConfig;
}

export interface ScatterChartProps extends BaseChartProps<XYDataPoint> {
  config: ScatterChartConfig;
}

export interface RadarChartProps extends BaseChartProps<Record<string, number>> {
  config: RadarChartConfig;
}

export interface ComposedChartProps extends BaseChartProps<XYDataPoint> {
  config: ComposedChartConfig;
}

export interface BaseChartProps<TData = Record<string, unknown>> extends BaseProps {
  data: TData[];
}

export interface GaugeChartProps extends BaseProps {
  config: GaugeChartConfig;
}

export interface TreemapChartProps extends BaseChartProps<TreemapDataPoint> {
  config: TreemapChartConfig;
}

export interface FunnelChartProps extends BaseChartProps<NameValueDataPoint> {
  config: FunnelChartConfig;
}

export interface CandlestickChartProps extends BaseChartProps<CandlestickDataPoint> {
  config: CandlestickChartConfig;
}

export interface SankeyChartData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export interface SankeyChartProps extends BaseProps {
  data: SankeyChartData;
  config: SankeyChartConfig;
}

export interface HeatMapChartProps extends BaseProps {
  data: HeatMapSeries[];
  config: HeatMapChartConfig;
}
