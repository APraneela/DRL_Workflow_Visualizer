import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './index.css';

// Shim process for libraries that expect it in the browser
if (typeof window !== 'undefined' && !window.process) {
  (window as any).process = { env: {} };
}

// Suppress ResizeObserver loop errors which are often benign browser warnings
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    if (e.message === 'ResizeObserver loop limit exceeded' || 
        e.message === 'ResizeObserver loop completed with undelivered notifications.') {
      e.stopImmediatePropagation();
    }
  });
}

console.log("RuleFlowApp: Initializing...");

createRoot(document.getElementById('root')!).render(
  <App />,
);
