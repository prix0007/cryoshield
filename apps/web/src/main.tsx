import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { OpenerBlocked, openedByScript } from './ui/OpenerGuard';
import './ui/tokens.css';
import './ui/chrome.css';
import './ui/global.css';

// Refuse to initialise (no services, no WebAuthn, no network) in a window opened by another page's script.
createRoot(document.getElementById('root')!).render(<StrictMode>{openedByScript(window) ? <OpenerBlocked /> : <App />}</StrictMode>);
