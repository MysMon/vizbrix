import { FC, useMemo } from 'react';
import {
  ComposedChart as RechartsComposedChart,
  Line,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { ChartContainer } from '../ChartContainer';
import { ComposedChartProps } from '../../types/charts';
import { TooltipProps as RechartsTooltipProps } from 'recharts';
import { useTheme } from '../../theme/ThemeProvider';
import { chartUtils } from '../../utils/chartUtils';

export const ComposedChart: FC<ComposedChartProps> = ({
  data = [],
  width,
  height,
  className,
  style,
  config: {
    xAxisKey,
    yAxisKey,
    series,
    title,
    tooltipFormatter,
    chartColors,
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
    const dataKeys = series.map(s => s.dataKey);
    const requiredKeys = [xAxisKey, yAxisKey, ...dataKeys];
    const numericKeys = [yAxisKey, ...dataKeys];

    return chartUtils.validateData(
      data,
      requiredKeys,
      numericKeys
    );
  }, [data, xAxisKey, yAxisKey, series]);

  const hasData = validData.length > 0;
  const error = propError || validationError;

  const yDomain = useMemo(() => {
    if (!hasData) return [0, 0];

    const allValues = validData.reduce((acc, item) => {
      series.forEach(s => {
        acc.push(Number(item[s.dataKey]));
      });
      return acc;
    }, [] as number[]);

    return chartUtils.calculateDomain(allValues, { padding: 0.1 });
  }, [validData, series, hasData]);

  const renderChartComponent = (seriesItem: typeof series[0], index: number) => {
    const color = defaultColors[index % defaultColors.length];
    const commonProps = {
      key: seriesItem.dataKey,
      name: seriesItem.name || seriesItem.dataKey,
      dataKey: seriesItem.dataKey,
      stroke: color,
      fill: color,
      isAnimationActive: !isLoading,
    };

    switch (seriesItem.type) {
      case 'line':
        return (
          <Line
            {...commonProps}
            dot={false}
            strokeWidth={2}
          />
        );
      case 'bar':
        return (
          <Bar
            {...commonProps}
            fillOpacity={0.8}
          />
        );
      case 'area':
        return (
          <Area
            {...commonProps}
            fillOpacity={0.3}
            strokeWidth={2}
          />
        );
      default:
        return null;
    }
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
          <RechartsComposedChart
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
              content={(props: RechartsTooltipProps<number, string>) => {
                const { active, payload, label } = props;
                if (!active || !payload || !payload.length) return null;

                return (
                  <div className="custom-tooltip">
                    <p style={{ margin: '0 0 5px' }}>{label}</p>
                    {payload.map((entry, index) => {
                      const value = Number(entry.value);
                      const name = entry.name || String(entry.dataKey);
                      const formattedValue = tooltipFormatter
                        ? tooltipFormatter(value, name, { value, name, dataKey: String(entry.dataKey), payload: entry.payload })
                        : chartUtils.formatValue(value);

                      return (
                        <p key={index} style={{ color: entry.color, margin: '3px 0' }}>
                          {`${name}: ${formattedValue}`}
                        </p>
                      );
                    })}
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
            {series.map((item, index) => renderChartComponent(item, index))}
          </RechartsComposedChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
};
