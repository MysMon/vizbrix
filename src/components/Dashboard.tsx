import { useRef, useState, useEffect, FC, useCallback, useMemo } from 'react';
import styled from '@emotion/styled';
import GridLayout, { Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import '../styles/resizable.css';
import { DashboardProps } from '../types/dashboard';
import { ChartFactory } from './charts/ChartFactory';
import { ChartErrorBoundary } from './ErrorBoundary';
import { debounce } from '../utils/performance';
import { ChartConfig } from '../types/charts';

const DashboardContainer = styled.div<{ gap: number }>`
  padding: ${props => props.gap}px;
  width: 100%;
  box-sizing: border-box;

  .react-grid-item {
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    overflow: hidden;
  }

  .react-grid-item.react-grid-placeholder {
    background: #f0f0f0;
    opacity: 0.5;
  }
`;

const ErrorMessage = styled.div`
  padding: 16px;
  color: #ff4444;
  text-align: center;
`;

export const Dashboard: FC<DashboardProps> = ({
  items = [],
  columns = 12,
  rowHeight = 100,
  gap = 16,
  isDraggable = true,
  isResizable = true,
  onLayoutChange,
  onError,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(1200);
  const [error, setError] = useState<string | null>(null);

  const updateWidth = useCallback(() => {
    if (containerRef.current) {
      setContainerWidth(containerRef.current.offsetWidth);
    }
  }, []);

  const debouncedUpdateWidth = useCallback(
    debounce(updateWidth, 200),
    [updateWidth]
  );

  useEffect(() => {
    updateWidth();
    
    window.addEventListener('resize', debouncedUpdateWidth);
    
    return () => {
      window.removeEventListener('resize', debouncedUpdateWidth);
    };
  }, [updateWidth, debouncedUpdateWidth]);

  const handleLayoutChange = useCallback((newLayout: Layout[]) => {
    if (onLayoutChange) {
      try {
        onLayoutChange(newLayout);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '不明なエラーが発生しました';
        console.error('Layout change error:', error);
        setError(errorMessage);
        
        if (onError) {
          onError({
            code: 'LAYOUT_CHANGE_ERROR',
            message: errorMessage,
            level: 'error',
            details: error,
          });
        }
      }
    }
  }, [onLayoutChange, onError]);

  const isValidDashboardItems = useMemo(() => {
    return Array.isArray(items) && 
      items.every(item => 
        typeof item === 'object' && 
        item !== null && 
        'id' in item && 
        'chartConfig' in item
      );
  }, [items]);

  if (!isValidDashboardItems) {
    const errorMessage = 'ダッシュボードアイテムの形式が正しくありません';
    
    if (onError) {
      onError({
        code: 'INVALID_ITEMS_FORMAT',
        message: errorMessage,
        level: 'error',
      });
    }
    
    return <ErrorMessage>{errorMessage}</ErrorMessage>;
  }

  const layoutConfig = useMemo(() => ({
    className: "layout",
    layout: items,
    cols: columns,
    rowHeight,
    containerPadding: [gap, gap] as [number, number],
    margin: [gap, gap] as [number, number],
    isDraggable,
    isResizable
  }), [items, columns, rowHeight, gap, isDraggable, isResizable]);

  const chartItems = useMemo(() => {
    return items.map((item) => (
      <div key={item.id}>
        <ChartErrorBoundary onError={onError}>
          <ChartFactory
            config={item.chartConfig as ChartConfig}
          />
        </ChartErrorBoundary>
      </div>
    ));
  }, [items, onError]);

  return (
    <DashboardContainer gap={gap} ref={containerRef}>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <GridLayout
        {...layoutConfig}
        width={containerWidth}
        onLayoutChange={handleLayoutChange}
        draggableHandle=".chart-drag-handle"
      >
        {chartItems}
      </GridLayout>
    </DashboardContainer>
  );
}; 