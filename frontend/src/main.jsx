import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { LanguageProvider, useLanguage } from './i18n/LanguageContext.jsx';
import '@tigao/organizer-react/styles.css';
import './styles.css';
import './multifile.css';
import './organizer-overrides.css';

class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="connection-page"><h1>{this.props.t('errorBoundary.title')}</h1><p>{this.props.t('errorBoundary.copy')}</p><button onClick={() => location.reload()}>{this.props.t('errorBoundary.reload')}</button></main>;
    return this.props.children;
  }
}
function LocalizedErrorBoundary({ children }) {
  const { t } = useLanguage();
  return <ErrorBoundary t={t}>{children}</ErrorBoundary>;
}
createRoot(document.getElementById('root')).render(<LanguageProvider><LocalizedErrorBoundary><App /></LocalizedErrorBoundary></LanguageProvider>);
