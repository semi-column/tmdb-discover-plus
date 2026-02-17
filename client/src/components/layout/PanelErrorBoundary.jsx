import { Component } from 'react';
import { RefreshCw } from 'lucide-react';

export class PanelErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  handleReset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '32px 16px',
            gap: '12px',
            textAlign: 'center',
            minHeight: '200px',
          }}
        >
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            {this.props.fallbackMessage || 'Something went wrong in this panel.'}
          </p>
          <button className="btn btn-secondary btn-sm" onClick={this.handleReset}>
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
