import { FC, useMemo } from 'react';
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { ChartContainer } from '../ChartContainer';
import { BarChartProps, TooltipProps } from '../../types/charts';
import { useTheme } from '../../theme/ThemeProvider';
import { chartUtils } from '../../utils/chartUtils';

export const BarChart: FC<BarChartProps> = ({
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
    layout = 'vertical',
    stackedKeys,
    chartColors,
    showLegend = false,
    xAxisLabel,
    yAxisLabel,
    error: propError,
    isLoading
  }
}) => {
  const theme = useTheme();
  const {
    colors: { primary, secondary, success, warning, text, grid },
    typography: { fontSize }
  } = theme;

  const defaultColors = chartColors || [primary, secondary, success, warning];

  const { validData, error: validationError } = useMemo(() => {
    const keysToValidate = stackedKeys ? [xAxisKey, ...stackedKeys] : [xAxisKey, yAxisKey];
    const numericKeys = stackedKeys || [yAxisKey];
    return chartUtils.validateData(data, keysToValidate, numericKeys);
  }, [data, xAxisKey, yAxisKey, stackedKeys]);

  const hasData = validData.length > 0;
  const error = propError || validationError;

  const yDomain = useMemo(() => {
    if (!hasData) return [0, 0];
    if (stackedKeys) {
      const stackTotals = validData.map(item => 
        stackedKeys.reduce((sum, key) => sum + Number(item[key] || 0), 0)
      );
      return chartUtils.calculateDomain(stackTotals, { padding: 0.1 });
    }
    const values = validData.map(item => Number(item[yAxisKey]));
    return chartUtils.calculateDomain(values, { padding: 0.1 });
  }, [validData, yAxisKey, stackedKeys, hasData]);

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
          <RechartsBarChart
            data={validData}
            layout={layout}
            margin={{ top: theme.spacing.chart, right: theme.spacing.chart, left: 0, bottom: 0 }}
          >
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke={grid} 
            />
            <XAxis
              type={layout === 'vertical' ? 'number' : 'category'}
              dataKey={layout === 'vertical' ? undefined : xAxisKey}
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
              domain={layout === 'vertical' ? yDomain : undefined}
            />
            <YAxis
              type={layout === 'vertical' ? 'category' : 'number'}
              dataKey={layout === 'vertical' ? yAxisKey : undefined}
              stroke={text}
              fontSize={fontSize.label}
              label={yAxisLabel ? {
                value: yAxisLabel,
                angle: -90,
                position: 'insideLeft',
                fontSize: fontSize.label,
                fill: text
              } : undefined}
              tick={{ fill: text }}
              domain={layout === 'vertical' ? undefined : yDomain}
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
            {stackedKeys ? (
              stackedKeys.map((key, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={defaultColors[index % defaultColors.length]}
                  stackId="stack"
                  isAnimationActive={!isLoading}
                />
              ))
            ) : (
              <Bar
                dataKey={yAxisKey}
                fill={defaultColors[0]}
                isAnimationActive={!isLoading}
              />
            )}
          </RechartsBarChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
};
