import { Theme } from '../types/theme';

interface ValidationResult<T> {
  validData: T[];
  error?: string;
}

interface DomainOptions {
  padding?: number;
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
}; 