/**
 * Cloudflare Web Analytics, "beacon only", landing page only (add-privacy-preserving-analytics D3/D4, task 4.1).
 *
 * The build emits the beacon <script> (src, SHA-384 integrity, crossorigin, data-cf-beacon {token, spa:false}) inside
 * an inert <template id="cf-beacon" data-host="…"> in the landing HTML only, and only when VITE_CF_BEACON_TOKEN is set
 * for a production build. Trusted Types 'none' forbids setting script.src from JS, so this loader never builds a URL:
 * it clones the reviewed, build-time element into <head> after these gates:
 *   - Global Privacy Control or Do Not Track -> nothing is inserted;
 *   - any host other than the production host -> nothing;
 *   - no template (token unset, dev or E2E build) -> nothing.
 * Before inserting, it removes the query string and fragment from the address (history.replaceState), so the beacon
 * never sees campaign parameters or fragments.
 */
export function loadBeacon(doc: Document, win: Window): boolean {
  const tpl = doc.getElementById('cf-beacon');
  if (!(tpl instanceof HTMLTemplateElement)) return false;
  if (doc.head.querySelector('script[data-cf-beacon]')) return false;
  const nav = win.navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.globalPrivacyControl === true) return false;
  if (nav.doNotTrack === '1' || (win as Window & { doNotTrack?: string }).doNotTrack === '1') return false;
  if (!tpl.dataset.host || win.location.hostname !== tpl.dataset.host) return false;
  if (win.location.search || win.location.hash) win.history.replaceState(null, '', win.location.pathname);
  doc.head.append(doc.importNode(tpl.content, true));
  return true;
}
