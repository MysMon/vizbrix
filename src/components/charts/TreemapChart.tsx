import { FC, useMemo } from 'react';
import {
  Treemap,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { ChartContainer } from '../ChartContainer';
import { TreemapChartProps, TreemapDataPoint } from '../../types/charts';
import { TooltipProps as RechartsTooltipProps } from 'recharts';
import { useTheme } from '../../theme/ThemeProvider';
import { chartUtils } from '../../utils/chartUtils';

interface CustomContentProps {
  root: TreemapDataPoint;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  value: number;
}

export const TreemapChart: FC<TreemapChartProps> = ({
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
  } = theme;

  const { validData, error: validationError } = useMemo(() => 
    chartUtils.validateData<TreemapDataPoint>(
      data,
      ['name', 'value'],
      ['value']
    ),
  [data]);

  const hasData = validData.length > 0;
  const error = propError || validationError;

  const colorScale = useMemo(() => {
    if (!hasData) return [];
    const defaultColors = chartColors || [primary, secondary, success, warning];
    const maxDepth = Math.max(...validData.map((item: TreemapDataPoint) => 
      item.children ? 2 : 1
    ));
    return chartUtils.generateGradient(defaultColors, maxDepth * 3);
  }, [validData, hasData, chartColors, primary, secondary, success, warning]);

  const renderCustomContent = (props: CustomContentProps) => {
    const { depth, x, y, width, height, name, value } = props;
    const formattedValue = chartUtils.formatValue(value);
    const isRoot = depth === 1;
    const fontSize = isRoot ? theme.typography.fontSize.value : theme.typography.fontSize.label;

    if (width < 50 || height < 50) return null;

    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={colorScale[depth]}
          stroke={theme.colors.background}
          strokeWidth={2}
        />
        <text
          x={x + width / 2}
          y={y + height / 2 - (isRoot ? 12 : 8)}
          textAnchor="middle"
          fill={text}
          fontSize={fontSize}
        >
          {name}
        </text>
        <text
          x={x + width / 2}
          y={y + height / 2 + (isRoot ? 12 : 8)}
          textAnchor="middle"
          fill={text}
          fontSize={fontSize}
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
          <Treemap
            data={validData}
            dataKey="value"
            ratio={4/3}
            stroke={theme.colors.background}
            content={renderCustomContent}
            isAnimationActive={!isLoading}
          >
            <Tooltip
              content={(props: RechartsTooltipProps<number, string>) => {
                const { active, payload } = props;
                if (!active || !payload || !payload.length) return null;

                const data = payload[0].payload as TreemapDataPoint;
                const formattedValue = tooltipFormatter
                  ? tooltipFormatter(data.value, data.name, { value: data.value, name: data.name, dataKey: 'value', payload: data })
                  : chartUtils.formatValue(data.value);

                return (
                  <div className="custom-tooltip">
                    <p>{`${data.name}: ${formattedValue}`}</p>
                    {data.children && <p style={{ opacity: 0.7 }}>{`子要素数: ${data.children.length}`}</p>}
                  </div>
                );
              }}
              contentStyle={chartUtils.getTooltipStyle(theme)}
            />
          </Treemap>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
};
