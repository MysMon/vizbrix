import { memo, useMemo, useCallback } from 'react';
import {
  ScatterChart as RechartsScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ZAxis,
} from 'recharts';
import { ScatterChartProps } from '../../types/charts';
import { useChartTheme } from '../../hooks/useChartTheme';
import { BaseChart } from './BaseChart';
import { chartUtils } from '../../utils/chartUtils';

/**
 * 散布図コンポーネント
 * 2つの変数の関係を点として表示します
 */
export const ScatterChart = memo(({ data, config, width, height, style, className }: ScatterChartProps) => {
  const { colors, tooltip, formatTooltip } = useChartTheme();

  // 設定から頻繁に使用される値を抽出
  const { 
    tooltipFormatter, 
    chartColors, 
    xAxisLabel, 
    yAxisLabel, 
    zAxisKey,
    showLegend,
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

    // 散布図のプロパティを設定
    const scatterProps = zAxisKey 
      ? { 
          fill: primaryColor,
          zAxisId: "z",
          zAxisKey: zAxisKey
        } 
      : {
          fill: primaryColor
        };

    return (
      <ResponsiveContainer width={width ?? '100%'} height={height ?? 400}>
        <RechartsScatterChart
          margin={tooltip.margin}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis 
            type="number" 
            dataKey="x" 
            name="X"
            label={xAxisLabel ? {
              value: xAxisLabel,
              position: 'bottom',
              offset: -5
            } : undefined}
          />
          <YAxis 
            type="number" 
            dataKey="y" 
            name="Y"
            label={yAxisLabel ? {
              value: yAxisLabel,
              angle: -90,
              position: 'insideLeft'
            } : undefined}
          />
          {zAxisKey && (
            <ZAxis
              type="number"
              dataKey={zAxisKey}
              range={[100, 1000]}
            />
          )}
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
          <Scatter
            name="散布図"
            data={data}
            {...scatterProps}
          />
        </RechartsScatterChart>
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
    handleTooltip, 
    primaryColor,
    zAxisKey,
    showLegend
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

ScatterChart.displayName = 'ScatterChart';
