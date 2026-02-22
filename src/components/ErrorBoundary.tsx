'use client';

import React, { ErrorInfo, ReactNode } from 'react';

type ResetKey = string | number | boolean | null | undefined;

interface ErrorBoundaryProps {
  children: ReactNode;
  resetKeys?: ResetKey[];
  fallback?: ReactNode;
  fallbackRender?: (props: { reset: () => void }) => ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

function areResetKeysEqual(
  prev: ResetKey[] = [],
  next: ResetKey[] = [],
): boolean {
  if (prev.length !== next.length) {
    return false;
  }

  for (let i = 0; i < prev.length; i++) {
    if (!Object.is(prev[i], next[i])) {
      return false;
    }
  }

  return true;
}

export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (!this.state.hasError) {
      return;
    }

    if (!areResetKeysEqual(prevProps.resetKeys, this.props.resetKeys)) {
      this.setState({ hasError: false });
    }
  }

  private reset = () => {
    this.setState({ hasError: false });
  };

  override render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallbackRender) {
      return this.props.fallbackRender({ reset: this.reset });
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <div
        role='alert'
        className='rounded-xl border border-rose-200/60 bg-rose-50 px-4 py-6 text-center text-sm text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-300'
      >
        加载失败，请重试
      </div>
    );
  }
}
