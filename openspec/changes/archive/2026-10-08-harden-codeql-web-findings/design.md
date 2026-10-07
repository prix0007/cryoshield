# Design

## D1. Tokens, not substrings

`connectSrcViolations(csp, expected)` parses the CSP with `directives()` (split on `;`, then whitespace, with the
directive name lower-cased). It compares `connect-src` with the expected set in both directions: every expected token
must be present, and nothing else may be.
- **Expected set:** mirrors `src/config/schema.ts` exactly: `'self'`, the origins (`new URL(...).origin`) of the RPC,
  bundler, Turbo upload and Arweave gateway URLs, and the app-only fast index (`https://turbo-gateway.com` by
  default).
- **Source:** only the app page's CSP meta tag is read, so origin text elsewhere on the page can't satisfy the check.
- **What fails:** a prefix spoof (`…invalid.evil.com`), a subdomain (`evil.…`), an added path or port, or a wildcard
  (`https:`, `*`).

The landing-versus-app comparison in `analytics-check.mjs` now imports the same `directives()`.

## D2. Exact marker allowlist

`LEGAL_MARKERS = {'<!--legal-note-->', '<!--storage-inventory-->'}`.
- **Pass-through:** a trimmed line starting with `<!--` passes only if it equals a marker.
- **Failure:** anything else throws `legal: refusing unknown marker line`, the same fail-closed style as the renderer's
  link-scheme refusal. Silently escaping would put stray comment text on a legal page.
- **Coverage:** the real sources (privacy, terms, cookies, supported-devices) still render. A test checks this.

## Risks

- **[A new marker needs a code change]** → intended: raw output must be reviewed.
- **[Changing the fast index origin needs the expected set updated]** → the expected set derives from the same env
  and default as the config; a mismatch fails loudly in verify-build.
