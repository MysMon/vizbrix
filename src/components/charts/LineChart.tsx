import { memo, useMemo, useCallback } from 'react';
import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { LineChartProps } from '../../types/charts';
import { useChartTheme } from '../../hooks/useChartTheme';
import { BaseChart } from './BaseChart';
import { chartUtils } from '../../utils/chartUtils';

/**
 * 折れ線グラフコンポーネント
 * 連続的なデータの推移を折れ線で表示します
 */
export const LineChart = memo(({ data, config, width, height, style, className }: LineChartProps) => {
  const { colors, tooltip, formatTooltip } = useChartTheme();

  // 設定から頻繁に使用される値を抽出
  const { 
    tooltipFormatter, 
    xAxisKey, 
    yAxisKey = 'y', 
    xAxisLabel, 
    yAxisLabel, 
    showLegend, 
    smooth, 
    showDots = true, 
    dotSize = 8,
    chartColors,
    title,
    error: configError,
    isLoading
  } = config;
  
  const primaryColor = chartColors?.[0] ?? colors.primary;

  // データの検証
  const { isValid, error } = useMemo(() => 
    chartUtils.validateXYData(data),
    [data]
  );

  // ツールチップフォーマッター
  const handleTooltip = useCallback((value: number, name: string, props: any) => {
    return formatTooltip(value, name, props, tooltipFormatter);
  }, [tooltipFormatter, formatTooltip]);

  // チャートコンテンツのメモ化
  const chartContent = useMemo(() => {
    if (!isValid) return null;

    return (
      <ResponsiveContainer width={width ?? '100%'} height={height ?? 400}>
        <RechartsLineChart
          data={data}
          margin={tooltip.margin}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey={xAxisKey}
            label={xAxisLabel ? {
              value: xAxisLabel,
              position: 'bottom',
              offset: -5
            } : undefined}
          />
          <YAxis
            label={yAxisLabel ? {
              value: yAxisLabel,
              angle: -90,
              position: 'insideLeft'
            } : undefined}
          />
          <Tooltip
            formatter={handleTooltip}
            contentStyle={tooltip.contentStyle}
            labelStyle={tooltip.labelStyle}
          />
          {showLegend && (
            <Legend
              align="center"
              verticalAlign="bottom"
            />
          )}
          <Line
            type={smooth ? 'monotone' : 'linear'}
            dataKey={yAxisKey}
            stroke={primaryColor}
            dot={showDots}
            activeDot={{ r: dotSize }}
          />
        </RechartsLineChart>
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
    xAxisKey, 
    xAxisLabel, 
    yAxisKey, 
    yAxisLabel, 
    showLegend, 
    smooth, 
    showDots, 
    dotSize, 
    primaryColor, 
    handleTooltip
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

LineChart.displayName = 'LineChart';
