import { CSSProperties } from 'react';
import { Theme } from './theme';
import { ChartDataPoint } from './charts';

export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export type ThemeConfig = Theme;

export interface ChartError {
  code: string;
  message: string;
  level: 'warning' | 'error';
  details?: unknown;
}

export interface ChartEvents<T extends ChartDataPoint = ChartDataPoint> {
  onClick?: (event: MouseEvent, data: T) => void;
  onHover?: (event: MouseEvent, data: T) => void;
  onMouseLeave?: (event: MouseEvent) => void;
  onSelectionChange?: (selection: T[]) => void;
}

export interface AccessibilityProps {
  ariaLabel?: string;
  ariaDescription?: string;
  role?: string;
  tabIndex?: number;
}

export interface DataConfig {
  updateInterval?: number;
  maxDataPoints?: number;
  aggregation?: 'sum' | 'average' | 'max' | 'min';
  formatter?: (value: number) => string;
}

// 基本的なスタイル要素を持つインターフェース
export interface CommonStyleProps {
  className?: string;
  style?: CSSProperties;
}

// 拡張スタイル設定
export interface StyleConfig extends CommonStyleProps {
  animation?: boolean;
  animationDuration?: number;
} 