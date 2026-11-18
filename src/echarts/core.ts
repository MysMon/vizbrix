/**
 * The adapter without an ECharts import. Bind it to your own tree-shaken
 * module:
 *
 *   import * as echarts from 'echarts/core';
 *   import { SankeyChart } from 'echarts/charts';
 *   import { TooltipComponent } from 'echarts/components';
 *   import { SVGRenderer } from 'echarts/renderers';
 *   echarts.use([SankeyChart, TooltipComponent, SVGRenderer]);
 *
 *   export const { EChart, echartsBrick } = createECharts(echarts);
 */
export { createECharts, prepareOption } from './create';
export { buildTheme, readTokens, type ThemeTokens } from './theme';
export type {
  EChartProps,
  EChartSelection,
  EChartsBrickProps,
  EChartsEvent,
  EChartsInstance,
  EChartsLibrary,
} from './create';
