import '../ui/tokens.css';
import '../ui/chrome.css';
import './landing.css';
import { bootLanding } from './boot';

bootLanding({
  doc: document,
  matchMedia: (q) => window.matchMedia(q),
  IO: typeof IntersectionObserver === 'undefined' ? undefined : IntersectionObserver,
  load: () => import('./motion'),
});
