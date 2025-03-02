import { memo, useMemo, useCallback } from 'react';
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { PieChartProps } from '../../types/charts';
import { useChartTheme } from '../../hooks/useChartTheme';
import { BaseChart } from './BaseChart';
import { chartUtils } from '../../utils/chartUtils';

/**
 * 円グラフコンポーネント
 * カテゴリ別の割合やシェアを円形で表示します
 */
export const PieChart = memo(({ data, config, width, height, style, className }: PieChartProps) => {
  const { colors, tooltip, formatTooltip, getColor } = useChartTheme();

  // 設定から頻繁に使用される値を抽出
  const { 
    tooltipFormatter, 
    chartColors, 
    showLegend,
    innerRadius = 0,
    outerRadius = '80%',
    nameKey = 'name',
    valueKey = 'value',
    labelLine = true,
    title,
    error: configError,
    isLoading
  } = config;

  // データの検証
  const { isValid, error } = useMemo(() => 
    chartUtils.validateNameValueData(data),
    [data]
  );

  // ツールチップフォーマッター
  const handleTooltip = useCallback((value: number, name: string, props: any) => {
    return formatTooltip(value, name, props, tooltipFormatter);
  }, [tooltipFormatter, formatTooltip]);

  // チャートコンテンツのメモ化
  const chartContent = useMemo(() => {
    if (!isValid) return null;

    const defaultColors = [
      colors.primary,
      colors.secondary,
      colors.success,
      colors.warning,
      colors.error,
    ];

    const pieColors = chartColors || defaultColors;

    return (
      <ResponsiveContainer width={width ?? '100%'} height={height ?? 400}>
        <RechartsPieChart
          margin={tooltip.margin}
        >
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
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            fill={colors.primary}
            nameKey={nameKey}
            dataKey={valueKey}
            labelLine={labelLine}
          >
            {data.map((_entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={getColor(index, pieColors)}
              />
            ))}
          </Pie>
        </RechartsPieChart>
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
    showLegend, 
    innerRadius, 
    outerRadius, 
    nameKey, 
    valueKey, 
    labelLine, 
    handleTooltip,
    getColor,
    chartColors,
    colors.primary
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

PieChart.displayName = 'PieChart';
