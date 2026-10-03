# Security review: add-privacy-and-compliance (P1 deliverables as shipped)

- **Date:** 2026-10-03
- **Reviewer:** frontend-engineer. This self-review is recorded for task 9.1; an independent security-reviewer pass is
  still recommended before launch.

**Verdict: APPROVED for the testnet launch. No CRITICAL or HIGH findings.**

| # | Area | Evidence | Result |
|---|---|---|---|
| 1 | Accuracy of security claims on `/privacy`, `/terms`, `/cookies` | Each claim checked against code and specs: "we never see your secrets/keys/PRF output" (encryption in `vault-crypto`, PRF wipe tests); "no request logs" (container test: 100 distinct IPs, UAs, referrers and query strings leave no trace; no `log` directive); "no cookies or storage" (bundle scan + E2E sweep of every route incl. create/unlock); "AES-256-GCM", "testnet, not independently audited" (true); permanence and crypto-shredding wording matches vault-format v1 and EDPB 02/2025 para 51 ("until the algorithm is broken"). Cloudflare's own claims are attributed to Cloudflare, not asserted by us. A wrong claim ("WebCrypto") was not reintroduced: the policy names @noble. | Pass |
| 2 | CSP and header regressions | The app CSP is unchanged. Legal pages carry the app CSP (build test + container test), load no script and make only same-origin requests (E2E). security.txt is served as `text/plain; charset=utf-8` with all headers. | Pass |
| 3 | Build-time Markdown renderer | Build-time only, no new dependency. All text is HTML-escaped. Link targets are allowlisted (`https://`, `/`, `#`, `mailto:`), otherwise the build fails. External links get `rel="noopener noreferrer"`. No raw HTML passthrough except the fixed `<!--storage-inventory-->` marker. | Pass |
| 4 | Acknowledgement | Component state only. No storage, cookie or request field (unit spies + E2E). It gates Save, and Enter-to-submit is gated too. No bundler/paymaster/Turbo request is made before both boxes are ticked (E2E request log). | Pass |
| 5 | Inventory integrity | `verify-build` fails on a CSP origin missing from `docs/compliance/origins.json`, and on any bundle that starts using a storage API not listed in `legal/storage-inventory.json`. | Pass |
| 6 | Abuse paths (design D14) | Fake erasure or grievance requests: the privacy policy says we never ask for keys, secrets or PINs, and cannot act on a vault. Phishing clones: security.txt `Canonical`. Expiry: build guard (Expires ≤ 365 days, not past). | Pass |
| 7 | Write-failure reference (sibling change `improve-write-failure-feedback`) | See `security-review-write-feedback.md`. | Pass |

## Findings

- **LOW-1 (resolved by `adopt-oss-project-defaults`: no mailbox; GitHub only):** `security@cryoshield.app` is listed in security.txt but the mailbox does not
  exist yet. Mitigation: the GitHub private-report link is listed second and is the preferred channel in SECURITY.md.
  Create the mailbox before launch.
- **LOW-2 (resolved: private vulnerability reporting enabled 2026-10-03):** GitHub private vulnerability reporting must be enabled in the repository settings for
  the advisory link to work.
- **INFO (updated by `adopt-oss-project-defaults`):** placeholders were replaced with open-source-project defaults;
  each page carries a "not legal advice" note, and the build now fails on any leftover placeholder or
  `@cryoshield.app` address.
