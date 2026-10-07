# Spec Delta

## Purpose

Build-time checks for the web app that compare exact tokens, never substrings, and a Markdown renderer that never
emits unreviewed raw HTML.

## ADDED Requirements

### Requirement: Exact connect-src verification
verify-build SHALL parse the production app page's CSP meta tag into directives and SHALL require its `connect-src` to be exactly `'self'`, the origins of the configured RPC, bundler, Turbo upload and Arweave gateway URLs, and the app-only fast index origin. A missing token, a spoofed origin (prefix, suffix, subdomain, path or port), or any unexpected token SHALL fail the build. Origin text elsewhere in the page SHALL NOT satisfy the check.

#### Scenario: Prefix-spoofed origin
- **WHEN** connect-src lists `https://rpc.verify.invalid.evil.com` instead of `https://rpc.verify.invalid`
- **THEN** the check reports the real origin missing and the spoofed one unexpected, and verify-build fails

#### Scenario: Extra source
- **WHEN** connect-src contains every expected origin plus `https:` or `*`
- **THEN** the check reports the extra token as unexpected

### Requirement: Exact build-time markers only
The legal Markdown renderer SHALL emit raw only the exact markers `<!--legal-note-->` and `<!--storage-inventory-->`. Any other line beginning with `<!--` SHALL fail the build; everything else remains HTML-escaped.

#### Scenario: Smuggled markup
- **WHEN** a source line is `<!-- --><script>alert(1)</script><!-- -->`
- **THEN** rendering throws and nothing is written to the page

#### Scenario: Real documents unaffected
- **WHEN** the privacy policy, terms, cookie policy and supported-devices documents are rendered
- **THEN** they render without error, with the known markers in place
