import { memo, useMemo, useCallback } from 'react';
import {
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Label,
} from 'recharts';
import { AreaChartProps } from '../../types/charts';
import { useChartTheme } from '../../hooks/useChartTheme';
import { BaseChart } from './BaseChart';
import { chartUtils } from '../../utils/chartUtils';

/**
 * エリアチャートコンポーネント
 * 連続的なデータの推移と面積を表示します
 */
export const AreaChart = memo(({ data, config, width, height, style, className }: AreaChartProps) => {
  const { colors, tooltip, formatTooltip } = useChartTheme();

  // 設定から頻繁に使用される値を抽出
  const { 
    tooltipFormatter, 
    chartColors, 
    xAxisLabel, 
    yAxisLabel, 
    smooth, 
    fillOpacity = 0.3,
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
        <RechartsAreaChart
          data={data}
          margin={tooltip.margin}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            type="category"
            dataKey="x"
            name="X"
            allowDuplicatedCategory={false}
            interval={0}
          >
            {xAxisLabel && (
              <Label
                value={xAxisLabel}
                position="bottom"
                offset={-5}
              />
            )}
          </XAxis>
          <YAxis
            type="number"
            name="Y"
          >
            {yAxisLabel && (
              <Label
                value={yAxisLabel}
                position="insideLeft"
                angle={-90}
                style={{ textAnchor: 'middle' }}
              />
            )}
          </YAxis>
          <Tooltip
            formatter={handleTooltip}
            contentStyle={tooltip.contentStyle}
            labelStyle={tooltip.labelStyle}
          />
          <Area
            type={smooth ? "monotone" : "linear"}
            dataKey="y"
            stroke={primaryColor}
            fill={primaryColor}
            fillOpacity={fillOpacity}
          />
        </RechartsAreaChart>
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
    smooth, 
    primaryColor, 
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

AreaChart.displayName = 'AreaChart';
