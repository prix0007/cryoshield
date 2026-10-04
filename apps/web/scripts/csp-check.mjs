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
