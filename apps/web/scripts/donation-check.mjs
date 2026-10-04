/**
 * add-donation anti-swap check (verify-build). The donation address must come only from config/donation.json:
 * - the /support page shows exactly that address (checksum casing) and NO other 20-byte hex address anywhere in it;
 * - every element marked data-donation-address carries exactly that address;
 * - every EIP-681 `ethereum:` URI (any case, colon possibly entity-encoded) in any built HTML, JS, CSS or SVG file is
 *   exactly `ethereum:<address>@<chainId>`;
 * - the /support check also runs on the page's text with tags removed and character references decoded, so an
 *   address split by markup (<wbr>) or written as entities is still seen.
 * A swapped, mistyped or second address in a donation context fails the build.
 */
const HEX40 = /0x[0-9a-fA-F]{40}/g;
const URI_RE = /ethereum(?::|&#0*58;|&#x0*3a;|&colon;)[^"'`\s<>)]*/gi;

/**
 * Text content of an HTML document, for the text-level address check (never used as output, so this is not a
 * sanitizer). A single-pass scanner drops everything from each '<' to the next '>', so no markup can survive or
 * reassemble (unlike a regex replace). Numeric character references and &colon; are then decoded, once.
 */
export function textOf(html) {
  let text = '';
  let inTag = false;
  for (const ch of html) {
    if (inTag) {
      if (ch === '>') inTag = false;
    } else if (ch === '<') inTag = true;
    else text += ch;
  }
  return text.replace(/&#(?:x([0-9a-f]+)|(\d+));|&colon;/gi, (_m, hex, dec) =>
    hex !== undefined ? String.fromCodePoint(parseInt(hex, 16)) : dec !== undefined ? String.fromCodePoint(Number(dec)) : ':',
  );
}

/** @param {Record<string, string>} files relative path -> content (built HTML and JS) */
export function donationViolations(files, donation, supportPage = 'support/index.html') {
  const out = [];
  const uri = `ethereum:${donation.address}@${donation.chainId}`;
  const page = files[supportPage];
  if (page === undefined) out.push(`${supportPage} is missing`);
  else {
    const found = [...page.matchAll(HEX40), ...textOf(page).matchAll(HEX40)].map((m) => m[0]);
    if (!found.includes(donation.address)) out.push(`${supportPage} does not show the configured address`);
    for (const a of new Set(found)) if (a !== donation.address) out.push(`${supportPage} contains another address ${a}`);
    if (!/<svg [^>]*class="qr"/.test(page)) out.push(`${supportPage} has no QR code`);
    if (!page.includes(`href="${uri}"`)) out.push(`${supportPage} has no "Open in wallet" link to ${uri}`);
  }
  for (const [f, text] of Object.entries(files)) {
    for (const m of text.matchAll(/data-donation-address[^>]*>\s*([^<]*)</g)) {
      if (m[1].trim() !== donation.address) out.push(`${f}: data-donation-address shows "${m[1].trim()}"`);
    }
    for (const m of text.matchAll(URI_RE)) if (m[0] !== uri) out.push(`${f}: unexpected payment URI ${m[0]}`);
  }
  return out;
}
