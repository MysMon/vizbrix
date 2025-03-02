import { memo, useMemo, useCallback } from 'react';
import {
  RadarChart as RechartsRadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { RadarChartProps } from '../../types/charts';
import { useChartTheme } from '../../hooks/useChartTheme';
import { BaseChart } from './BaseChart';
import { chartUtils } from '../../utils/chartUtils';

/**
 * レーダーチャートコンポーネント
 * 複数の変数を角度別に並べて比較します
 */
export const RadarChart = memo(({ data, config, width, height, style, className }: RadarChartProps) => {
  const { tooltip, formatTooltip, getColor } = useChartTheme();

  // 設定から頻繁に使用される値を抽出
  const { 
    tooltipFormatter, 
    chartColors, 
    nameKey,
    dataKeys = [],
    showLegend,
    fillOpacity = 0.6,
    title,
    error: configError,
    isLoading
  } = config;
  
  // データの検証
  const { isValid, error } = useMemo(() => 
    chartUtils.validateRadarData(data, nameKey, dataKeys),
    [data, nameKey, dataKeys]
  );

  // ツールチップフォーマッター
  const handleTooltip = useCallback((value: number, name: string, props: any) => {
    return formatTooltip(value, name, props, tooltipFormatter);
  }, [tooltipFormatter, formatTooltip]);

  // チャートコンテンツのメモ化
  const chartContent = useMemo(() => {
    if (!isValid || dataKeys.length === 0) return null;

    return (
      <ResponsiveContainer width={width ?? '100%'} height={height ?? 400}>
        <RechartsRadarChart
          cx="50%"
          cy="50%"
          outerRadius="80%"
          data={data}
          margin={tooltip.margin}
        >
          <PolarGrid />
          <PolarAngleAxis dataKey={nameKey} />
          <PolarRadiusAxis />
          <Tooltip
            formatter={handleTooltip}
            contentStyle={tooltip.contentStyle}
            labelStyle={tooltip.labelStyle}
          />
          {dataKeys.map((dataKey, index) => (
            <Radar
              key={dataKey}
              name={dataKey}
              dataKey={dataKey}
              stroke={getColor(index, chartColors)}
              fill={getColor(index, chartColors)}
              fillOpacity={fillOpacity}
            />
          ))}
          {showLegend && (
            <Legend
              align="center"
              verticalAlign="bottom"
            />
          )}
        </RechartsRadarChart>
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
    nameKey, 
    dataKeys, 
    handleTooltip, 
    chartColors, 
    fillOpacity,
    showLegend,
    getColor
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

RadarChart.displayName = 'RadarChart';
