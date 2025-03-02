import { memo, useMemo, useCallback } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { GaugeChartProps } from '../../types/charts';
import { useChartTheme } from '../../hooks/useChartTheme';
import { BaseChart } from './BaseChart';
import { chartUtils } from '../../utils/chartUtils';

/**
 * ゲージチャートコンポーネント
 * 単一の値を視覚的なゲージとして表示します
 */
const START_ANGLE = 180;
const END_ANGLE = 0;

export const GaugeChart = memo(({ data, config, width, height, style, className }: GaugeChartProps) => {
  const { colors, tooltip, formatTooltip } = useChartTheme();

  // 設定から頻繁に使用される値を抽出
  const { 
    tooltipFormatter, 
    chartColors, 
    min = 0, 
    max = 100, 
    precision = 0, 
    unit, 
    title, 
    error: configError, 
    isLoading 
  } = config;

  // データの検証
  const { isValid, error } = useMemo(() => 
    chartUtils.validateChartData(data, (items) => 
      items.every(item => item.value !== undefined && typeof item.value === 'number')
    ),
    [data]
  );

  // チャートデータの計算
  const chartData = useMemo(() => {
    if (!isValid || !data.length) return null;

    const value = data[0].value;
    const normalizedValue = Math.max(min, Math.min(max, value));
    const percentage = ((normalizedValue - min) / (max - min)) * 100;

    // 背景データ
    const backgroundData = [{ value: 100 }];
    // 値表示データ
    const valueData = [{ value: percentage }];

    return {
      normalizedValue,
      percentage,
      backgroundData,
      valueData
    };
  }, [isValid, data, min, max]);

  // パーセンテージに基づく色の取得
  const getColor = (percent: number): string => {
    if (chartColors && chartColors.length > 0) {
      return chartUtils.getColorByValue(percent, 0, 100, chartColors);
    }

    if (percent < 33) return colors.error;
    if (percent < 66) return colors.warning;
    return colors.success;
  };

  // 値ラベルのレンダリング
  const renderValueLabel = useCallback(({
    cx,
    cy,
  }: {
    cx: number;
    cy: number;
    value: number;
  }) => {
    if (!chartData) return null;
    
    return (
      <text
        x={cx}
        y={cy}
        fill="#666"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        <tspan x={cx} dy="-1em" fontSize="2em" fontWeight="bold">
          {chartData.normalizedValue.toFixed(precision)}
        </tspan>
        {unit && (
          <tspan x={cx} dy="1.5em" fontSize="1em">
            {unit}
          </tspan>
        )}
      </text>
    );
  }, [chartData, precision, unit]);

  // ツールチップフォーマッター
  const handleTooltip = useCallback((value: number, name: string, props: any) => {
    return formatTooltip(value, name, props, tooltipFormatter);
  }, [tooltipFormatter, formatTooltip]);

  // チャートコンテンツのメモ化
  const chartContent = useMemo(() => {
    if (!isValid || !chartData) return null;

    return (
      <ResponsiveContainer width={width ?? '100%'} height={height ?? 400}>
        <PieChart>
          {/* 背景アーク */}
          <Pie
            data={chartData.backgroundData}
            cx="50%"
            cy="50%"
            startAngle={START_ANGLE}
            endAngle={END_ANGLE}
            innerRadius="60%"
            outerRadius="80%"
            fill="#f5f5f5"
            stroke="none"
            dataKey="value"
          />
          {/* 値表示アーク */}
          <Pie
            data={chartData.valueData}
            cx="50%"
            cy="50%"
            startAngle={START_ANGLE}
            endAngle={START_ANGLE - ((START_ANGLE - END_ANGLE) * chartData.percentage) / 100}
            innerRadius="60%"
            outerRadius="80%"
            cornerRadius={5}
            dataKey="value"
            label={renderValueLabel}
            labelLine={false}
          >
            <Cell fill={getColor(chartData.percentage)} />
          </Pie>
          <Tooltip
            formatter={handleTooltip}
            contentStyle={tooltip.contentStyle}
            labelStyle={tooltip.labelStyle}
          />
        </PieChart>
      </ResponsiveContainer>
    );
  }, [
    isValid, 
    chartData, 
    width, 
    height, 
    renderValueLabel, 
    getColor,
    tooltip.contentStyle,
    tooltip.labelStyle,
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

GaugeChart.displayName = 'GaugeChart';
