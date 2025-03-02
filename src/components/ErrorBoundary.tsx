import { Component, ErrorInfo, ReactNode } from 'react';
import styled from '@emotion/styled';
import { ChartError } from '../types/common';

interface ErrorBoundaryState {
  error: ChartError | null;
  hasAttemptedRecovery: boolean;
  recoveryAttempts: number;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: ChartError) => void;
  // 設定可能なリカバリー戦略
  recoveryStrategy?: 'retry' | 'fallback' | 'none';
  // 最大リトライ回数
  maxRetryAttempts?: number;
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

const RetryButton = styled.button`
  margin-top: 16px;
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  background-color: #b71c1c;
  color: white;
  cursor: pointer;
  font-size: 14px;
  
  &:hover {
    background-color: #d32f2f;
  }

  &:disabled {
    background-color: #cccccc;
    cursor: not-allowed;
  }
`;

export class ChartErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { 
      error: null,
      hasAttemptedRecovery: false,
      recoveryAttempts: 0
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // エラーをChartError形式に変換
    return {
      error: {
        code: 'CHART_ERROR',
        message: error.message,
        level: 'error',
        details: error,
      },
      hasAttemptedRecovery: false,
      recoveryAttempts: 0
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const chartError: ChartError = {
      code: 'CHART_ERROR',
      message: error.message,
      level: 'error',
      details: { error, errorInfo },
    };

    // エラーログ記録の強化
    console.error('Chart Error:', error);
    console.error('Error Stack:', errorInfo.componentStack);

    this.props.onError?.(chartError);
  }

  // エラー状態をリセット
  handleRetry = () => {
    this.setState(prevState => ({ 
      error: null,
      hasAttemptedRecovery: true,
      recoveryAttempts: prevState.recoveryAttempts + 1
    }));
  };

  render() {
    const { error, recoveryAttempts } = this.state;
    const { children, fallback, recoveryStrategy = 'retry', maxRetryAttempts = 3 } = this.props;
    
    if (error) {
      // カスタムフォールバックがある場合はそれを使用
      if (fallback) {
        return fallback;
      }

      const hasReachedMaxAttempts = recoveryAttempts >= maxRetryAttempts;

      return (
        <ErrorContainer role="alert">
          <ErrorTitle>チャートの表示中にエラーが発生しました</ErrorTitle>
          <ErrorMessage>{error.message}</ErrorMessage>
          {recoveryAttempts > 0 && (
            <ErrorMessage>
              リトライ回数: {recoveryAttempts}/{maxRetryAttempts}
            </ErrorMessage>
          )}
          
          {recoveryStrategy === 'retry' && !hasReachedMaxAttempts && (
            <RetryButton onClick={this.handleRetry}>
              再試行
            </RetryButton>
          )}
          {recoveryStrategy === 'retry' && hasReachedMaxAttempts && (
            <ErrorMessage>
              リトライ回数の上限に達しました。問題が解決しない場合は、管理者に連絡してください。
            </ErrorMessage>
          )}
        </ErrorContainer>
      );
    }

    return children;
  }
} 