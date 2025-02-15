import { useRef, useState, useEffect, FC } from 'react';
import styled from '@emotion/styled';
import GridLayout, { Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import '../styles/resizable.css';
import { DashboardProps } from '../types/dashboard';
import { ChartFactory } from './charts/ChartFactory';
import { ChartErrorBoundary } from './ErrorBoundary';

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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(1200);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    
    return () => {
      window.removeEventListener('resize', updateWidth);
    };
  }, []);

  const handleLayoutChange = (newLayout: Layout[]) => {
    if (onLayoutChange) {
      try {
        onLayoutChange(newLayout);
      } catch (error) {
        console.error('Layout change error:', error);
      }
    }
  };

  if (!Array.isArray(items)) {
    return (
      <ErrorMessage>
        ダッシュボードアイテムの形式が正しくありません
      </ErrorMessage>
    );
  }

  return (
    <DashboardContainer gap={gap} ref={containerRef}>
      <GridLayout
        className="layout"
        layout={items}
        cols={columns}
        rowHeight={rowHeight}
        width={containerWidth}
        containerPadding={[gap, gap]}
        margin={[gap, gap]}
        isDraggable={isDraggable}
        isResizable={isResizable}
        onLayoutChange={handleLayoutChange}
        draggableHandle=".chart-drag-handle"
      >
        {items.map((item) => (
          <div key={item.id}>
            <ChartErrorBoundary>
              <ChartFactory
                config={item.chartConfig}
              />
            </ChartErrorBoundary>
          </div>
        ))}
      </GridLayout>
    </DashboardContainer>
  );
}; 