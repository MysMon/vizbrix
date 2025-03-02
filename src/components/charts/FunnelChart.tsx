import { memo, useMemo, useCallback } from 'react';
import {
  FunnelChart as RechartsFunnelChart,
  Funnel,
  LabelList,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { FunnelChartProps } from '../../types/charts';
import { useChartTheme } from '../../hooks/useChartTheme';
import { BaseChart } from './BaseChart';
import { chartUtils } from '../../utils/chartUtils';

/**
 * ファネルチャートコンポーネント
 * プロセスの各段階での変換率や離脱率を表示します
 */
export const FunnelChart = memo(({ data, config, width, height, style, className }: FunnelChartProps) => {
  const { colors, tooltip, formatTooltip } = useChartTheme();

  // 設定から頻繁に使用される値を抽出
  const { 
    tooltipFormatter, 
    chartColors, 
    title, 
    error: configError, 
    isLoading 
  } = config;
  const primaryColor = chartColors?.[0] ?? colors.primary;

  // データの検証
  const { isValid, error } = useMemo(() => 
    chartUtils.validateNameValueData(data),
    [data]
  );

  // ツールチップフォーマッター
  const handleTooltip = useCallback((value: number, name: string, props: any) => {
    return formatTooltip(value, name, props, tooltipFormatter);
  }, [tooltipFormatter, formatTooltip]);

  // ラベルのカスタマイズ
  const renderLabel = useCallback((props: { name: string; value: number }) => {
    const { name, value } = props;
    return `${name}: ${value}`;
  }, []);

  // チャートコンテンツのメモ化
  const chartContent = useMemo(() => {
    if (!isValid) return null;

    return (
      <ResponsiveContainer width={width ?? '100%'} height={height ?? 400}>
        <RechartsFunnelChart>
          <Tooltip
            formatter={handleTooltip}
            contentStyle={tooltip.contentStyle}
            labelStyle={tooltip.labelStyle}
          />
          <Funnel
            data={data}
            dataKey="value"
            nameKey="name"
            fill={primaryColor}
            isAnimationActive
            labelLine
          >
            <LabelList
              position="right"
              fill="#000"
              stroke="none"
              dataKey="name"
              formatter={renderLabel}
            />
          </Funnel>
        </RechartsFunnelChart>
      </ResponsiveContainer>
    );
  }, [
    isValid, 
    data, 
    width, 
    height, 
    tooltip.contentStyle, 
    tooltip.labelStyle, 
    handleTooltip, 
    primaryColor, 
    renderLabel
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

FunnelChart.displayName = 'FunnelChart';
