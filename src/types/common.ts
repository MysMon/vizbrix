import { CSSProperties } from 'react';
import { Theme } from './theme';
import { BaseDataPoint } from './charts';

export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export type ThemeConfig = Theme;

export interface ChartError {
  code: string;
  message: string;
  level: 'warning' | 'error';
  details?: unknown;
}

export interface ChartEvents<T extends BaseDataPoint = BaseDataPoint> {
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

export interface StyleConfig {
  className?: string;
  style?: CSSProperties;
  animation?: boolean;
  animationDuration?: number;
} 