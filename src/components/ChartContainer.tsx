import { CSSProperties, FC, ReactNode, useEffect, useRef, useCallback, useMemo } from 'react';
import styled from '@emotion/styled';
import { ChartError } from '../types/common';

export interface ChartContainerProps {
  title?: string;
  className?: string;
  style?: CSSProperties;
  width?: number | string;
  height?: number | string;
  children?: ReactNode;
  hasError?: boolean;
  error?: string | ChartError;
  isLoading?: boolean;
  onResize?: () => void;
  isDraggable?: boolean;
}

type StyledContainerProps = {
  $width?: number | string;
  $height?: number | string;
}

const Container = styled.div<StyledContainerProps>`
  position: relative;
  width: ${({ $width }) => $width || '100%'};
  height: ${({ $height }) => $height || '100%'};
  min-height: 300px;
  padding: ${({ theme }) => theme.spacing.medium};
  background: ${({ theme }) => theme.colors.background};
  border-radius: ${({ theme }) => theme.borderRadius.medium};
  box-shadow: ${({ theme }) => theme.shadows.small};
`;

const Title = styled.h3`
  margin: 0;
  font-size: ${({ theme }) => theme.typography.fontSize.title};
  font-weight: ${({ theme }) => theme.typography.fontWeight.bold};
  color: ${({ theme }) => theme.colors.text};
`;

const ErrorMessage = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: ${({ theme }) => theme.colors.error};
  font-size: ${({ theme }) => theme.typography.fontSize.body};
  text-align: center;
`;

const LoadingMessage = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: ${({ theme }) => theme.colors.text};
  font-size: ${({ theme }) => theme.typography.fontSize.body};
  text-align: center;
`;

const ChartWrapper = styled.div`
  width: 100%;
  height: calc(100% - 40px);
  position: relative;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${({ theme }) => theme.spacing.medium};
`;

const DragHandle = styled.div`
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: move;
  opacity: 0.5;
  transition: opacity 0.2s;

  &:hover {
    opacity: 1;
  }

  &::before {
    content: "⋮⋮";
    font-size: 16px;
    letter-spacing: -2px;
  }
`;

export const ChartContainer: FC<ChartContainerProps> = ({
  title,
  className,
  style,
  width,
  height,
  children,
  hasError,
  error,
  isLoading,
  onResize,
  isDraggable,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const handleResize = useCallback(() => {
    if (onResize) {
      onResize();
    }
  }, [onResize]);

  useEffect(() => {
    if (!handleResize || !containerRef.current) return;

    const resizeObserver = new ResizeObserver(handleResize);
    const currentContainer = containerRef.current;
    
    resizeObserver.observe(currentContainer);

    return () => {
      resizeObserver.disconnect();
    };
  }, [handleResize]);

  const errorMessage = useMemo(() => {
    if (!error) return 'エラーが発生しました';
    if (typeof error === 'string') return error;
    return error.message;
  }, [error]);

  return (
    <Container 
      ref={containerRef}
      className={className} 
      style={style} 
      $width={width}
      $height={height}
      data-testid="chart-container"
    >
      <Header>
        {title && <Title>{title}</Title>}
        {isDraggable && <DragHandle className="chart-drag-handle" />}
      </Header>
      {isLoading ? (
        <LoadingMessage>読み込み中...</LoadingMessage>
      ) : hasError ? (
        <ErrorMessage>{errorMessage}</ErrorMessage>
      ) : (
        <ChartWrapper>{children}</ChartWrapper>
      )}
    </Container>
  );
};
