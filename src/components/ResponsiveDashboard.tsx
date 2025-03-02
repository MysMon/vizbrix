import { FC, useEffect, useState, useCallback } from 'react';
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

  // 複雑なリサイズ処理をuseCallbackでメモ化
  const handleResize = useCallback(() => {
    const width = window.innerWidth;
    
    // 型安全にするためにEntries型を明示的に定義
    type BreakpointEntry = [Breakpoint, number];
    
    // アクティブなブレークポイントを取得
    const mergedBreakpoints: Record<Breakpoint, number> = {
      ...defaultBreakpoints,
      ...breakpoints
    };
    
    const breakpointEntries = Object.entries(mergedBreakpoints) as BreakpointEntry[];
    
    // ブレークポイントを昇順にソート
    // 昇順にソートすることで、画面幅に合うブレークポイントを小さいものから順に適用し、
    // 最終的に最も大きな適用可能なブレークポイントを選択できます
    const sortedBreakpoints = breakpointEntries.sort(([, a], [, b]) => a - b);
    
    // 現在の幅に適したブレークポイントを見つける
    // 幅が各ブレークポイントの最小値以上である限り、そのブレークポイントを適用し続ける
    let newBreakpoint: Breakpoint = 'xs';
    for (const [bp, minWidth] of sortedBreakpoints) {
      if (width >= minWidth) {
        newBreakpoint = bp;
      } else {
        break;
      }
    }
    
    setCurrentBreakpoint(newBreakpoint);
  }, [breakpoints]);

  useEffect(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  // 型安全なアクセスを確保するため、明示的に undefined チェックを行う
  const resolvedColumns = columns[currentBreakpoint] !== undefined 
    ? columns[currentBreakpoint] 
    : defaultColumns[currentBreakpoint];

  // カラム数が undefined になる可能性がないことを保証
  const safeColumns = resolvedColumns !== undefined ? resolvedColumns : defaultColumns.lg;

  return (
    <Dashboard
      {...props}
      columns={safeColumns}
    />
  );
}; 