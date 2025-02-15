import { FC, useMemo } from 'react';
import {
  RadarChart as RechartsRadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { ChartContainer } from '../ChartContainer';
import { RadarChartProps } from '../../types/charts';
import { TooltipProps as RechartsTooltipProps } from 'recharts';
import { useTheme } from '../../theme/ThemeProvider';
import { chartUtils } from '../../utils/chartUtils';

export const RadarChart: FC<RadarChartProps> = ({
  data = [],
  width,
  height,
  className,
  style,
  config: {
    dataKeys,
    nameKey,
    title,
    tooltipFormatter,
    chartColors,
    fillOpacity = 0.6,
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
    const requiredKeys = [nameKey, ...dataKeys];
    const numericKeys = dataKeys;

    return chartUtils.validateData(
      data,
      requiredKeys,
      numericKeys
    );
  }, [data, nameKey, dataKeys]);

  const hasData = validData.length > 0;
  const error = propError || validationError;

  const domain = useMemo(() => {
    if (!hasData) return [0, 0];

    const allValues = validData.reduce((acc, item) => {
      dataKeys.forEach(key => {
        acc.push(Number(item[key]));
      });
      return acc;
    }, [] as number[]);

    return chartUtils.calculateDomain(allValues, { padding: 0.1 });
  }, [validData, dataKeys, hasData]);

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
          <RechartsRadarChart
            data={validData}
            margin={{ top: theme.spacing.chart, right: theme.spacing.chart, bottom: theme.spacing.chart, left: theme.spacing.chart }}
          >
            <PolarGrid 
              stroke={grid}
            />
            <PolarAngleAxis
              dataKey={nameKey}
              stroke={text}
              fontSize={fontSize.label}
              tickLine={false}
            />
            <PolarRadiusAxis
              angle={90}
              domain={domain}
              stroke={text}
              fontSize={fontSize.label}
            />
            {dataKeys.map((key, index) => (
              <Radar
                key={key}
                name={key}
                dataKey={key}
                stroke={defaultColors[index % defaultColors.length]}
                fill={defaultColors[index % defaultColors.length]}
                fillOpacity={fillOpacity}
                isAnimationActive={!isLoading}
              />
            ))}
            <Tooltip
              content={(props: RechartsTooltipProps<number, string>) => {
                const { active, payload } = props;
                if (!active || !payload || !payload.length) return null;

                return (
                  <div className="custom-tooltip">
                    <p style={{ margin: '0 0 5px' }}>{payload[0].payload[nameKey]}</p>
                    {payload.map((entry, index) => {
                      const value = Number(entry.value);
                      const dataKey = String(entry.dataKey);
                      const name = entry.name || dataKey;
                      const formattedValue = tooltipFormatter
                        ? tooltipFormatter(value, name, { value, name, dataKey, payload: entry.payload })
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
          </RechartsRadarChart>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
};
