import { FC, useMemo } from 'react';
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { ChartContainer } from '../ChartContainer';
import { PieChartProps } from '../../types/charts';
import { useTheme } from '../../theme/ThemeProvider';
import { chartUtils } from '../../utils/chartUtils';

interface CustomLabelProps {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
}

export const PieChart: FC<PieChartProps> = ({
  data = [],
  width,
  height,
  className,
  style,
  config: {
    nameKey,
    valueKey,
    title,
    tooltipFormatter,
    chartColors,
    showLegend = false,
    innerRadius = 0,
    outerRadius = '80%',
    labelLine = true,
    error: propError,
    isLoading,
  }
}) => {
  const theme = useTheme();
  const {
    colors: { primary, secondary, success, warning, text },
    typography: { fontSize }
  } = theme;

  const defaultColors = chartColors || [primary, secondary, success, warning];

  const { validData, error: validationError } = useMemo(() => 
    chartUtils.validateData(
      data,
      [nameKey, valueKey],
      [valueKey]
    ),
  [data, nameKey, valueKey]);

  const hasData = validData.length > 0;
  const error = propError || validationError;

  const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: CustomLabelProps) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return (
      <text
        x={x}
        y={y}
        fill={text}
        fontSize={fontSize.label}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {`${(percent * 100).toFixed(0)}%`}
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
          <RechartsPieChart
            margin={{ top: theme.spacing.chart, right: theme.spacing.chart, bottom: theme.spacing.chart, left: theme.spacing.chart }}
          >
            <Pie
              data={validData}
              dataKey={valueKey}
              nameKey={nameKey}
              cx="50%"
              cy="50%"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              labelLine={labelLine}
              label={renderCustomizedLabel}
              isAnimationActive={!isLoading}
            >
              {validData.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={defaultColors[index % defaultColors.length]}
                />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;

                const data = payload[0].payload;
                const formattedValue = tooltipFormatter
                  ? tooltipFormatter(data.value, data.name, { value: data.value, name: data.name, dataKey: valueKey, payload: data })
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
          </RechartsPieChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
};
