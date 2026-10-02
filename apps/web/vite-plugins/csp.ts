/**
 * Strict Content-Security-Policy (spec vault-web-app "Strict content security policy").
 * Static hosts and IPFS gateways can't always set headers, so the policy ships as a <meta> tag,
 * and also as a Netlify/Cloudflare-style `_headers` file for hosts that support it
 * (frame-ancestors only works as a real header).
 */
import { SECURITY_HEADERS } from './security-headers.ts';

export function buildCsp(connectOrigins: readonly string[]): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "manifest-src 'self'",
    `connect-src 'self' ${connectOrigins.join(' ')}`,
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
  ].join('; ');
}

export function injectCsp(html: string, connectOrigins: readonly string[]): string {
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) {
    throw new Error('index.html contains an inline <script>; the CSP forbids inline scripts');
  }
  if (/\sstyle=|<style[\s>]/i.test(html)) {
    throw new Error('index.html contains inline styles; the CSP forbids them');
  }
  const meta = `<meta http-equiv="Content-Security-Policy" content="${buildCsp(connectOrigins)}">`;
  if (!/<head>/i.test(html)) throw new Error('index.html has no <head>');
  // Keep <meta charset> first; the CSP meta must precede every script and stylesheet.
  if (/<meta charset="utf-8"\s*\/?>/i.test(html)) return html.replace(/(<meta charset="utf-8"\s*\/?>)/i, `$1${meta}`);
  return html.replace(/<head>/i, `<head>${meta}`);
}

export function headersFile(connectOrigins: readonly string[]): string {
  return [
    '/*',
    `  Content-Security-Policy: ${buildCsp(connectOrigins)}; frame-ancestors 'none'`,
    ...Object.entries(SECURITY_HEADERS).map(([k, v]) => `  ${k}: ${v}`),
    '',
  ].join('\n');
}
