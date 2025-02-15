import { FC, useMemo } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { TooltipProps as RechartsTooltipProps } from 'recharts';
import { ChartContainer } from '../ChartContainer';
import { HeatMapChartProps, HeatMapDataPoint } from '../../types/charts';
import { useTheme } from '../../theme/ThemeProvider';
import { chartUtils } from '../../utils/chartUtils';

export const HeatMapChart: FC<HeatMapChartProps> = ({
  data = [],
  width,
  height,
  className,
  style,
  config: {
    title,
    tooltipFormatter,
    xAxisFormatter,
    yAxisFormatter,
    chartColors,
    error: propError,
    isLoading,
  }
}) => {
  const theme = useTheme();
  const {
    colors: { primary, error: errorColor, text },
    typography: { fontSize }
  } = theme;

  const defaultColors = useMemo(() => chartColors || [primary, errorColor], [chartColors, primary, errorColor]);

  const { validData, error: validationError } = useMemo(() => {
    if (!Array.isArray(data)) {
      return {
        validData: [],
        error: 'データの形式が正しくありません'
      };
    }

    const allValidData = data.reduce((acc, series) => {
      if (!series.data || !Array.isArray(series.data)) return acc;

      const validPoints = series.data.filter(point => 
        typeof point === 'object' &&
        point !== null &&
        'x' in point &&
        'y' in point &&
        'value' in point &&
        !isNaN(Number(point.value))
      );

      return [...acc, ...validPoints];
    }, [] as HeatMapDataPoint[]);

    if (allValidData.length === 0) {
      return {
        validData: [],
        error: 'データが見つかりません'
      };
    }

    return {
      validData: allValidData,
      error: undefined
    };
  }, [data]);

  const hasData = validData.length > 0;
  const error = propError || validationError;

  const { minValue, maxValue, uniqueValues } = useMemo(() => {
    if (!hasData) return { minValue: 0, maxValue: 0, uniqueValues: new Set() };
    
    const values = validData.map(d => Number(d.value));
    return {
      minValue: Math.min(...values),
      maxValue: Math.max(...values),
      uniqueValues: new Set(values)
    };
  }, [validData, hasData]);

  const colorScale = useMemo(() => {
    if (!hasData) return [];
    const steps = uniqueValues.size || 10;
    return chartUtils.generateGradient(defaultColors, steps);
  }, [defaultColors, uniqueValues.size, hasData]);

  const getColorForValue = (value: number) => {
    if (!hasData) return defaultColors[0];
    const normalizedValue = (value - minValue) / (maxValue - minValue);
    const colorIndex = Math.floor(normalizedValue * (colorScale.length - 1));
    return colorScale[Math.max(0, Math.min(colorScale.length - 1, colorIndex))];
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
          <ScatterChart
            margin={{ top: theme.spacing.chart, right: theme.spacing.chart, bottom: theme.spacing.chart, left: theme.spacing.chart }}
          >
            <XAxis
              dataKey="x"
              type="category"
              stroke={text}
              fontSize={fontSize.label}
              tickFormatter={xAxisFormatter}
            />
            <YAxis
              dataKey="y"
              type="category"
              stroke={text}
              fontSize={fontSize.label}
              tickFormatter={yAxisFormatter}
            />
            <ZAxis
              dataKey="value"
              type="number"
              range={[500, 500]}
            />
            <Tooltip
              content={(props: RechartsTooltipProps<number, string>) => {
                const { active, payload } = props;
                if (!active || !payload || !payload.length) return null;

                const data = payload[0].payload;
                const formattedValue = tooltipFormatter
                  ? tooltipFormatter(data.value, `${data.x}, ${data.y}`, { value: data.value, name: `${data.x}, ${data.y}`, dataKey: 'value', payload: data })
                  : chartUtils.formatValue(data.value);

                return (
                  <div className="custom-tooltip">
                    <p>{`${data.x}, ${data.y}: ${formattedValue}`}</p>
                  </div>
                );
              }}
              contentStyle={chartUtils.getTooltipStyle(theme)}
            />
            <Scatter
              data={validData}
              isAnimationActive={!isLoading}
            >
              {validData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={getColorForValue(entry.value)}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
};
