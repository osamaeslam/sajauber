import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from './components/ErrorBoundary';
import App from './App.tsx';
import './index.css';

const handleGlobalError = (event: ErrorEvent) => {
  console.error('[GlobalError]', event.message, event.filename, event.lineno);
  event.preventDefault();
};

const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
  console.error('[UnhandledRejection]', event.reason);
  event.preventDefault();
};

window.addEventListener('error', handleGlobalError);
window.addEventListener('unhandledrejection', handleUnhandledRejection);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then((registration) => {
    console.log('[SW] Registered:', registration.scope);
  }).catch((error) => {
    console.warn('[SW] Registration failed:', error);
  });

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'ONLINE_CHECK_RESULT') {
      console.log('[SW] Online status from service worker:', event.data.online);
    }
  });
}

// Play a short notification tone using Web Audio API (no external file required).
function playNotificationTone(durationMs = 10000) {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    o.connect(g);
    g.connect(ctx.destination);
    // ramp in
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    o.start();
    // ensure context resumed on browsers that require user interaction
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      ctx.resume().catch(() => {});
    }
    // stop after duration
    setTimeout(() => {
      try {
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.02);
        setTimeout(() => {
          try { o.stop(); } catch (e) {}
          try { ctx.close(); } catch (e) {}
        }, 120);
      } catch (e) {}
    }, durationMs);
  } catch (e) {
    console.warn('[Audio] playNotificationTone failed', e);
  }
}

// If opened via SW notification (/?playNotification=1), attempt to play a tone for 10s.
try {
  const params = new URLSearchParams(window.location.search);
  if (params.get('playNotification') === '1') {
    // try to play immediately; may be blocked until interaction
    playNotificationTone(10000);
    // remove the param so it doesn't replay on reload
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('playNotification');
      window.history.replaceState({}, document.title, url.pathname + url.search);
    } catch (e) {}
  }
} catch (e) {}
