import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

function showFatal(error) {
  const root = document.getElementById('root');
  if (!root) return;
  const message = error?.message || error?.reason?.message || String(error?.reason || error || 'Unknown error');
  if (isRemoveChildDomError(message)) return;
  root.innerHTML = `<main style="min-height:100vh;background:#f28c0f;color:white;padding:24px;font-family:Arial,sans-serif"><section style="max-width:900px;margin:0 auto;background:#111;border:1px solid rgba(255,255,255,.25);border-radius:24px;padding:24px"><p style="margin:0 0 8px;color:#fed7aa;text-transform:uppercase;letter-spacing:.16em;font-size:12px">Grease Nomads Report Error</p><h1 style="margin:0 0 12px;font-size:28px">This report could not open.</h1><p style="line-height:1.5;color:#eee">Please screenshot this message and send it back so we can fix the customer link.</p><pre style="white-space:pre-wrap;background:#000;border:1px solid rgba(255,255,255,.2);border-radius:16px;padding:14px;color:#fecaca;font-size:12px;overflow:auto">${message.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</pre></section></main>`;
}

function isRemoveChildDomError(error) {
  const message = String(error?.message || error?.reason?.message || error || '');
  return message.includes("Failed to execute 'removeChild'") && message.includes('not a child of this node');
}

window.addEventListener('error', e => {
  if (isRemoveChildDomError(e.error || e.message)) {
    e.preventDefault();
    return;
  }
  showFatal(e.error || e.message);
});
window.addEventListener('unhandledrejection', e => {
  if (isRemoveChildDomError(e.reason)) {
    e.preventDefault();
    return;
  }
  showFatal(e.reason);
});

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    if (isRemoveChildDomError(error)) return null;
    return { error };
  }
  componentDidCatch(error) {
    if (isRemoveChildDomError(error)) {
      this.setState({ error: null });
      return;
    }
    console.error('App failed', error);
  }
  render() {
    if (this.state.error) {
      showFatal(this.state.error);
      return null;
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>,
);
