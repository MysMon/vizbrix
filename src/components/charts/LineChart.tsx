import { FC, useMemo } from 'react';
import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { ChartContainer } from '../ChartContainer';
import { LineChartProps, TooltipProps } from '../../types/charts';
import { useTheme } from '../../theme/ThemeProvider';
import { chartUtils } from '../../utils/chartUtils';

export const LineChart: FC<LineChartProps> = ({
  data = [],
  width,
  height,
  className,
  style,
  config: {
    xAxisKey,
    yAxisKey,
    title,
    tooltipFormatter,
    chartColors,
    smooth = false,
    showDots = true,
    dotSize = 4,
    showLegend = false,
    xAxisLabel,
    yAxisLabel,
    error: propError,
    isLoading
  }
}) => {
  const theme = useTheme();
  const {
    colors: { primary, text, grid },
    typography: { fontSize }
  } = theme;
  
  const defaultColor = (chartColors && chartColors[0]) || primary;

  const { validData, error: validationError } = useMemo(() => 
    chartUtils.validateData(
      data,
      [xAxisKey, yAxisKey],
      [yAxisKey]
    ),
  [data, xAxisKey, yAxisKey]);

  const hasData = validData.length > 0;
  const error = propError || validationError;

  const yDomain = useMemo(() => {
    if (!hasData) return [0, 0];
    const values = validData.map(item => Number(item[yAxisKey]));
    return chartUtils.calculateDomain(values, { padding: 0.1 });
  }, [validData, yAxisKey, hasData]);

  const CustomTooltip = ({ active, payload }: TooltipProps) => {
    if (!active || !payload || !payload.length) return null;

    const data = payload[0].payload as { name: string; value: number };
    const formattedValue = tooltipFormatter
      ? tooltipFormatter(data.value, data.name, { value: data.value, name: data.name, dataKey: 'value', payload: data })
      : chartUtils.formatValue(data.value);

    return (
      <div className="custom-tooltip">
        <p>{`${data.name}: ${formattedValue}`}</p>
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
          <RechartsLineChart
            data={validData}
            margin={{ top: theme.spacing.chart, right: theme.spacing.chart, left: 0, bottom: 0 }}
          >
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke={grid} 
            />
            <XAxis
              dataKey={xAxisKey}
              stroke={text}
              fontSize={fontSize.label}
              label={xAxisLabel ? {
                value: xAxisLabel,
                position: 'bottom',
                offset: 0,
                fontSize: fontSize.label,
                fill: text
              } : undefined}
              tick={{ fill: text }}
            />
            <YAxis
              stroke={text}
              fontSize={fontSize.label}
              domain={yDomain}
              label={yAxisLabel ? {
                value: yAxisLabel,
                angle: -90,
                position: 'insideLeft',
                fontSize: fontSize.label,
                fill: text
              } : undefined}
              tick={{ fill: text }}
            />
            <Tooltip
              content={<CustomTooltip />}
              contentStyle={chartUtils.getTooltipStyle(theme)}
            />
            {showLegend && (
              <Legend
                wrapperStyle={chartUtils.getLegendStyle(theme)}
              />
            )}
            <Line
              type={smooth ? "monotone" : "linear"}
              dataKey={yAxisKey}
              stroke={defaultColor}
              strokeWidth={2}
              dot={showDots ? { r: dotSize, fill: defaultColor } : false}
              activeDot={{ r: dotSize + 2, fill: defaultColor }}
              isAnimationActive={!isLoading}
            />
          </RechartsLineChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
};
