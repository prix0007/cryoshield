/**
 * Strict Content-Security-Policy (spec vault-web-app "Strict content security policy").
 * Static hosts and IPFS gateways can't always set headers, so the policy ships as a <meta> tag,
 * and also as a Netlify/Cloudflare-style `_headers` file for hosts that support it
 * (frame-ancestors only works as a real header).
 */
import { LANDING_PERMISSIONS_POLICY, SECURITY_HEADERS } from './security-headers.ts';

/** Extra sources allowed only on the landing document (add-privacy-preserving-analytics D3). */
export interface CspExtras {
  script?: readonly string[];
  connect?: readonly string[];
}

export function buildCsp(connectOrigins: readonly string[], extras: CspExtras = {}): string {
  return [
    "default-src 'none'",
    ['script-src', "'self'", ...(extras.script ?? [])].join(' '),
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "manifest-src 'self'",
    `connect-src 'self' ${[...connectOrigins, ...(extras.connect ?? [])].join(' ')}`,
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
  ].join('; ');
}

export function injectCsp(html: string, connectOrigins: readonly string[], extras: CspExtras = {}): string {
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) {
    throw new Error('index.html contains an inline <script>; the CSP forbids inline scripts');
  }
  if (/\sstyle=|<style[\s>]/i.test(html)) {
    throw new Error('index.html contains inline styles; the CSP forbids them');
  }
  const meta = `<meta http-equiv="Content-Security-Policy" content="${buildCsp(connectOrigins, extras)}">`;
  if (!/<head>/i.test(html)) throw new Error('index.html has no <head>');
  // Keep <meta charset> first; the CSP meta must precede every script and stylesheet.
  if (/<meta charset="utf-8"\s*\/?>/i.test(html)) return html.replace(/(<meta charset="utf-8"\s*\/?>)/i, `$1${meta}`);
  return html.replace(/<head>/i, `<head>${meta}`);
}

export function headersFile(appOrigins: readonly string[], landingOrigins: readonly string[], landing: CspExtras = {}): string {
  const block = (path: string, csp: string, pp: string) => [
    path,
    `  Content-Security-Policy: ${csp}; frame-ancestors 'none'`,
    ...Object.entries({ ...SECURITY_HEADERS, 'Permissions-Policy': pp }).map(([k, v]) => `  ${k}: ${v}`),
  ];
  const app = buildCsp(appOrigins);
  const land = buildCsp(landingOrigins, landing);
  return [
    ...block('/*', app, SECURITY_HEADERS['Permissions-Policy']!),
    // The landing document: analytics sources (if any), no app-only origins, and no WebAuthn.
    ...block('/', land, LANDING_PERMISSIONS_POLICY),
    ...block('/index.html', land, LANDING_PERMISSIONS_POLICY),
    '',
  ].join('\n');
}
