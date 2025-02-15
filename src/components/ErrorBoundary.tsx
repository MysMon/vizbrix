import { Component, ErrorInfo, ReactNode } from 'react';
import styled from '@emotion/styled';
import { ChartError } from '../types/common';

interface ErrorBoundaryState {
  error: ChartError | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: ChartError) => void;
}

const ErrorContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background-color: #fff3f3;
  border: 1px solid #ffcdd2;
  border-radius: 4px;
  color: #b71c1c;
`;

const ErrorTitle = styled.h3`
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 600;
`;

const ErrorMessage = styled.p`
  margin: 0;
  font-size: 14px;
  text-align: center;
`;

export class ChartErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      error: {
        code: 'CHART_ERROR',
        message: error.message,
        level: 'error',
        details: error,
      },
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const chartError: ChartError = {
      code: 'CHART_ERROR',
      message: error.message,
      level: 'error',
      details: { error, errorInfo },
    };

    this.props.onError?.(chartError);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorContainer role="alert">
          <ErrorTitle>チャートの表示中にエラーが発生しました</ErrorTitle>
          <ErrorMessage>{this.state.error.message}</ErrorMessage>
        </ErrorContainer>
      );
    }

    return this.props.children;
  }
} 