// @vitest-environment node
/**
 * add-donation: config/donation.json is the single source of the donation address. It must be exactly the address the
 * founder gave, with a valid EIP-55 checksum, on Ethereum mainnet, and match the README; the QR code encodes exactly
 * the EIP-681 URI.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import jsQR from 'jsqr';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { donationUri, loadDonation, qrMatrixFromSvg, qrSvg } from '../../vite-plugins/donation';

const web = join(__dirname, '..', '..');
const repo = join(web, '..', '..');
const ADDRESS = '0xfb4172e26AC8735C06656f1df14151cFe8441481';
const URI = `ethereum:${ADDRESS}@1`;

describe('config/donation.json', () => {
  const raw = JSON.parse(readFileSync(join(repo, 'config', 'donation.json'), 'utf8'));
  it('is exactly the founder’s address on Ethereum mainnet, ETH', () => {
    expect(raw).toEqual({ address: ADDRESS, chainId: 1, network: 'Ethereum mainnet', asset: 'ETH' });
  });
  it('has a valid EIP-55 checksum (checksum casing is preserved, not normalised)', () => {
    expect(getAddress(raw.address)).toBe(raw.address);
    expect(raw.address).not.toBe(raw.address.toLowerCase());
  });
  it('loadDonation validates and returns it; a wrong checksum, chain or asset is refused', () => {
    expect(loadDonation(web)).toEqual(raw);
    const bad = (o: object) => () => loadDonation(web, { ...raw, ...o });
    expect(bad({ address: ADDRESS.toLowerCase() })).toThrow(/checksum/);
    expect(bad({ address: ADDRESS.replace('fb41', 'Fb41') })).toThrow(/checksum/);
    expect(bad({ chainId: 10 })).toThrow(/chainId/);
    expect(bad({ asset: 'USDC' })).toThrow(/asset/);
  });
  it('the README publishes the same address under "Support the project"', () => {
    const readme = readFileSync(join(repo, 'README.md'), 'utf8');
    const sec = readme.split(/\n## /).find((s) => s.startsWith('Support the project'))!;
    expect(sec, 'README section').toBeTruthy();
    expect(sec).toContain(ADDRESS);
    expect([...readme.matchAll(/0x[0-9a-fA-F]{40}/g)].map((m) => m[0])).toEqual([ADDRESS]);
    expect(sec).toMatch(/Ethereum mainnet/);
  });
});

describe('EIP-681 URI and QR code', () => {
  it('builds ethereum:<address>@1', () => expect(donationUri(loadDonation(web))).toBe(URI));

  it('the build-time SVG QR decodes back to exactly the URI', () => {
    const svg = qrSvg(URI);
    expect(svg).toMatch(/^<svg [^>]*role="img"[^>]*aria-labelledby="qr-title"/);
    expect(svg).not.toMatch(/<script|on\w+=|href=/i);
    const m = qrMatrixFromSvg(svg);
    const scale = 6;
    const size = m.length * scale;
    const px = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const v = m[Math.floor(y / scale)]![Math.floor(x / scale)] ? 0 : 255;
        px.set([v, v, v, 255], (y * size + x) * 4);
      }
    expect(jsQR(px, size, size)?.data).toBe(URI);
  });
});
