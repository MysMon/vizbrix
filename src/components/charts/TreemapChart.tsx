import { memo, useMemo, useCallback } from 'react';
import {
  Treemap as RechartsTreemap,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { TreemapChartProps } from '../../types/charts';
import { useChartTheme } from '../../hooks/useChartTheme';
import { BaseChart } from './BaseChart';
import { chartUtils } from '../../utils/chartUtils';

/**
 * ツリーマップチャートコンポーネント
 * 階層構造を入れ子の長方形として表示します
 */
export const TreemapChart = memo(({ data, config, width, height, style, className }: TreemapChartProps) => {
  const { tooltip, formatTooltip, getColor } = useChartTheme();

  // 設定から頻繁に使用される値を抽出
  const { 
    tooltipFormatter, 
    chartColors, 
    title, 
    error: configError, 
    isLoading 
  } = config;

  // データの検証
  const { isValid, error } = useMemo(() => 
    chartUtils.validateChartData(data, (items) => 
      items.every(item => item.name !== undefined && item.value !== undefined)
    ),
    [data]
  );

  // カスタムコンテンツレンダラー
  const renderContent = useCallback((props: { x: number; y: number; width: number; height: number; depth: number; name: string }) => {
    const { x, y, width, height, depth, name } = props;
    if (width < 30 || height < 30) return null;

    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          style={{
            fill: getColor(depth, chartColors),
            stroke: '#fff',
            strokeWidth: 2 / (depth + 1e-10),
            strokeOpacity: 1 / (depth + 1e-10),
          }}
        />
        {width > 50 && height > 30 && (
          <text
            x={x + width / 2}
            y={y + height / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            style={{
              fontSize: 14,
              fill: '#fff',
              fontWeight: 'bold',
            }}
          >
            {name}
          </text>
        )}
      </g>
    );
  }, [chartColors, getColor]);

  // ツールチップフォーマッター
  const handleTooltip = useCallback((value: number, name: string, props: any) => {
    return formatTooltip(value, name, props, tooltipFormatter);
  }, [tooltipFormatter, formatTooltip]);

  // チャートコンテンツのメモ化
  const chartContent = useMemo(() => {
    if (!isValid) return null;

    return (
      <ResponsiveContainer width={width ?? '100%'} height={height ?? 400}>
        <RechartsTreemap
          data={data}
          dataKey="value"
          aspectRatio={4/3}
          stroke="#fff"
          content={renderContent}
        >
          <Tooltip
            formatter={handleTooltip}
            contentStyle={tooltip.contentStyle}
            labelStyle={tooltip.labelStyle}
          />
        </RechartsTreemap>
      </ResponsiveContainer>
    );
  }, [
    isValid, 
    data, 
    width, 
    height, 
    tooltip.contentStyle, 
    tooltip.labelStyle, 
    renderContent, 
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

TreemapChart.displayName = 'TreemapChart';
