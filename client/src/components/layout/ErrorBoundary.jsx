import { Component } from 'react';
import { RefreshCw } from 'lucide-react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="app">
          <main className="main">
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '60vh',
                gap: '16px',
                textAlign: 'center',
                padding: '24px',
              }}
            >
              <h2 style={{ fontSize: '24px' }}>Something went wrong</h2>
              <p style={{ color: 'var(--text-muted)', maxWidth: '400px' }}>
                An unexpected error occurred. Please reload the page to try again.
              </p>
              <button className="btn btn-primary" onClick={this.handleReset}>
                <RefreshCw size={18} />
                Reload
              </button>
            </div>
          </main>
        </div>
      );
    }

    return this.props.children;
  }
}
