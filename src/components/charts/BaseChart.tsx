import { FC, ReactNode, useMemo } from 'react';
import { BaseChartProps } from '../../types/charts';
import { ChartContainer } from '../ChartContainer';
import { chartUtils, ChartValidationResult } from '../../utils/chartUtils';

interface BaseChartComponentProps extends BaseChartProps {
  title?: string;
  error?: string;
  isLoading?: boolean;
  hasError?: boolean;
  children: ReactNode;
}

/**
 * 全てのチャートコンポーネントの基本となるコンポーネント
 * チャートのコンテナとエラーハンドリングを提供します
 */
export const BaseChart: FC<BaseChartComponentProps> = ({
  title,
  width,
  height,
  style,
  className,
  error,
  isLoading,
  hasError,
  children
}) => {
  // コンテナのプロパティをメモ化
  const containerProps = useMemo(() => ({
    title,
    width,
    height,
    style,
    className,
    error,
    isLoading,
    hasError
  }), [title, width, height, style, className, error, isLoading, hasError]);

  return (
    <ChartContainer {...containerProps}>
      {children}
    </ChartContainer>
  );
};

/**
 * Utility function to validate chart data
 * @deprecated Use chartUtils.validateChartData instead
 */
export const validateChartData = <T extends unknown[]>(
  data: T | undefined,
  validator?: (data: T) => boolean
): ChartValidationResult => {
  return chartUtils.validateChartData(data, validator);
}; 