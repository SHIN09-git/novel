import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('React error boundary caught an error:', error, errorInfo)
  }

  private reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset)
    }

    return (
      <div className="error-boundary" role="alert">
        <div>
          <p className="eyebrow">渲染错误</p>
          <h2>页面遇到一个可恢复的错误</h2>
          <p>可以先重试当前页面。如果问题持续出现，请导出数据备份后再反馈错误详情。</p>
        </div>
        <details>
          <summary>技术详情</summary>
          <pre>{error.stack ?? error.message}</pre>
        </details>
        <button className="primary-button" type="button" onClick={this.reset}>
          重试页面
        </button>
      </div>
    )
  }
}
