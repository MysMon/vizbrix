/** The vizbrix design tokens an ECharts theme is derived from. */
export interface ThemeTokens {
  series: string[];
  surface: string;
  raised: string;
  text: string;
  text2: string;
  muted: string;
  grid: string;
  axis: string;
  border: string;
  seqLow: string;
  seqHigh: string;
  font: string;
}

const FALLBACK: ThemeTokens = {
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  surface: '#fcfcfb',
  raised: '#ffffff',
  text: '#0b0b0b',
  text2: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  border: 'rgba(11,11,11,0.1)',
  seqLow: '#cde2fb',
  seqHigh: '#0d366b',
  font: 'system-ui, sans-serif',
};

/**
 * Read the theme from CSS custom properties at an element. ECharts draws to
 * canvas or to its own SVG and cannot follow `var(--…)`, so the values are
 * resolved here and handed over as a theme object.
 */
export function readTokens(element: Element): ThemeTokens {
  const style = getComputedStyle(element);
  const get = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
  return {
    series: FALLBACK.series.map((color, i) => get(`--vbx-series-${i + 1}`, color)),
    surface: get('--vbx-surface', FALLBACK.surface),
    raised: get('--vbx-raised', FALLBACK.raised),
    text: get('--vbx-text', FALLBACK.text),
    text2: get('--vbx-text-2', FALLBACK.text2),
    muted: get('--vbx-muted', FALLBACK.muted),
    grid: get('--vbx-grid', FALLBACK.grid),
    axis: get('--vbx-axis', FALLBACK.axis),
    border: get('--vbx-border', FALLBACK.border),
    seqLow: get('--vbx-seq-low', FALLBACK.seqLow),
    seqHigh: get('--vbx-seq-high', FALLBACK.seqHigh),
    font: get('--vbx-font', FALLBACK.font),
  };
}

/**
 * An ECharts theme that matches the built-in charts: the same categorical
 * order, recessive hairline grid and axes, text in ink tokens rather than
 * series colours, and a surface-coloured gap between touching marks.
 */
export function buildTheme(t: ThemeTokens): Record<string, unknown> {
  const axis = {
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: t.grid } },
    nameTextStyle: { color: t.text2, fontSize: 11 },
  };
  const label = { color: t.text2, fontSize: 12 };
  const gap = { borderColor: t.surface, borderWidth: 2 };
  return {
    color: t.series,
    backgroundColor: 'transparent',
    textStyle: { fontFamily: t.font, color: t.text2 },
    title: {
      textStyle: { color: t.text, fontSize: 13, fontWeight: 600 },
      subtextStyle: { color: t.muted, fontSize: 12 },
    },
    grid: { left: 4, right: 12, top: 32, bottom: 4, containLabel: true },
    legend: {
      top: 0,
      left: 0,
      itemWidth: 10,
      itemHeight: 10,
      icon: 'roundRect',
      textStyle: { color: t.text2, fontSize: 12 },
      inactiveColor: t.muted,
      pageTextStyle: { color: t.muted },
      pageIconColor: t.text2,
      pageIconInactiveColor: t.axis,
    },
    tooltip: {
      backgroundColor: t.raised,
      borderColor: t.border,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: t.text, fontSize: 12 },
      extraCssText: 'border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.14);',
      axisPointer: { lineStyle: { color: t.axis }, crossStyle: { color: t.axis }, shadowStyle: { color: t.grid, opacity: 0.5 } },
    },
    categoryAxis: { ...axis, splitLine: { show: false, lineStyle: { color: t.grid } } },
    valueAxis: { ...axis, axisLine: { show: false, lineStyle: { color: t.axis } } },
    timeAxis: { ...axis, splitLine: { show: false, lineStyle: { color: t.grid } } },
    logAxis: axis,
    line: { symbol: 'circle', symbolSize: 6, lineStyle: { width: 2 } },
    bar: { barMaxWidth: 24 },
    pie: { itemStyle: gap, label },
    funnel: { itemStyle: gap, label },
    treemap: { itemStyle: { ...gap, gapWidth: 2 }, label: { color: '#ffffff', fontSize: 12 }, breadcrumb: { show: false } },
    sunburst: { itemStyle: gap, label: { color: '#ffffff', fontSize: 11 } },
    sankey: { label, lineStyle: { color: 'source', opacity: 0.25 }, itemStyle: { borderWidth: 0 } },
    graph: { label, lineStyle: { color: t.axis }, itemStyle: gap },
    radar: {
      axisName: { color: t.text2, fontSize: 11 },
      axisLine: { lineStyle: { color: t.grid } },
      splitLine: { lineStyle: { color: t.grid } },
      splitArea: { show: false },
    },
    gauge: {
      axisLine: { lineStyle: { color: [[1, t.grid]] } },
      axisLabel: { color: t.muted },
      detail: { color: t.text },
      title: { color: t.text2 },
    },
    candlestick: {
      itemStyle: { color: t.series[2], color0: t.series[7], borderColor: t.series[2], borderColor0: t.series[7] },
    },
    boxplot: { itemStyle: { borderColor: t.series[0], color: 'transparent' } },
    heatmap: { itemStyle: gap },
    visualMap: { textStyle: { color: t.muted }, inRange: { color: [t.seqLow, t.seqHigh] } },
    dataZoom: {
      borderColor: t.grid,
      textStyle: { color: t.muted },
      handleStyle: { color: t.raised, borderColor: t.axis },
      fillerColor: t.grid,
      dataBackground: { lineStyle: { color: t.axis }, areaStyle: { color: t.grid } },
    },
    toolbox: { iconStyle: { borderColor: t.muted } },
    markLine: { lineStyle: { color: t.text2 }, label: { color: t.text2 } },
  };
}
