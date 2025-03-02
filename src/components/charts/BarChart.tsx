import { memo, useMemo, useCallback } from 'react';
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { BarChartProps } from '../../types/charts';
import { useChartTheme } from '../../hooks/useChartTheme';
import { BaseChart } from './BaseChart';
import { chartUtils } from '../../utils/chartUtils';

/**
 * バーチャートコンポーネント
 * カテゴリごとの数値データを棒グラフとして表示します
 */
export const BarChart = memo(({ data, config, width, height, style, className }: BarChartProps) => {
  const { colors, tooltip, formatTooltip } = useChartTheme();

  // 設定から頻繁に使用される値を抽出
  const { 
    tooltipFormatter, 
    chartColors, 
    xAxisLabel, 
    yAxisLabel, 
    showLegend, 
    horizontal = false,
    title,
    error: configError,
    isLoading
  } = config;
  
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

    // 水平/垂直レイアウト設定
    const chartLayout = horizontal ? 'horizontal' : 'vertical';
    
    // X軸とY軸のキー設定
    const xKey = 'x';
    const yKey = 'y';
    
    // バーの色
    const barColor = chartColors?.[0] ?? colors.primary;

    return (
      <ResponsiveContainer width={width ?? '100%'} height={height ?? 400}>
        <RechartsBarChart
          data={data}
          layout={chartLayout}
          margin={tooltip.margin}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            type="category"
            dataKey={chartLayout === 'horizontal' ? yKey : xKey}
            label={xAxisLabel ? {
              value: xAxisLabel,
              position: 'bottom',
              offset: -5
            } : undefined}
          />
          <YAxis
            type="number"
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
          <Bar
            dataKey={chartLayout === 'horizontal' ? xKey : yKey}
            fill={barColor}
            radius={[4, 4, 0, 0]}
          />
        </RechartsBarChart>
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
    horizontal,
    chartColors,
    colors.primary,
    xAxisLabel,
    yAxisLabel,
    showLegend,
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

BarChart.displayName = 'BarChart';
