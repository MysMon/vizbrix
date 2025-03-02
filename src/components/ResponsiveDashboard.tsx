import { FC, useEffect, useState } from 'react';
import { Dashboard } from './Dashboard';
import { DashboardProps } from '../types/dashboard';
import { Breakpoint } from '../types/common';

const defaultBreakpoints: Record<Breakpoint, number> = {
  xs: 0,
  sm: 600,
  md: 960,
  lg: 1280,
  xl: 1920,
};

const defaultColumns: Record<Breakpoint, number> = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 12,
  xl: 12,
};

interface ResponsiveDashboardProps extends Omit<DashboardProps, 'columns'> {
  breakpoints?: Partial<Record<Breakpoint, number>>;
  columns?: Partial<Record<Breakpoint, number>>;
}

export const ResponsiveDashboard: FC<ResponsiveDashboardProps> = ({
  breakpoints = defaultBreakpoints,
  columns = defaultColumns,
  ...props
}) => {
  const [currentBreakpoint, setCurrentBreakpoint] = useState<Breakpoint>('lg');

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      const breakpointEntries = Object.entries(breakpoints) as [Breakpoint, number][];
      
      // ブレークポイントを昇順にソート
      const sortedBreakpoints = breakpointEntries.sort(([, a], [, b]) => a - b);
      
      // 現在の幅に適したブレークポイントを見つける
      let newBreakpoint: Breakpoint = 'xs';
      for (const [bp, minWidth] of sortedBreakpoints) {
        if (width >= minWidth) {
          newBreakpoint = bp;
        } else {
          break;
        }
      }
      
      setCurrentBreakpoint(newBreakpoint);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoints]);

  return (
    <Dashboard
      {...props}
      columns={columns[currentBreakpoint] || defaultColumns[currentBreakpoint]}
    />
  );
}; 