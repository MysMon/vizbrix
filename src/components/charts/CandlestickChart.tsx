import { FC, useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { TooltipProps as RechartsTooltipProps } from 'recharts';
import { ChartContainer } from '../ChartContainer';
import { CandlestickChartProps } from '../../types/charts';
import { useTheme } from '../../theme/ThemeProvider';
import { chartUtils } from '../../utils/chartUtils';

interface CandlestickData {
  date: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  color: string;
  wickColor: string;
}

export const CandlestickChart: FC<CandlestickChartProps> = ({
  data = [],
  width,
  height,
  className,
  style,
  config: {
    title,
    tooltipFormatter,
    upColor,
    downColor,
    error: propError,
    isLoading,
  }
}) => {
  const theme = useTheme();
  const {
    colors: { success, error: errorColor, text },
    typography: { fontSize }
  } = theme;

  const defaultUpColor = upColor || success;
  const defaultDownColor = downColor || errorColor;

  const { validData, error: validationError } = useMemo(() => {
    if (!Array.isArray(data)) {
      return {
        validData: [],
        error: 'データの形式が正しくありません'
      };
    }

    const validPoints = data.filter(point => 
      typeof point === 'object' &&
      point !== null &&
      'date' in point &&
      'open' in point &&
      'high' in point &&
      'low' in point &&
      'close' in point &&
      !isNaN(Number(point.open)) &&
      !isNaN(Number(point.high)) &&
      !isNaN(Number(point.low)) &&
      !isNaN(Number(point.close))
    );

    if (validPoints.length === 0) {
      return {
        validData: [],
        error: 'データが見つかりません'
      };
    }

    const processedData: CandlestickData[] = validPoints.map(point => {
      const open = Number(point.open);
      const close = Number(point.close);
      const isUp = close >= open;

      return {
        ...point,
        open,
        high: Number(point.high),
        low: Number(point.low),
        close,
        color: isUp ? defaultUpColor : defaultDownColor,
        wickColor: isUp ? defaultUpColor : defaultDownColor,
      };
    });

    return {
      validData: processedData,
      error: undefined
    };
  }, [data, defaultUpColor, defaultDownColor]);

  const hasData = validData.length > 0;
  const error = propError || validationError;

  const { yDomain } = useMemo(() => {
    if (!hasData) return { yDomain: [0, 0] };

    const allValues = validData.reduce((acc, point) => {
      acc.push(point.high, point.low);
      return acc;
    }, [] as number[]);

    const [min, max] = chartUtils.calculateDomain(allValues, { padding: 0.1 });

    return {
      yDomain: [min, max],
    };
  }, [validData, hasData]);

  const renderTooltipContent = (props: RechartsTooltipProps<number, string>) => {
    if (!props.payload || !props.payload[0]) return null;

    const data = props.payload[0].payload as CandlestickData;
    const formattedValues = {
      open: tooltipFormatter ? tooltipFormatter(data.open, '始値', { value: data.open, name: '始値', dataKey: 'open', payload: data }) : chartUtils.formatValue(data.open),
      high: tooltipFormatter ? tooltipFormatter(data.high, '高値', { value: data.high, name: '高値', dataKey: 'high', payload: data }) : chartUtils.formatValue(data.high),
      low: tooltipFormatter ? tooltipFormatter(data.low, '安値', { value: data.low, name: '安値', dataKey: 'low', payload: data }) : chartUtils.formatValue(data.low),
      close: tooltipFormatter ? tooltipFormatter(data.close, '終値', { value: data.close, name: '終値', dataKey: 'close', payload: data }) : chartUtils.formatValue(data.close),
    };

    return (
      <div style={chartUtils.getTooltipStyle(theme)}>
        <p style={{ margin: '0 0 5px' }}>日付: {data.date}</p>
        <p style={{ margin: '0 0 5px' }}>始値: {formattedValues.open}</p>
        <p style={{ margin: '0 0 5px' }}>高値: {formattedValues.high}</p>
        <p style={{ margin: '0 0 5px' }}>安値: {formattedValues.low}</p>
        <p style={{ margin: '0' }}>終値: {formattedValues.close}</p>
      </div>
    );
  };

  return (
    <ChartContainer 
      title={title}
      width={width}
      height={height}
      className={className} 
      style={style}
      hasError={!hasData}
      error={error}
      isLoading={isLoading}
    >
      {hasData && (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={validData}
            margin={{ top: theme.spacing.chart, right: theme.spacing.chart, bottom: theme.spacing.chart, left: theme.spacing.chart }}
          >
            <XAxis
              dataKey="date"
              stroke={text}
              fontSize={fontSize.label}
            />
            <YAxis
              domain={yDomain}
              stroke={text}
              fontSize={fontSize.label}
            />
            <Tooltip content={renderTooltipContent} />
            <Bar
              dataKey="open"
              fill="transparent"
              stroke="none"
              isAnimationActive={!isLoading}
            />
            <Bar
              dataKey="close"
              fill={defaultDownColor}
              fillOpacity={0}
              stroke="none"
              isAnimationActive={!isLoading}
            >
              {validData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.color}
                />
              ))}
            </Bar>
            <Line
              type="monotone"
              dataKey="high"
              stroke={defaultUpColor}
              dot={false}
              isAnimationActive={!isLoading}
            />
            <Line
              type="monotone"
              dataKey="low"
              stroke={defaultDownColor}
              dot={false}
              isAnimationActive={!isLoading}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
};
