import { FC, useMemo } from 'react';
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
  BaseChartProps,
  HeatMapSeries,
  SankeyChartData,
  XYDataPoint,
  NameValueDataPoint,
  TreemapDataPoint,
  CandlestickDataPoint,
  ComposedDataPoint,
  RadarDataPoint,
  LineChartConfig,
  BarChartConfig,
  PieChartConfig,
  ComposedChartConfig,
  AreaChartConfig,
  ScatterChartConfig,
  RadarChartConfig,
  TreemapChartConfig,
  FunnelChartConfig,
  CandlestickChartConfig,
  SankeyChartConfig,
  GaugeChartConfig,
  GaugeChartData
} from '../../types/charts';
import { BaseChart } from './BaseChart';

/**
 * チャートファクトリーコンポーネント
 * 設定に基づいて適切なチャートコンポーネントを生成します
 */
interface ChartFactoryProps extends BaseChartProps {
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

  // ゲージチャート用のデータを作成する関数
  const createGaugeData = (value: number): GaugeChartData[] => {
    return [{ name: 'value', value }];
  };

  // 設定とデータの検証を行い、適切なチャートコンポーネントを返す
  const chartComponent = useMemo(() => {
    if (!config) {
      return (
        <BaseChart
          {...commonProps}
          hasError={true}
          error="設定が見つかりません"
        >
          {null}
        </BaseChart>
      );
    }

    // データの有無を簡易チェック（詳細検証は各チャートコンポーネントで行う）
    const hasData = config.type === 'gauge' 
      ? config.type === 'gauge' && 'value' in config && typeof config.value === 'number' && !isNaN(config.value)
      : config.data && Array.isArray(config.data) && config.data.length > 0;

    if (!hasData) {
      const errorMessage = config.type === 'gauge' 
        ? "ゲージチャートの値が無効です" 
        : "データが見つかりません";
        
      return (
        <BaseChart
          {...commonProps}
          hasError={true}
          error={errorMessage}
        >
          {null}
        </BaseChart>
      );
    }

    // チャートタイプに応じたコンポーネントの選択
    switch (config.type) {
      case 'line': {
        return <LineChart 
          {...commonProps} 
          data={config.data as XYDataPoint[]} 
          config={config as LineChartConfig} 
        />;
      }
      case 'bar': {
        return <BarChart 
          {...commonProps} 
          data={config.data as XYDataPoint[]} 
          config={config as BarChartConfig} 
        />;
      }
      case 'pie': {
        return <PieChart 
          {...commonProps} 
          data={config.data as NameValueDataPoint[]} 
          config={config as PieChartConfig} 
        />;
      }
      case 'composed': {
        // 複合チャートは複雑な型のためunknownを経由する
        return <ComposedChart 
          {...commonProps} 
          data={config.data as ComposedDataPoint[]} 
          config={config as unknown as ComposedChartConfig} 
        />;
      }
      case 'area': {
        return <AreaChart 
          {...commonProps} 
          data={config.data as XYDataPoint[]} 
          config={config as AreaChartConfig} 
        />;
      }
      case 'scatter': {
        return <ScatterChart 
          {...commonProps} 
          data={config.data as XYDataPoint[]} 
          config={config as ScatterChartConfig} 
        />;
      }
      case 'radar': {
        // Radarは複雑な型のためunknownを経由
        return <RadarChart 
          {...commonProps} 
          data={config.data as RadarDataPoint[]} 
          config={config as unknown as RadarChartConfig} 
        />;
      }
      case 'treemap': {
        return <TreemapChart 
          {...commonProps} 
          data={config.data as TreemapDataPoint[]} 
          config={config as TreemapChartConfig} 
        />;
      }
      case 'funnel': {
        return <FunnelChart 
          {...commonProps} 
          data={config.data as NameValueDataPoint[]} 
          config={config as FunnelChartConfig} 
        />;
      }
      case 'candlestick': {
        return <CandlestickChart 
          {...commonProps} 
          data={config.data as CandlestickDataPoint[]} 
          config={config as CandlestickChartConfig} 
        />;
      }
      case 'sankey': {
        // サンキーチャートのデータは、配列の最初の要素を使用
        if (config.data && Array.isArray(config.data) && config.data.length > 0) {
          return (
            <SankeyChart 
              {...commonProps} 
              data={config.data[0] as SankeyChartData} 
              config={config as SankeyChartConfig} 
            />
          );
        }
        return (
          <BaseChart
            {...commonProps}
            hasError={true}
            error="サンキーチャートのデータが無効です"
          >
            {null}
          </BaseChart>
        );
      }
      case 'heatmap': {
        return (
          <HeatMapChart 
            {...commonProps} 
            data={config.data as HeatMapSeries[]} 
            config={config} 
          />
        );
      }
      case 'gauge': {
        // ゲージチャートは特別な処理が必要なので、型安全のためにプロパティチェック
        if ('value' in config && typeof config.value === 'number' && !isNaN(config.value)) {
          // 安全に型変換
          const gaugeValue = config.value;
          return (
            <GaugeChart 
              {...commonProps} 
              data={createGaugeData(gaugeValue)}
              config={config as unknown as GaugeChartConfig} 
            />
          );
        }
        return (
          <BaseChart
            {...commonProps}
            hasError={true}
            error="ゲージチャートの値が無効です"
          >
            {null}
          </BaseChart>
        );
      }
      default:
        return (
          <BaseChart
            {...commonProps}
            hasError={true}
            error="サポートされていないチャートタイプです"
          >
            {null}
          </BaseChart>
        );
    }
  }, [config, commonProps]); // createGaugeDataはメモ内部で定義のため依存配列に含めない

  return chartComponent;
};
