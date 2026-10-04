/**
 * add-donation: the donation address comes from ONE file, config/donation.json, read at build time. It is validated
 * (EIP-55 checksum, Ethereum mainnet, ETH) so a typo or a swapped value fails the build, and the /support page gets
 * the address, the EIP-681 URI and a QR code rendered as inline SVG. Nothing here ships as runtime code: the QR
 * library is a pinned devDependency used only at build time.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import qrcode from 'qrcode-generator';
import { getAddress } from 'viem';

export interface Donation {
  address: `0x${string}`;
  chainId: 1;
  network: 'Ethereum mainnet';
  asset: 'ETH';
}

/** Reads and validates config/donation.json (or `override`, for tests). Throws on anything unexpected. */
export function loadDonation(webRoot: string, override?: unknown): Donation {
  const d = (override ?? JSON.parse(readFileSync(join(webRoot, '..', '..', 'config', 'donation.json'), 'utf8'))) as Record<string, unknown>;
  const keys = Object.keys(d).sort().join(',');
  if (keys !== 'address,asset,chainId,network') throw new Error(`donation: unexpected fields ${keys}`);
  if (typeof d.address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(d.address)) throw new Error('donation: address is not 20 bytes of hex');
  let checksummed: string;
  try {
    checksummed = getAddress(d.address.toLowerCase());
  } catch {
    throw new Error('donation: invalid address');
  }
  // The file must carry the EIP-55 checksum casing exactly (all-lowercase or mixed-up casing is refused).
  if (checksummed !== d.address) throw new Error('donation: address does not have a valid EIP-55 checksum');
  if (d.chainId !== 1) throw new Error('donation: chainId must be 1 (Ethereum mainnet)');
  if (d.network !== 'Ethereum mainnet') throw new Error('donation: network must be "Ethereum mainnet"');
  if (d.asset !== 'ETH') throw new Error('donation: asset must be ETH');
  return d as unknown as Donation;
}

/** EIP-681 payment URI: ethereum:<address>@<chainId>. */
export const donationUri = (d: Donation) => `ethereum:${d.address}@${d.chainId}`;

const QUIET = 4; // modules of quiet zone around the symbol (QR spec minimum)

/**
 * QR code (error correction M) as an inline SVG: one path, one 1x1 square per dark module, plus a quiet zone.
 * No script, no links, no external references, so it is CSP-safe.
 */
export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const size = n + QUIET * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="qr" viewBox="0 0 ${size} ${size}" role="img" aria-labelledby="qr-title" shape-rendering="crispEdges">` +
    `<title id="qr-title">QR code for the donation address on Ethereum mainnet</title>` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`
  );
}

/** Test helper: the module matrix (including the quiet zone) drawn by qrSvg. */
export function qrMatrixFromSvg(svg: string): boolean[][] {
  const size = Number(svg.match(/viewBox="0 0 (\d+) \1"/)?.[1]);
  const m = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  for (const [, x, y] of svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) m[Number(y)]![Number(x)] = true;
  return m;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Fills the /support page markers from the validated config. */
export function renderSupport(html: string, d: Donation): string {
  const uri = donationUri(d);
  return html
    .replaceAll('<!--donation:address-->', esc(d.address))
    .replaceAll('__DONATION_URI__', esc(uri))
    .replaceAll('<!--donation:network-->', esc(d.network))
    .replace('<!--donation:qr-->', qrSvg(uri));
}

/** Vite plugin: fills the donation markers (only /support has them) from the validated config at build time. */
export function donationPlugin(webRoot: string): import('vite').Plugin {
  return {
    name: 'cryoshield-donation',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!html.includes('<!--donation:') && !html.includes('__DONATION_URI__')) return html;
        return renderSupport(html, loadDonation(webRoot));
      },
    },
  };
}
