import { GroupedData } from './types';

interface TransformConfig<T> {
  groupBy?: keyof T;
  sortBy?: keyof T;
  sortDirection?: 'asc' | 'desc';
  filter?: (item: T) => boolean;
}

interface AggregateConfig {
  maxDataPoints?: number;
  aggregation?: 'sum' | 'average' | 'max' | 'min';
}

export const dataUtils = {
  transformData<T extends Record<string, unknown>>(
    data: T[],
    config: TransformConfig<T>
  ): T[] | GroupedData<T>[] {
    if (!Array.isArray(data)) {
      return [];
    }

    let result = [...data];

    if (config.filter) {
      result = result.filter(config.filter);
    }

    if (config.groupBy) {
      const groups = new Map<string, T[]>();
      
      result.forEach(item => {
        const key = String(item[config.groupBy!]);
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)!.push(item);
      });

      const groupedResult = Array.from(groups.entries()).map(([key, items]) => {
        const grouped: GroupedData<T> = {
          items,
          [config.groupBy!]: key
        };
        return grouped;
      });

      if (config.sortBy) {
        groupedResult.sort((a, b) => {
          const aValue = Number(a.items[0][config.sortBy!]);
          const bValue = Number(b.items[0][config.sortBy!]);
          return config.sortDirection === 'desc' ? bValue - aValue : aValue - bValue;
        });
      }

      return groupedResult;
    }

    if (config.sortBy) {
      result.sort((a, b) => {
        const aValue = Number(a[config.sortBy!]);
        const bValue = Number(b[config.sortBy!]);
        return config.sortDirection === 'desc' ? bValue - aValue : aValue - bValue;
      });
    }

    return result;
  },

  aggregateData<T extends Record<string, unknown>>(
    data: T[],
    key: keyof T,
    config: AggregateConfig = {}
  ): T[] {
    if (!Array.isArray(data) || data.length === 0) {
      return [];
    }

    let result = [...data];

    if (config.maxDataPoints && config.maxDataPoints < result.length) {
      const step = Math.ceil(result.length / config.maxDataPoints);
      result = result.filter((_, index) => index % step === 0);
    }

    if (config.aggregation) {
      const values = result.map(item => Number(item[key]));
      let aggregatedValue: number;

      switch (config.aggregation) {
        case 'sum':
          aggregatedValue = values.reduce((sum, val) => sum + val, 0);
          break;
        case 'average':
          aggregatedValue = values.reduce((sum, val) => sum + val, 0) / values.length;
          break;
        case 'max':
          aggregatedValue = Math.max(...values);
          break;
        case 'min':
          aggregatedValue = Math.min(...values);
          break;
        default:
          return result;
      }

      result = [{
        ...result[0],
        [key]: aggregatedValue
      }] as T[];
    }

    return result;
  },

  formatValue: (value: number, options?: {
    locale?: string;
    style?: 'decimal' | 'currency' | 'percent';
    currency?: string;
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  }): string => {
    const {
      locale = 'ja-JP',
      style = 'decimal',
      currency = 'JPY',
      minimumFractionDigits = 0,
      maximumFractionDigits = 0,
    } = options || {};

    return new Intl.NumberFormat(locale, {
      style,
      currency,
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(value);
  },

  sanitizeData: <T extends Record<string, unknown>>(
    data: T[],
    schema: Record<keyof T, 'string' | 'number' | 'boolean'>
  ): T[] => {
    return data.map(item => {
      const sanitized = { ...item } as Record<string, unknown>;
      Object.entries(schema).forEach(([key, type]) => {
        if (type === 'number') {
          sanitized[key] = Number(item[key]) || 0;
        } else if (type === 'boolean') {
          sanitized[key] = Boolean(item[key]);
        } else {
          sanitized[key] = String(item[key]);
        }
      });
      return sanitized as T;
    });
  },
}; 