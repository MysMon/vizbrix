import { FC, useMemo } from 'react';
import {
  ScatterChart as RechartsScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { ChartContainer } from '../ChartContainer';
import { ScatterChartProps } from '../../types/charts';
import { useTheme } from '../../theme/ThemeProvider';
import { chartUtils } from '../../utils/chartUtils';

interface CustomLabelProps {
  x: number;
  y: number;
  value: string | number;
}

export const ScatterChart: FC<ScatterChartProps> = ({
  data = [],
  width,
  height,
  className,
  style,
  config: {
    xAxisKey,
    yAxisKey,
    zAxisKey,
    title,
    tooltipFormatter,
    chartColors,
    dotSize = 60,
    showLabels = false,
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

    if (zAxisKey) {
      requiredKeys.push(zAxisKey);
      numericKeys.push(zAxisKey);
    }

    return chartUtils.validateData(
      data,
      requiredKeys,
      numericKeys
    );
  }, [data, xAxisKey, yAxisKey, zAxisKey]);

  const hasData = validData.length > 0;
  const error = propError || validationError;

  const { yDomain, zDomain } = useMemo(() => {
    if (!hasData) return { yDomain: [0, 0], zDomain: [0, 0] };

    const yValues = validData.map(item => Number(item[yAxisKey]));
    const [yMin, yMax] = chartUtils.calculateDomain(yValues, { padding: 0.1 });

    let zMin = 0, zMax = 0;
    if (zAxisKey) {
      const zValues = validData.map(item => Number(item[zAxisKey]));
      [zMin, zMax] = chartUtils.calculateDomain(zValues, { padding: 0.1 });
    }

    return {
      yDomain: [yMin, yMax],
      zDomain: zAxisKey ? [zMin, zMax] : [dotSize, dotSize]
    };
  }, [validData, yAxisKey, zAxisKey, dotSize, hasData]);

  const renderCustomLabel = (props: CustomLabelProps) => {
    const { x, y, value } = props;
    return (
      <text
        x={x}
        y={y - 10}
        textAnchor="middle"
        fill={text}
        fontSize={fontSize.label}
      >
        {value}
      </text>
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
          <RechartsScatterChart
            margin={{ top: theme.spacing.chart, right: theme.spacing.chart, bottom: theme.spacing.chart, left: theme.spacing.chart }}
          >
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke={grid} 
            />
            <XAxis
              dataKey={xAxisKey}
              type="category"
              stroke={text}
              fontSize={fontSize.label}
            />
            <YAxis
              type="number"
              domain={yDomain}
              stroke={text}
              fontSize={fontSize.label}
            />
            {zAxisKey && (
              <ZAxis
                dataKey={zAxisKey}
                type="number"
                domain={zDomain}
                range={[dotSize / 2, dotSize]}
              />
            )}
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;

                const data = payload[0].payload;
                const formattedValue = tooltipFormatter
                  ? tooltipFormatter(data[yAxisKey], data[xAxisKey], { value: data[yAxisKey], name: data[xAxisKey], dataKey: yAxisKey, payload: data })
                  : chartUtils.formatValue(data[yAxisKey]);

                return (
                  <div className="custom-tooltip">
                    <p>{`${data[xAxisKey]}: ${formattedValue}`}</p>
                    {zAxisKey && (
                      <p>{`${zAxisKey}: ${chartUtils.formatValue(data[zAxisKey])}`}</p>
                    )}
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
            <Scatter
              data={validData}
              fill={defaultColors[0]}
              label={showLabels ? renderCustomLabel : undefined}
              isAnimationActive={!isLoading}
            />
          </RechartsScatterChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
};
