import { FC, useMemo } from 'react';
import {
  FunnelChart as RechartsFunnelChart,
  Funnel,
  Tooltip,
  LabelList,
  ResponsiveContainer,
} from 'recharts';
import { ChartContainer } from '../ChartContainer';
import { FunnelChartProps } from '../../types/charts';
import { TooltipProps as RechartsTooltipProps } from 'recharts';
import { useTheme } from '../../theme/ThemeProvider';
import { chartUtils } from '../../utils/chartUtils';

interface CustomLabelProps {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  value?: number | string;
  name?: string;
}

export const FunnelChart: FC<FunnelChartProps> = ({
  data = [],
  width,
  height,
  className,
  style,
  config: {
    title,
    tooltipFormatter,
    chartColors,
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
      ['name', 'value'],
      ['value']
    ),
  [data]);

  const hasData = validData.length > 0;
  const error = propError || validationError;

  const renderCustomLabel = (props: CustomLabelProps) => {
    const { x, y, width, height, value, name } = props;
    const xPos = typeof x === 'string' ? parseFloat(x) : (x || 0);
    const yPos = typeof y === 'string' ? parseFloat(y) : (y || 0);
    const w = typeof width === 'string' ? parseFloat(width) : (width || 0);
    const h = typeof height === 'string' ? parseFloat(height) : (height || 0);
    const formattedValue = chartUtils.formatValue(Number(value) || 0);

    return (
      <g>
        <text
          x={xPos + w / 2}
          y={yPos + h / 2 - 12}
          textAnchor="middle"
          fill={text}
          fontSize={fontSize.label}
        >
          {name}
        </text>
        <text
          x={xPos + w / 2}
          y={yPos + h / 2 + 12}
          textAnchor="middle"
          fill={text}
          fontSize={fontSize.value}
        >
          {formattedValue}
        </text>
      </g>
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
          <RechartsFunnelChart
            margin={{ top: theme.spacing.chart, right: theme.spacing.chart, bottom: theme.spacing.chart, left: theme.spacing.chart }}
          >
              <Funnel
                data={validData}
                dataKey="value"
                nameKey="name"
                isAnimationActive={!isLoading}
                fill={defaultColors[0]}
              >
              <LabelList
                position="center"
                content={renderCustomLabel}
              />
              {validData.map((entry, index) => (
                <Funnel
                  key={`funnel-${index}`}
                  data={[entry]}
                  dataKey="value"
                  fill={defaultColors[index % defaultColors.length]}
                />
              ))}
              <Tooltip
                content={(props: RechartsTooltipProps<number, string>) => {
                  const { active, payload } = props;
                  if (!active || !payload || !payload.length) return null;

                  const data = payload[0].payload;
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
            </Funnel>
          </RechartsFunnelChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
};
