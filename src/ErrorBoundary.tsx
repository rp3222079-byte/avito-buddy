import { Component } from 'react';
import type { ReactNode } from 'react';

export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="panel resource-state" role="alert">
      <h1>Не удалось открыть Avito Start</h1>
      <button className="primary-button" onClick={() => window.location.reload()}>Перезагрузить страницу</button>
    </main>;
  }
}
