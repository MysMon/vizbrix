import { CSSProperties, FC, ReactNode, useEffect, useRef } from 'react';
import styled from '@emotion/styled';

export interface ChartContainerProps {
  title?: string;
  className?: string;
  style?: CSSProperties;
  width?: number | string;
  height?: number | string;
  children?: ReactNode;
  hasError?: boolean;
  error?: string;
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

  useEffect(() => {
    if (!onResize || !containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      onResize();
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [onResize]);

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
        {isDraggable && <DragHandle />}
      </Header>
      {isLoading ? (
        <LoadingMessage>読み込み中...</LoadingMessage>
      ) : hasError ? (
        <ErrorMessage>{error || 'エラーが発生しました'}</ErrorMessage>
      ) : (
        <ChartWrapper>{children}</ChartWrapper>
      )}
    </Container>
  );
};
