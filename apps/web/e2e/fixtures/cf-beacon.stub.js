// E2E stand-in for Cloudflare's beacon.min.js (served by page.route in 09-analytics.spec.ts; never shipped).
// Behaves like the real beacon for what we test: reads data-cf-beacon from its own <script> and reports the page URL
// and referrer to https://cloudflareinsights.com/cdn-cgi/rum.
(function () {
  var s = document.currentScript || document.querySelector('script[data-cf-beacon]');
  var cfg = JSON.parse((s && s.getAttribute('data-cf-beacon')) || '{}');
  var body = JSON.stringify({ token: cfg.token, spa: cfg.spa, location: location.href, referrer: document.referrer, ua: navigator.userAgent });
  navigator.sendBeacon('https://cloudflareinsights.com/cdn-cgi/rum', body);
})();
