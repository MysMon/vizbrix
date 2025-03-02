import { useMemo, useCallback } from 'react';
import { TooltipProps, ChartDataPoint } from '../types/charts';
import { chartUtils } from '../utils/chartUtils';

interface ThemeColors {
  primary: string;
  secondary: string;
  error: string;
  warning: string;
  info: string;
  success: string;
  series: string[]; // Series color palette
}

interface TooltipStyles {
  contentStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  margin: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

interface ChartTheme {
  colors: ThemeColors;
  tooltip: TooltipStyles;
  formatTooltip: <T extends ChartDataPoint>(
    value: number,
    name: string,
    props: TooltipProps<T>,
    formatter?: (value: number, name: string, data: Record<string, unknown>) => string | number
  ) => string | number;
  getColor: (index: number, customColors?: string[]) => string;
}

export const useChartTheme = (): ChartTheme => {
  const colors: ThemeColors = useMemo(
    () => ({
      primary: '#1976d2',
      secondary: '#dc004e',
      error: '#f44336',
      warning: '#ff9800',
      info: '#2196f3',
      success: '#4caf50',
      series: [
        '#1976d2', // primary
        '#dc004e', // secondary
        '#4caf50', // success
        '#ff9800', // warning
        '#2196f3', // info
        '#f44336', // error
        '#9c27b0', // purple
        '#795548', // brown
        '#607d8b', // blue-grey
        '#009688', // teal
      ],
    }),
    []
  );

  const tooltip: TooltipStyles = useMemo(
    () => ({
      contentStyle: {
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        border: '1px solid #ccc',
        padding: '10px',
        borderRadius: '4px',
      },
      labelStyle: {
        color: '#666',
        margin: 0,
      },
      margin: {
        top: 5,
        right: 5,
        bottom: 5,
        left: 5,
      },
    }),
    []
  );

  // Unified tooltip formatter function
  const formatTooltip = useCallback(<T extends ChartDataPoint>(
    value: number,
    name: string,
    props: TooltipProps<T>,
    formatter?: (value: number, name: string, data: Record<string, unknown>) => string | number
  ): string | number => {
    return chartUtils.formatTooltip(value, name, props, formatter);
  }, []);

  // Get color from theme based on index
  const getColor = useCallback((index: number, customColors?: string[]): string => {
    const colorArray = customColors || colors.series;
    return colorArray[index % colorArray.length];
  }, [colors.series]);

  return { colors, tooltip, formatTooltip, getColor };
};
