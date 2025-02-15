import { FC, useMemo } from 'react';
import {
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { ChartContainer } from '../ChartContainer';
import { AreaChartProps } from '../../types/charts';
import { useTheme } from '../../theme/ThemeProvider';
import { chartUtils } from '../../utils/chartUtils';

export const AreaChart: FC<AreaChartProps> = ({
  data = [],
  width,
  height,
  className,
  style,
  config: {
    xAxisKey,
    yAxisKey,
    stackedKeys,
    title,
    tooltipFormatter,
    chartColors,
    fillOpacity = 0.3,
    smooth = false,
    showLegend = false,
    error: propError,
    isLoading,
  }
}) => {
  const theme = useTheme();
  const {
    colors: { primary, secondary, success, warning, text, grid },
    typography: { fontSize }
  } = theme;

  const defaultColors = chartColors || [primary, secondary, success, warning];

  const { validData, error: validationError } = useMemo(() => {
    const requiredKeys = [xAxisKey, yAxisKey];
    const numericKeys = [yAxisKey];

    if (stackedKeys) {
      requiredKeys.push(...stackedKeys);
      numericKeys.push(...stackedKeys);
    }

    return chartUtils.validateData(
      data,
      requiredKeys,
      numericKeys
    );
  }, [data, xAxisKey, yAxisKey, stackedKeys]);

  const hasData = validData.length > 0;
  const error = propError || validationError;

  const yDomain = useMemo(() => {
    if (!hasData) return [0, 0];

    const allValues = validData.reduce((acc, item) => {
      if (stackedKeys) {
        const stackSum = stackedKeys.reduce((sum, key) => sum + Number(item[key] || 0), 0);
        acc.push(stackSum);
      } else {
        acc.push(Number(item[yAxisKey]));
      }
      return acc;
    }, [] as number[]);

    return chartUtils.calculateDomain(allValues, { padding: 0.1 });
  }, [validData, yAxisKey, stackedKeys, hasData]);

  const renderArea = (dataKey: string, index: number) => (
    <Area
      key={dataKey}
      type={smooth ? "monotone" : "linear"}
      dataKey={dataKey}
      name={dataKey}
      stroke={defaultColors[index % defaultColors.length]}
      fill={defaultColors[index % defaultColors.length]}
      fillOpacity={fillOpacity}
      stackId={stackedKeys ? "stack" : undefined}
      isAnimationActive={!isLoading}
    />
  );

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
          <RechartsAreaChart
            data={validData}
            margin={{ top: theme.spacing.chart, right: theme.spacing.chart, bottom: theme.spacing.chart, left: theme.spacing.chart }}
          >
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke={grid} 
            />
            <XAxis
              dataKey={xAxisKey}
              stroke={text}
              fontSize={fontSize.label}
            />
            <YAxis
              domain={yDomain}
              stroke={text}
              fontSize={fontSize.label}
            />
            <Tooltip
              content={({ active, payload }) => {
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
              }}
              contentStyle={chartUtils.getTooltipStyle(theme)}
            />
            {showLegend && (
              <Legend
                wrapperStyle={chartUtils.getLegendStyle(theme)}
              />
            )}
            {stackedKeys
              ? stackedKeys.map((key, index) => renderArea(key, index))
              : renderArea(yAxisKey, 0)
            }
          </RechartsAreaChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
};
