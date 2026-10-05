/**
 * harden-codeql-web-findings (CodeQL #8/#9): exact, token-level CSP checks for verify-build. A CSP is parsed into
 * directives; connect-src must equal the expected set of tokens exactly. Substring matching on the HTML would accept
 * `https://rpc.example.evil.com` for `https://rpc.example`.
 */

/** CSP text -> Map(directive name -> tokens). */
export function directives(csp) {
  return new Map(
    csp
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [k, ...v] = d.split(/\s+/);
        return [k.toLowerCase(), v];
      }),
  );
}

/** Errors unless connect-src is exactly `expected` (as a set of tokens). */
export function connectSrcViolations(csp, expected) {
  const tokens = directives(csp).get('connect-src');
  if (!tokens) return ['no connect-src directive'];
  const have = new Set(tokens);
  const want = new Set(expected);
  const out = [];
  for (const t of want) if (!have.has(t)) out.push(`connect-src is missing ${t}`);
  for (const t of have) if (!want.has(t)) out.push(`connect-src has unexpected ${t}`);
  return out;
}

/**
 * improve-landing-seo D6: the one inline <script> the site allows is a JSON-LD *data block*, which browsers never
 * execute (so script-src and Trusted Types are unaffected). Only the attribute-exact opening tag below counts, and its
 * body must be JSON with no "<" (so it can't close early or smuggle markup). Valid blocks are removed from the returned
 * HTML; anything else is left in place for the caller's inline-script check, and a malformed block is also an error.
 */
export const JSON_LD_OPEN = '<script type="application/ld+json">';
export function stripJsonLd(html) {
  const blocks = [];
  const errors = [];
  const out = html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, (whole, body) => {
    if (body.includes('<')) {
      errors.push('JSON-LD block contains "<"');
      return whole;
    }
    try {
      blocks.push(JSON.parse(body));
    } catch {
      errors.push('JSON-LD block is not valid JSON');
      return whole;
    }
    return '';
  });
  return { html: out, blocks, errors };
}
