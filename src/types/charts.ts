import { CommonStyleProps } from './common';

// フォーマッター関数の型
export type AxisFormatter = (value: string | number) => string;

// 基本的なデータ型
type BaseValue = string | number | undefined;

// チャートデータの基本型
export interface ChartDataPoint {
  [key: string]: BaseValue | ChartDataPoint[];
}

// ツールチップのプロパティインターフェース
export interface TooltipPayload<T = Record<string, unknown>> {
  name: string;
  value: number;
  payload: T;
  dataKey?: string;
}

export interface TooltipProps<T = Record<string, unknown>> {
  payload?: TooltipPayload<T>[];
  label?: string;
  active?: boolean;
}

// 基本的なチャートの設定インターフェース
export interface BaseChartConfig {
  type?: string;
  title?: string;
  error?: string;
  isLoading?: boolean;
  xAxisLabel?: string;
  yAxisLabel?: string;
  showLegend?: boolean;
  chartColors?: string[];
  xAxisKey?: string;
  yAxisKey?: string;
  xAxisFormatter?: AxisFormatter;
  yAxisFormatter?: AxisFormatter;
  tooltipFormatter?: (
    value: number,
    label: string,
    data: Record<string, unknown>
  ) => string | number;
}

// チャートデータの共用型
export type ChartDataType = 
  | ChartDataPoint 
  | XYDataPoint 
  | NameValueDataPoint 
  | TreemapDataPoint 
  | CandlestickDataPoint 
  | SankeyChartData 
  | HeatMapSeries;

// 拡張チャート設定インターフェース
export interface ChartConfig extends BaseChartConfig {
  data?: ChartDataType[];
  value?: number;
  [key: string]: unknown;
}

// 基本的なチャートのプロパティインターフェース
export interface BaseChartProps extends CommonStyleProps {
  width?: number | string;
  height?: number | string;
}

// XYデータポイントの型
export interface XYDataPoint {
  x: string | number;
  y: number;
  [key: string]: BaseValue;
}

// 名前と値のペアの型
export interface NameValueDataPoint {
  name: string;
  value: number;
  [key: string]: BaseValue;
}

// ツリーマップのデータポイント型
export interface TreemapDataPoint {
  name: string;
  value: number;
  children?: TreemapDataPoint[];
  [key: string]: BaseValue | TreemapDataPoint[] | undefined;
}

// ローソク足チャートのデータポイント型
export interface CandlestickDataPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  [key: string]: BaseValue;
}

// サンキーチャートのデータ型
export interface SankeyNode {
  name: string;
  value?: number;
  [key: string]: BaseValue;
}

export interface SankeyLink {
  source: number;
  target: number;
  value: number;
  [key: string]: BaseValue;
}

export interface SankeyChartData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

// ヒートマップのシリーズ型
export interface HeatMapDataPoint {
  x: string | number;
  y: string | number;
  value: number;
  [key: string]: BaseValue;
}

export interface HeatMapSeries {
  name: string;
  data: HeatMapDataPoint[];
}

// LineChartの設定とプロパティ
export interface LineChartConfig extends BaseChartConfig {
  smooth?: boolean;
  areaOpacity?: number;
  fillArea?: boolean;
  showDots?: boolean;
  dotSize?: number;
}

export interface LineChartProps extends BaseChartProps {
  data: XYDataPoint[];
  config: LineChartConfig;
}

// BarChartの設定とプロパティ
export interface BarChartConfig extends BaseChartConfig {
  horizontal?: boolean;
  stacked?: boolean;
  stackedKeys?: string[];
  layout?: 'horizontal' | 'vertical';
}

export interface BarChartProps extends BaseChartProps {
  data: XYDataPoint[];
  config: BarChartConfig;
}

// PieChartの設定とプロパティ
export interface PieChartConfig extends BaseChartConfig {
  innerRadius?: number | string;
  outerRadius?: number | string;
  labelLine?: boolean;
  nameKey?: string;
  valueKey?: string;
}

export interface PieChartProps extends BaseChartProps {
  data: NameValueDataPoint[];
  config: PieChartConfig;
}

// AreaChartの設定とプロパティ
export interface AreaChartConfig extends BaseChartConfig {
  smooth?: boolean;
  stacked?: boolean;
  stackedKeys?: string[];
  fillOpacity?: number;
}

export interface AreaChartProps extends BaseChartProps {
  data: XYDataPoint[];
  config: AreaChartConfig;
}

// ScatterChartの設定とプロパティ
export interface ScatterChartConfig extends BaseChartConfig {
  showLabels?: boolean;
  zAxisKey?: string;
  dotSize?: number;
}

export interface ScatterChartProps extends BaseChartProps {
  data: XYDataPoint[];
  config: ScatterChartConfig;
}

// RadarChartの設定とプロパティ
export interface RadarChartConfig extends BaseChartConfig {
  dataKeys: string[];
  nameKey: string;
  fillOpacity?: number;
}

export interface RadarDataPoint {
  [key: string]: BaseValue;
}

export interface RadarChartProps extends BaseChartProps {
  data: RadarDataPoint[];
  config: RadarChartConfig;
}

// ComposedChartの設定とプロパティ
export interface ComposedChartConfig extends BaseChartConfig {
  series: Array<{
    type: 'line' | 'bar' | 'area';
    dataKey: string;
    name?: string;
  }>;
}

export interface ComposedDataPoint {
  [key: string]: BaseValue;
}

export interface ComposedChartProps extends BaseChartProps {
  data: ComposedDataPoint[];
  config: ComposedChartConfig;
}

// TreemapChartの設定とプロパティ
export interface TreemapChartConfig extends BaseChartConfig {
  nodeOpacity?: number;
}

export interface TreemapChartProps extends BaseChartProps {
  data: TreemapDataPoint[];
  config: TreemapChartConfig;
}

// FunnelChartの設定とプロパティ
export interface FunnelChartConfig extends BaseChartConfig {
  labelLine?: boolean;
}

export interface FunnelChartProps extends BaseChartProps {
  data: NameValueDataPoint[];
  config: FunnelChartConfig;
}

// CandlestickChartの設定とプロパティ
export interface CandlestickChartConfig extends BaseChartConfig {
  upColor?: string;
  downColor?: string;
}

export interface CandlestickChartProps extends BaseChartProps {
  data: CandlestickDataPoint[];
  config: CandlestickChartConfig;
}

// SankeyChartの設定とプロパティ
export interface SankeyChartConfig extends BaseChartConfig {
  nodePadding?: number;
  nodeWidth?: number;
}

export interface SankeyChartProps extends BaseChartProps {
  data: SankeyChartData;
  config: SankeyChartConfig;
}

// HeatMapChartの設定とプロパティ
export interface HeatMapChartConfig extends BaseChartConfig {
  fillOpacity?: number;
  xAxisFormatter?: AxisFormatter;
  yAxisFormatter?: AxisFormatter;
}

export interface HeatMapChartProps extends BaseChartProps {
  data: HeatMapSeries[];
  config: HeatMapChartConfig;
}

// GaugeChartの設定とプロパティ
export interface GaugeChartConfig extends BaseChartConfig {
  min?: number;
  max?: number;
  unit?: string;
  precision?: number;
}

export interface GaugeChartData extends NameValueDataPoint {
  value: number;
}

export interface GaugeChartProps extends BaseChartProps {
  data: GaugeChartData[];
  config: GaugeChartConfig;
}
