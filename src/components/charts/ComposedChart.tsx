import { memo, useMemo, useCallback } from 'react';
import {
  ComposedChart as RechartsComposedChart,
  Line,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { ComposedChartProps } from '../../types/charts';
import { useChartTheme } from '../../hooks/useChartTheme';
import { BaseChart } from './BaseChart';
import { chartUtils } from '../../utils/chartUtils';

/**
 * 複合チャートコンポーネント
 * 複数の異なるチャートタイプ（ライン、バー、エリア）を1つのチャートに表示します
 */
export const ComposedChart = memo(({ data, config, width, height, style, className }: ComposedChartProps) => {
  const { colors, tooltip, formatTooltip } = useChartTheme();

  // 設定から頻繁に使用される値を抽出
  const { 
    tooltipFormatter, 
    chartColors, 
    series, 
    xAxisKey, 
    xAxisLabel, 
    yAxisLabel, 
    showLegend,
    title,
    error: configError,
    isLoading
  } = config;

  // データの検証
  const { isValid, error } = useMemo(() => 
    chartUtils.validateChartData(data, (items) => 
      items.every(item => 
        item.x !== undefined && 
        series.every(s => typeof item[s.dataKey] === 'number')
      )
    ),
    [data, series]
  );

  // ツールチップフォーマッター
  const handleTooltip = useCallback((value: number, name: string, props: any) => {
    return formatTooltip(value, name, props, tooltipFormatter);
  }, [tooltipFormatter, formatTooltip]);

  // タイプに応じたチャートコンポーネントのレンダリング
  const renderChartComponent = useCallback((seriesItem: typeof series[number], index: number) => {
    const seriesColor = chartUtils.getChartColor(chartColors, index, colors.primary);
    const commonProps = {
      key: seriesItem.dataKey,
      name: seriesItem.name ?? seriesItem.dataKey,
      dataKey: seriesItem.dataKey,
      stroke: seriesColor,
    };

    switch (seriesItem.type) {
      case 'line':
        return (
          <Line
            {...commonProps}
            type="monotone"
            dot={false}
            activeDot={{ r: 8 }}
          />
        );
      case 'bar':
        return (
          <Bar
            {...commonProps}
            fill={seriesColor}
          />
        );
      case 'area':
        return (
          <Area
            {...commonProps}
            type="monotone"
            fill={seriesColor}
            fillOpacity={0.6}
          />
        );
      default:
        return null;
    }
  }, [chartColors, colors.primary]);

  // チャートコンテンツのメモ化
  const chartContent = useMemo(() => {
    if (!isValid) return null;

    return (
      <ResponsiveContainer width={width ?? '100%'} height={height ?? 400}>
        <RechartsComposedChart
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
          {series.map((seriesItem, index) => renderChartComponent(seriesItem, index))}
        </RechartsComposedChart>
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
    yAxisLabel, 
    showLegend, 
    handleTooltip, 
    series, 
    renderChartComponent
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

ComposedChart.displayName = 'ComposedChart';
