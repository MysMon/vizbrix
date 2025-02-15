import { FC, useMemo } from 'react';
import {
  Sankey,
  ResponsiveContainer,
  Tooltip,
  Layer,
  Rectangle,
} from 'recharts';
import { TooltipProps as RechartsTooltipProps } from 'recharts';
import { ChartContainer } from '../ChartContainer';
import { SankeyChartProps, SankeyNode } from '../../types/charts';
import { useTheme } from '../../theme/ThemeProvider';
import { chartUtils } from '../../utils/chartUtils';

interface NodeProps {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  payload: SankeyNode;
}

export const SankeyChart: FC<SankeyChartProps> = ({
  data = { nodes: [], links: [] },
  width,
  height,
  className,
  style,
  config: {
    title,
    tooltipFormatter,
    chartColors,
    nodeWidth = 20,
    nodePadding = 10,
    error: propError,
    isLoading
  }
}) => {
  const theme = useTheme();
  const {
    colors: { primary, secondary, success, warning, text },
    typography: { fontSize }
  } = theme;

  const defaultColors = useMemo(() => chartColors || [primary, secondary, success, warning], [chartColors, primary, secondary, success, warning]);

  const { validData, error: validationError } = useMemo(() => {
    if (!data || !data.nodes || !data.links || !Array.isArray(data.nodes) || !Array.isArray(data.links)) {
      return {
        validData: { nodes: [], links: [] },
        error: 'データの形式が正しくありません'
      };
    }

    const validNodes = data.nodes.filter(node => 
      typeof node === 'object' && 
      node !== null && 
      'name' in node
    );

    const validLinks = data.links.filter(link => 
      typeof link === 'object' && 
      link !== null && 
      'source' in link && 
      'target' in link && 
      'value' in link &&
      !isNaN(Number(link.value))
    );

    if (validNodes.length === 0 || validLinks.length === 0) {
      return {
        validData: { nodes: [], links: [] },
        error: 'データが見つかりません'
      };
    }

    return {
      validData: { nodes: validNodes, links: validLinks },
      error: undefined
    };
  }, [data]);

  const hasData = validData.nodes.length > 0 && validData.links.length > 0;
  const error = propError || validationError;

  const colorScale = useMemo(() => {
    if (!hasData) return [];
    return chartUtils.generateGradient(defaultColors, validData.nodes.length);
  }, [validData.nodes.length, defaultColors, hasData]);

  const renderNode = (props: NodeProps) => {
    const { x, y, width, height, index, payload } = props;
    const fill = colorScale[index % colorScale.length];

    return (
      <Layer key={`node-${index}`}>
        <Rectangle
          x={x}
          y={y}
          width={width}
          height={height}
          fill={fill}
          fillOpacity={0.9}
        />
        <text
          x={x + width / 2}
          y={y + height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={text}
          fontSize={fontSize.label}
        >
          {payload.name}
        </text>
      </Layer>
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
          <Sankey
            data={validData}
            node={renderNode}
            nodeWidth={nodeWidth}
            nodePadding={nodePadding}
            margin={{ top: theme.spacing.chart, right: theme.spacing.chart, bottom: theme.spacing.chart, left: theme.spacing.chart }}
            link={{ stroke: theme.colors.grid, strokeOpacity: 0.2 }}
          >
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
          </Sankey>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
};
