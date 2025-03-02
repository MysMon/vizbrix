import { memo, useMemo, useCallback } from 'react';
import {
  Sankey as RechartsSankey,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { SankeyChartProps } from '../../types/charts';
import { useChartTheme } from '../../hooks/useChartTheme';
import { BaseChart } from './BaseChart';
import { chartUtils } from '../../utils/chartUtils';

/**
 * サンキーチャートコンポーネント
 * フローやプロセス間の関係や流れを可視化します
 */
export const SankeyChart = memo(({ data, config, width, height, style, className }: SankeyChartProps) => {
  const { colors, tooltip, formatTooltip } = useChartTheme();

  // 設定から頻繁に使用される値を抽出
  const { 
    tooltipFormatter, 
    chartColors, 
    nodeWidth, 
    nodePadding, 
    title, 
    error: configError, 
    isLoading 
  } = config;
  const defaultColor = chartColors?.[0] ?? colors.primary;

  // データの検証
  const { isValid, error } = useMemo(() => 
    chartUtils.validateSankeyData(data),
    [data]
  );

  // ツールチップフォーマッター
  const handleTooltip = useCallback((value: number, name: string, props: any) => {
    return formatTooltip(value, name, props, tooltipFormatter);
  }, [tooltipFormatter, formatTooltip]);
  
  // スタイルのメモ化
  const nodeStyle = useMemo(() => ({
    fill: defaultColor,
    stroke: '#fff',
    strokeWidth: 2,
  }), [defaultColor]);

  const linkStyle = useMemo(() => ({
    fill: defaultColor,
    fillOpacity: 0.2,
    stroke: defaultColor,
    strokeOpacity: 0.2,
  }), [defaultColor]);

  // チャートコンテンツのメモ化
  const chartContent = useMemo(() => {
    if (!isValid) return null;

    return (
      <ResponsiveContainer width={width ?? '100%'} height={height ?? 400}>
        <RechartsSankey
          data={data}
          nodeWidth={nodeWidth ?? 10}
          nodePadding={nodePadding ?? 50}
          margin={tooltip.margin}
          node={nodeStyle}
          link={linkStyle}
        >
          <Tooltip
            formatter={handleTooltip}
            contentStyle={tooltip.contentStyle}
            labelStyle={tooltip.labelStyle}
          />
        </RechartsSankey>
      </ResponsiveContainer>
    );
  }, [
    isValid, 
    data, 
    width, 
    height, 
    nodeWidth, 
    nodePadding, 
    tooltip.margin, 
    tooltip.contentStyle, 
    tooltip.labelStyle, 
    nodeStyle, 
    linkStyle, 
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

SankeyChart.displayName = 'SankeyChart';
