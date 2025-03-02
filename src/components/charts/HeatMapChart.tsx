import { memo, useMemo, useCallback } from 'react';
import {
  ScatterChart,
  Scatter,
  Cell,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { HeatMapChartProps} from '../../types/charts';
import { useChartTheme } from '../../hooks/useChartTheme';
import { BaseChart } from './BaseChart';
import { chartUtils } from '../../utils/chartUtils';

/**
 * ヒートマップチャートコンポーネント
 * 2次元データの密度や分布を色の濃淡で表示します
 */
export const HeatMapChart = memo(({ data, config, width, height, style, className }: HeatMapChartProps) => {
  const { colors, tooltip, formatTooltip } = useChartTheme();

  // 設定から頻繁に使用される値を抽出
  const { 
    tooltipFormatter, 
    chartColors, 
    xAxisLabel, 
    yAxisLabel,
    xAxisFormatter,
    yAxisFormatter,
    fillOpacity = 0.8,
    title,
    error: configError,
    isLoading
  } = config;

  // データの検証
  const { isValid, error } = useMemo(() => 
    chartUtils.validateHeatMapData(data),
    [data]
  );

  // 値に基づく色の取得
  const getColor = useCallback((value: number, min: number, max: number) => {
    const defaultColors = chartColors || [
      colors.success,
      colors.warning,
      colors.error,
    ];
    
    return chartUtils.getColorByValue(value, min, max, defaultColors);
  }, [chartColors, colors.success, colors.warning, colors.error]);

  // ツールチップフォーマッター
  const handleTooltip = useCallback((value: number, name: string, props: any) => {
    return formatTooltip(value, name, props, tooltipFormatter);
  }, [tooltipFormatter, formatTooltip]);

  // チャートコンテンツのメモ化
  const chartContent = useMemo(() => {
    if (!isValid || !data || data.length === 0) return null;

    // 全データを単一の配列に平坦化
    const flatData = data.flatMap(series => series.data);
    
    // 最小値と最大値の計算
    const valueMin = Math.min(...flatData.map(item => item.value));
    const valueMax = Math.max(...flatData.map(item => item.value));
    
    return (
      <ResponsiveContainer width={width ?? '100%'} height={height ?? 400}>
        <ScatterChart
          margin={tooltip.margin}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis 
            dataKey="x" 
            name="X"
            type="category"
            tickFormatter={xAxisFormatter}
            label={xAxisLabel ? {
              value: xAxisLabel,
              position: 'bottom',
              offset: -5
            } : undefined}
          />
          <YAxis 
            dataKey="y" 
            name="Y"
            type="category"
            tickFormatter={yAxisFormatter}
            label={yAxisLabel ? {
              value: yAxisLabel,
              angle: -90,
              position: 'insideLeft'
            } : undefined}
          />
          <ZAxis 
            dataKey="value" 
            range={[50, 500]} 
            name="値"
          />
          <Tooltip
            formatter={handleTooltip}
            contentStyle={tooltip.contentStyle}
            labelStyle={tooltip.labelStyle}
          />
          {data.map((series, seriesIndex) => (
            <Scatter 
              key={`series-${seriesIndex}`}
              name={series.name} 
              data={series.data} 
            >
              {series.data.map((entry, index) => (
                <Cell
                  key={`cell-${seriesIndex}-${index}`}
                  fill={getColor(entry.value, valueMin, valueMax)}
                  fillOpacity={fillOpacity}
                />
              ))}
            </Scatter>
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    );
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
    xAxisFormatter,
    yAxisFormatter,
    handleTooltip, 
    getColor,
    fillOpacity
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

HeatMapChart.displayName = 'HeatMapChart';
