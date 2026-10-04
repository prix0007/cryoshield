// @vitest-environment node
/** add-donation: verify-build's anti-swap check. */
import { describe, expect, it } from 'vitest';
import { donationViolations, textOf } from '../../scripts/donation-check.mjs';

const D = { address: '0xfb4172e26AC8735C06656f1df14151cFe8441481', chainId: 1 };
const URI = `ethereum:${D.address}@1`;
const OTHER = '0x1111111111111111111111111111111111111111';
const page = (addr = D.address, uri = URI) =>
  `<svg xmlns="x" class="qr" viewBox="0 0 41 41"></svg><code id="donation-address" data-donation-address>${addr}</code><a href="${uri}">Open in wallet</a>`;

describe('donationViolations', () => {
  it('passes for the configured address, URI and QR', () => {
    expect(donationViolations({ 'support/index.html': page(), 'assets/app.js': `const reg="${OTHER}"` }, D)).toEqual([]);
  });
  it('fails when the page shows a swapped address', () => {
    expect(donationViolations({ 'support/index.html': page(OTHER) }, D).join('\n')).toMatch(/does not show the configured address|another address/);
  });
  it('fails on a second address anywhere on /support, even in a comment', () => {
    expect(donationViolations({ 'support/index.html': page() + `<!-- ${OTHER} -->` }, D).join()).toMatch(/another address/);
  });
  it('fails on wrong checksum casing (it is a different string)', () => {
    expect(donationViolations({ 'support/index.html': page(D.address.toLowerCase(), `ethereum:${D.address.toLowerCase()}@1`) }, D).length).toBeGreaterThan(0);
  });
  it('fails on a payment URI anywhere with another address or chain', () => {
    expect(donationViolations({ 'support/index.html': page(), 'index.html': `<a href="ethereum:${OTHER}@1">` }, D).join()).toMatch(/unexpected payment URI/);
    expect(donationViolations({ 'support/index.html': page(), 'assets/x.js': `"ethereum:${D.address}@10"` }, D).join()).toMatch(/unexpected payment URI/);
  });
  it('fails when a data-donation-address element elsewhere shows another address', () => {
    expect(donationViolations({ 'support/index.html': page(), 'index.html': `<span data-donation-address>${OTHER}</span>` }, D).join()).toMatch(/data-donation-address/);
  });
  it('catches an address split by tags or written as entities on /support (text-level check)', () => {
    const split = OTHER.slice(0, 20) + '<wbr>' + OTHER.slice(20);
    expect(donationViolations({ 'support/index.html': page() + `<p>${split}</p>` }, D).join()).toMatch(/another address/);
    const entities = '&#x30;' + OTHER.slice(1);
    expect(donationViolations({ 'support/index.html': page() + `<p>${entities}</p>` }, D).join()).toMatch(/another address/);
  });
  it('catches upper-case and entity-encoded payment URIs, and CSS/SVG files', () => {
    expect(donationViolations({ 'support/index.html': page(), 'index.html': `<a href="ETHEREUM:${OTHER}@1">` }, D).join()).toMatch(/unexpected payment URI/);
    expect(donationViolations({ 'support/index.html': page(), 'index.html': `<a href="ethereum&#58;${OTHER}@1">` }, D).join()).toMatch(/unexpected payment URI/);
    expect(donationViolations({ 'support/index.html': page(), 'assets/x.css': `.a::after{content:"ethereum:${OTHER}"}` }, D).join()).toMatch(/unexpected payment URI/);
  });
  it('fails when the QR or the wallet link is missing', () => {
    expect(donationViolations({ 'support/index.html': `<code data-donation-address>${D.address}</code>` }, D).join()).toMatch(/QR code[\s\S]*Open in wallet|Open in wallet[\s\S]*QR/);
  });

  it('textOf drops all markup in one pass, including nested-looking tags, and decodes references once', () => {
    expect(textOf('a<b>c</b>d')).toBe('acd');
    expect(textOf('<scr<script>ipt>x</script>')).not.toContain('<');
    expect(textOf('<<script>script>alert(1)<</script>/script>')).not.toMatch(/<script/i);
    expect(textOf('&#x30;x&#49;&colon;')).toBe('0x1:');
    expect(textOf('&amp;#x30;')).toBe('&amp;#x30;'); // no double decoding
  });
});
