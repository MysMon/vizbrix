import * as echarts from 'echarts';
import { createECharts, type EChartsLibrary } from './create';

/**
 * ECharts for vizbrix, using the full `echarts` build: every chart type and
 * component is available with no registration. To ship only the chart types
 * you use, import `createECharts` from `vizbrix/echarts/core` instead.
 */
const bound = createECharts(echarts as unknown as EChartsLibrary);

export const EChart = bound.EChart;
export const echartsBrick = bound.echartsBrick;
export { buildTheme, readTokens, type ThemeTokens } from './theme';
export type { EChartProps, EChartSelection, EChartsBrickProps, EChartsInstance } from './create';
