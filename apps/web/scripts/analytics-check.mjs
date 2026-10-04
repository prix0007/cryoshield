/**
 * add-privacy-preserving-analytics 4.2 / 5.1 (verify-build):
 *  - landingCspDiff: the landing CSP may add ONLY the beacon URL (script-src) and the report origin (connect-src);
 *  - analyticsLeaks: no file of a non-landing page (HTML or any JS reachable from it) mentions the analytics;
 *  - policyDrift: when the build ships analytics, /privacy and /cookies must name it.
 */
import { directives } from './csp-check.mjs';
export const ALLOWED_LANDING_EXTRAS = {
  'script-src': ['https://static.cloudflareinsights.com/beacon.min.js'],
  'connect-src': ['https://cloudflareinsights.com'],
};

export function landingCspDiff(appCsp, landingCsp) {
  const a = directives(appCsp);
  const l = directives(landingCsp);
  const errors = [];
  for (const k of new Set([...a.keys(), ...l.keys()])) {
    const av = a.get(k) ?? [];
    const lv = l.get(k) ?? [];
    if (!a.has(k) || !l.has(k)) errors.push(`${k} present on only one of the pages`);
    // Dropping a connect-src source on the landing document is strictly fewer permissions (e.g. the app-only
    // Arweave fast index, fix-arweave-mirror-status D4); any other drop changes the policy shape and is refused.
    for (const t of av) if (!lv.includes(t) && !(k === 'connect-src' && t !== "'self'")) errors.push(`${k} drops ${t}`);
    for (const t of lv) if (!av.includes(t) && !(ALLOWED_LANDING_EXTRAS[k] ?? []).includes(t)) errors.push(`${k} adds ${t}`);
  }
  return errors;
}

/** `files` maps a page name to the text of its HTML plus every JS file reachable from it. */
export function analyticsLeaks(files, token) {
  const needles = ['cloudflareinsights', 'beacon.min.js', 'cf-beacon', 'data-cf-beacon', ...(token ? [token] : [])];
  const out = [];
  for (const [name, text] of Object.entries(files)) for (const n of needles) if (text.includes(n)) out.push(`${name} contains "${n}"`);
  return out;
}

export function policyDrift(pages) {
  const out = [];
  for (const [name, html] of Object.entries(pages)) {
    if (!html.includes('cloudflareinsights.com')) out.push(`${name} does not name cloudflareinsights.com`);
    if (!html.includes('Cloudflare Web Analytics')) out.push(`${name} does not name Cloudflare Web Analytics`);
  }
  return out;
}
