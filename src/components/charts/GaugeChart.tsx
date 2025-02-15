import { FC, useMemo } from 'react';
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import { ChartContainer } from '../ChartContainer';
import { GaugeChartProps } from '../../types/charts';
import { useTheme } from '../../theme/ThemeProvider';
import { chartUtils } from '../../utils/chartUtils';

interface CustomLabelProps {
  viewBox: {
    cx: number;
    cy: number;
  };
  value: number;
}

export const GaugeChart: FC<GaugeChartProps> = ({
  width,
  height,
  className,
  style,
  config: {
    value,
    min = 0,
    max = 100,
    title,
    chartColors,
    showValue = true,
    error: propError,
    isLoading,
  }
}) => {
  const theme = useTheme();
  const {
    colors: { primary, error: errorColor, text },
    typography: { fontSize }
  } = theme;

  const defaultColors = chartColors || [primary, errorColor];

  const validationError = useMemo(() => {
    if (typeof value !== 'number' || isNaN(value)) {
      return '値が無効です';
    }
    if (value < min || value > max) {
      return `値は${min}から${max}の間である必要があります`;
    }
    return undefined;
  }, [value, min, max]);

  const error = propError || validationError;
  const hasError = Boolean(error);

  const gaugeData = useMemo(() => {
    const percentage = ((value - min) / (max - min)) * 100;
    return [
      { name: 'value', value: percentage },
      { name: 'empty', value: 100 - percentage }
    ];
  }, [value, min, max]);

  const renderCustomLabel = ({ viewBox: { cx, cy } }: CustomLabelProps) => {
    const formattedValue = chartUtils.formatValue(value);
    return (
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fill={text}
        fontSize={fontSize.value}
      >
        {showValue ? formattedValue : ''}
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
      hasError={hasError}
      error={error}
      isLoading={isLoading}
    >
      {!hasError && (
        <ResponsiveContainer width="100%" height="100%">
          <RechartsPieChart
            margin={{ top: theme.spacing.chart, right: theme.spacing.chart, bottom: theme.spacing.chart, left: theme.spacing.chart }}
          >
            <Pie
              data={gaugeData}
              dataKey="value"
              startAngle={180}
              endAngle={0}
              innerRadius="80%"
              outerRadius="100%"
              cornerRadius={theme.borderRadius.small}
              paddingAngle={0}
              label={renderCustomLabel}
              labelLine={false}
              isAnimationActive={!isLoading}
            >
              {gaugeData.map((_entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={defaultColors[index % defaultColors.length]}
                />
              ))}
            </Pie>
          </RechartsPieChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
};
