import { Theme } from '../types/theme';
import { 
  TooltipProps, 
  TooltipPayload, 
  ChartDataPoint,
  XYDataPoint,
  NameValueDataPoint,
  RadarDataPoint,
  CandlestickDataPoint,
  SankeyChartData,
  HeatMapSeries
} from '../types/charts';

interface ValidationResult<T> {
  validData: T[];
  error?: string;
}

interface DomainOptions {
  padding?: number;
}

// 標準化されたチャートデータ検証の結果
export interface ChartValidationResult {
  isValid: boolean;
  error?: string;
}

export const chartUtils = {
  validateData: <T extends Record<string, unknown>>(
    data: T[],
    requiredKeys: string[],
    numericKeys: string[] = []
  ): ValidationResult<T> => {
    if (!Array.isArray(data)) {
      return {
        validData: [],
        error: 'データが配列ではありません'
      };
    }

    if (data.length === 0) {
      return {
        validData: [],
        error: 'データが見つかりません'
      };
    }

    const validData = data.filter(item => {
      if (!item || typeof item !== 'object') {
        return false;
      }

      const hasRequiredKeys = requiredKeys.every(key => 
        key in item && item[key] !== undefined && item[key] !== null
      );

      if (!hasRequiredKeys) {
        return false;
      }

      if (numericKeys.length > 0) {
        const hasValidNumericValues = numericKeys.every(key => {
          const value = item[key];
          return typeof value === 'number' && !isNaN(value);
        });
        if (!hasValidNumericValues) {
          return false;
        }
      }

      return true;
    });

    if (validData.length === 0) {
      return {
        validData: [],
        error: 'データの形式が正しくありません'
      };
    }

    return {
      validData,
      error: undefined
    };
  },

  formatValue: (value: number, options?: Intl.NumberFormatOptions) => {
    const defaultOptions: Intl.NumberFormatOptions = {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
      ...options,
    };
    return new Intl.NumberFormat('ja-JP', defaultOptions).format(value);
  },

  calculateDomain(values: number[], options: DomainOptions = {}): [number, number] {
    if (values.length === 0) {
      return [0, 0];
    }

    const min = Math.min(...values);
    const max = Math.max(...values);

    if (min === max) {
      return [0, max];
    }

    const { padding = 0 } = options;
    const range = max - min;
    const paddedMin = min - range * padding;
    const paddedMax = max + range * padding;

    return [paddedMin, paddedMax];
  },

  interpolateColor: (color1: string, color2: string, factor: number) => {
    const hex = (x: number) => {
      const h = Math.round(x).toString(16);
      return h.length === 1 ? '0' + h : h;
    };

    const r1 = parseInt(color1.substring(1, 3), 16);
    const g1 = parseInt(color1.substring(3, 5), 16);
    const b1 = parseInt(color1.substring(5, 7), 16);

    const r2 = parseInt(color2.substring(1, 3), 16);
    const g2 = parseInt(color2.substring(3, 5), 16);
    const b2 = parseInt(color2.substring(5, 7), 16);

    const r = Math.round(r1 + (r2 - r1) * factor);
    const g = Math.round(g1 + (g2 - g1) * factor);
    const b = Math.round(b1 + (b2 - b1) * factor);

    return `#${hex(r)}${hex(g)}${hex(b)}`;
  },

  generateGradient: (colors: string[], steps: number) => {
    const gradient: string[] = [];
    const segmentLength = 1 / (colors.length - 1);
    
    for (let i = 0; i < steps; i++) {
      const position = i / (steps - 1);
      const segment = Math.min(Math.floor(position / segmentLength), colors.length - 2);
      const factor = (position - segment * segmentLength) / segmentLength;
      gradient.push(chartUtils.interpolateColor(colors[segment], colors[segment + 1], factor));
    }

    return gradient;
  },

  getTooltipStyle: (theme: Theme) => ({
    backgroundColor: theme.colors.background,
    border: `1px solid ${theme.colors.grid}`,
    borderRadius: theme.borderRadius.small,
    padding: theme.spacing.small,
    boxShadow: theme.shadows.small,
    fontSize: theme.typography.fontSize.tooltip,
    color: theme.colors.text,
  }),

  getLegendStyle: (theme: Theme) => ({
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.label,
    padding: theme.spacing.padding,
  }),

  getAxisStyle: (theme: Theme) => ({
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.label,
    stroke: theme.colors.grid,
  }),

  getAxisLabelStyle: (theme: Theme) => ({
    color: theme.colors.text,
    fontSize: theme.typography.fontSize.label,
    fontWeight: theme.typography.fontWeight.bold,
  }),

  getErrorStyle: (theme: Theme) => ({
    color: theme.colors.error,
    fontSize: theme.typography.fontSize.body,
    padding: theme.spacing.padding,
    textAlign: 'center' as const,
  }),

  // 新規追加される共通関数
  
  /**
   * 統一されたチャートデータ検証関数
   * BaseChart.validateChartDataの代替として使用
   */
  validateChartData: <T extends unknown[]>(
    data: T | undefined,
    validator?: (data: T) => boolean
  ): ChartValidationResult => {
    if (!data) {
      return { isValid: false, error: 'データが見つかりません' };
    }

    if (!Array.isArray(data)) {
      return { isValid: false, error: 'データが配列ではありません' };
    }

    if (data.length === 0) {
      return { isValid: false, error: 'データが空です' };
    }

    if (validator && !validator(data)) {
      return { isValid: false, error: 'データの形式が正しくありません' };
    }

    return { isValid: true };
  },

  /**
   * 一般的なXY型データポイントの検証
   */
  validateXYData: (data: XYDataPoint[] | undefined): ChartValidationResult => {
    return chartUtils.validateChartData(data, (items) => 
      items.every(item => item.x !== undefined && item.y !== undefined)
    );
  },

  /**
   * 名前と値のペア型データポイントの検証
   */
  validateNameValueData: (data: NameValueDataPoint[] | undefined): ChartValidationResult => {
    return chartUtils.validateChartData(data, (items) => 
      items.every(item => item.name !== undefined && item.value !== undefined)
    );
  },

  /**
   * レーダーチャートデータの検証
   */
  validateRadarData: (data: RadarDataPoint[] | undefined, nameKey: string, dataKeys: string[]): ChartValidationResult => {
    return chartUtils.validateChartData(data, (items) => 
      items.every(item => {
        if (item[nameKey] === undefined) return false;
        return dataKeys.every(key => typeof item[key] === 'number');
      })
    );
  },

  /**
   * ローソク足チャートデータの検証
   */
  validateCandlestickData: (data: CandlestickDataPoint[] | undefined): ChartValidationResult => {
    return chartUtils.validateChartData(data, (items) => 
      items.every(item => 
        item.date !== undefined &&
        item.open !== undefined &&
        item.high !== undefined &&
        item.low !== undefined &&
        item.close !== undefined
      )
    );
  },

  /**
   * サンキーチャートデータの検証
   */
  validateSankeyData: (data: SankeyChartData | undefined): ChartValidationResult => {
    if (!data || !data.nodes || !data.links) {
      return { isValid: false, error: "サンキーチャートのデータが無効です" };
    }
    
    if (data.nodes.length === 0 || data.links.length === 0) {
      return { isValid: false, error: "サンキーチャートのデータが空です" };
    }
    
    return { isValid: true };
  },

  /**
   * ヒートマップデータの検証
   */
  validateHeatMapData: (data: HeatMapSeries[] | undefined): ChartValidationResult => {
    if (!data || !Array.isArray(data) || data.length === 0) {
      return { isValid: false, error: "ヒートマップのデータが無効です" };
    }
    
    for (const series of data) {
      if (!series.data || !Array.isArray(series.data) || series.data.length === 0) {
        return { isValid: false, error: "ヒートマップのシリーズデータが無効です" };
      }
      
      for (const point of series.data) {
        if (point.x === undefined || point.y === undefined || point.value === undefined) {
          return { isValid: false, error: "ヒートマップのデータポイントが無効です" };
        }
      }
    }
    
    return { isValid: true };
  },

  /**
   * 統一されたツールチップ処理関数
   */
  formatTooltip: <T extends ChartDataPoint>(
    value: number, 
    name: string, 
    props: TooltipProps<T>,
    formatter?: (value: number, name: string, data: Record<string, unknown>) => string | number
  ): string | number => {
    if (formatter && props.payload?.[0]) {
      const item = props.payload[0] as TooltipPayload<T>;
      return formatter(
        value,
        name,
        { name, value, payload: item.payload }
      );
    }
    // 統一されたデフォルト形式
    return `${name}: ${value}`;
  },

  /**
   * カラー配列から色を取得（指定されていない場合はデフォルト色を返す）
   */
  getChartColor: (chartColors: string[] | undefined, index: number, defaultColor: string): string => {
    if (chartColors && chartColors.length > index) {
      return chartColors[index];
    }
    return defaultColor;
  },

  /**
   * カラー値をパーセンテージに応じて取得（ヒートマップなどで使用）
   */
  getColorByValue: (value: number, min: number, max: number, colorScale: string[]): string => {
    const normalizedValue = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
    const index = Math.floor(normalizedValue * (colorScale.length - 1));
    return colorScale[index];
  }
}; 