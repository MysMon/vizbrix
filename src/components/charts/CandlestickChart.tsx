import { useMemo, useCallback, memo } from 'react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { CandlestickChartProps} from '../../types/charts';
import { useChartTheme } from '../../hooks/useChartTheme';
import { BaseChart } from './BaseChart';
import { chartUtils } from '../../utils/chartUtils';

/**
 * ローソク足チャートコンポーネント
 * 株価や為替などの時系列データを表示します
 */
interface CandleBarData {
  x: number;
  y: number;
  width: number;
  height: number;
  stroke?: string;
  index: number;
  payload: {
    isPositive: boolean;
    candleHeight: number;
    candleY: number;
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
  };
}

export const CandlestickChart = memo(({ 
  data, 
  config, 
  width, 
  height, 
  style, 
  className 
}: CandlestickChartProps) => {
  const { tooltip, formatTooltip } = useChartTheme();

  // 設定から頻繁に使用される値を抽出
  const { 
    tooltipFormatter, 
    xAxisLabel, 
    yAxisLabel, 
    upColor = '#4caf50', 
    downColor = '#ef5350',
    title,
    error: configError,
    isLoading
  } = config;

  // データの検証
  const { isValid, error } = useMemo(() => 
    chartUtils.validateCandlestickData(data),
    [data]
  );

  // ツールチップフォーマッター
  const handleTooltip = useCallback((value: number, name: string, props: any) => {
    return formatTooltip(value, name, props, tooltipFormatter);
  }, [tooltipFormatter, formatTooltip]);

  // カスタムバーレンダリング
  const renderCandlestick = useCallback((props: unknown) => {
    const {
      x = 0,
      y = 0,
      width = 0,
      height = 0,
      payload = { isPositive: true }
    } = props as CandleBarData;
    
    const barWidth = Math.max(1, width);
    const color = payload.isPositive ? upColor : downColor;

    return (
      <path
        d={`M${x - barWidth / 2},${y}h${barWidth}v${height}h-${barWidth}Z`}
        stroke={color}
        fill={color}
      />
    );
  }, [upColor, downColor]);

  // データの加工
  const processedData = useMemo(() => {
    if (!isValid) return [];
    
    return data.map(item => ({
      ...item,
      candleHeight: Math.abs(item.open - item.close),
      candleY: Math.min(item.open, item.close),
      isPositive: item.close >= item.open,
    }));
  }, [data, isValid]);

  // チャートコンテンツのメモ化
  const chartContent = useMemo(() => {
    if (!isValid) return null;

    return (
      <ResponsiveContainer width={width ?? '100%'} height={height ?? 400}>
        <ComposedChart
          data={processedData}
          margin={tooltip.margin}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            scale="band"
            label={xAxisLabel ? {
              value: xAxisLabel,
              position: 'bottom',
              offset: -5
            } : undefined}
          />
          <YAxis
            domain={['dataMin', 'dataMax']}
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
          <Bar
            dataKey="candleHeight"
            shape={renderCandlestick}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="high"
            stroke="#666"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="low"
            stroke="#666"
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    );
  }, [
    isValid, 
    processedData, 
    width, 
    height, 
    tooltip.margin, 
    tooltip.contentStyle, 
    tooltip.labelStyle,
    xAxisLabel, 
    yAxisLabel, 
    handleTooltip, 
    renderCandlestick
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

CandlestickChart.displayName = 'CandlestickChart';
