import { FC } from 'react';
import { LineChart } from './LineChart';
import { BarChart } from './BarChart';
import { PieChart } from './PieChart';
import { ComposedChart } from './ComposedChart';
import { AreaChart } from './AreaChart';
import { ScatterChart } from './ScatterChart';
import { RadarChart } from './RadarChart';
import { TreemapChart } from './TreemapChart';
import { FunnelChart } from './FunnelChart';
import { CandlestickChart } from './CandlestickChart';
import { SankeyChart } from './SankeyChart';
import { HeatMapChart } from './HeatMapChart';
import { GaugeChart } from './GaugeChart';
import type { 
  ChartConfig, 
  BaseProps,
  HeatMapSeries,
  SankeyChartData,
} from '../../types/charts';
import { ChartContainer } from '../ChartContainer';

interface ChartFactoryProps extends BaseProps {
  config: ChartConfig;
}

export const ChartFactory: FC<ChartFactoryProps> = ({
  config,
  width,
  height,
  className,
  style
}) => {
  const commonProps = {
    width,
    height,
    className,
    style,
  };

  // 特殊なケースのデータチェック
  const hasValidData = (() => {
    if (!config) return false;

    switch (config.type) {
      case 'gauge':
        return typeof config.value === 'number' && !isNaN(config.value);
      case 'sankey': {
        const sankeyData = config.data as SankeyChartData;
        return (
          sankeyData &&
          Array.isArray(sankeyData.nodes) &&
          Array.isArray(sankeyData.links) &&
          sankeyData.nodes.length > 0 &&
          sankeyData.links.length > 0
        );
      }
      case 'heatmap': {
        const heatmapData = config.data as HeatMapSeries[];
        return (
          heatmapData &&
          Array.isArray(heatmapData) &&
          heatmapData.length > 0 &&
          heatmapData.every(series => 
            series.data && 
            Array.isArray(series.data) && 
            series.data.length > 0
          )
        );
      }
      default:
        return (
          config.data &&
          Array.isArray(config.data) &&
          config.data.length > 0
        );
    }
  })();

  if (!hasValidData) {
    return (
      <ChartContainer
        {...commonProps}
        hasError={true}
        error="データが見つかりません"
      />
    );
  }

  // 型に応じたレンダリング
  switch (config.type) {
    case 'line':
      return <LineChart {...commonProps} data={config.data} config={config} />;
    case 'bar':
      return <BarChart {...commonProps} data={config.data} config={config} />;
    case 'pie':
      return <PieChart {...commonProps} data={config.data} config={config} />;
    case 'composed':
      return <ComposedChart {...commonProps} data={config.data} config={config} />;
    case 'area':
      return <AreaChart {...commonProps} data={config.data} config={config} />;
    case 'scatter':
      return <ScatterChart {...commonProps} data={config.data} config={config} />;
    case 'radar':
      return <RadarChart {...commonProps} data={config.data} config={config} />;
    case 'treemap':
      return <TreemapChart {...commonProps} data={config.data} config={config} />;
    case 'funnel':
      return <FunnelChart {...commonProps} data={config.data} config={config} />;
    case 'candlestick':
      return <CandlestickChart {...commonProps} data={config.data} config={config} />;
    case 'sankey':
      return (
        <SankeyChart 
          {...commonProps} 
          data={config.data as SankeyChartData} 
          config={config} 
        />
      );
    case 'heatmap':
      return (
        <HeatMapChart 
          {...commonProps} 
          data={config.data as HeatMapSeries[]} 
          config={config} 
        />
      );
    case 'gauge':
      return <GaugeChart {...commonProps} config={config} />;
    default:
      return (
        <ChartContainer
          {...commonProps}
          hasError={true}
          error="サポートされていないチャートタイプです"
        />
      );
  }
};
