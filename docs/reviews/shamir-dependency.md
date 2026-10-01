# Review: `shamir-secret-sharing` dependency

Change: `add-vault-crypto-core`, task 6.1 (verification) and task 8.3 (independent diff review).

## Pinned version

| Item | Value |
|---|---|
| Package | `shamir-secret-sharing` (Privy, Apache-2.0) |
| Version | `0.0.4`, exact pin, no range |
| npm integrity | `sha512-ui8u/cIg2j16b9on/LH3V/glL6wHdwiTo/Iajzqx0STniBvuOzl6VYUxhrow3waF0dggovJfYiBZSWfTAN4XLQ==` |
| Upstream | https://github.com/privy-io/shamir-secret-sharing, tag `v0.0.4` = commit `b59534d` |
| Tarball vs tag | `src/index.ts`, `src/csprng.ts`, and `src/csprng.node.ts` in the npm tarball are byte-identical to tag `v0.0.4` (checked 2026-10-02) |

## Audits found

Both report links come from the package README.

| Auditor | Dates | Audited commit | Report |
|---|---|---|---|
| Cure53 | Feb 2023 (report dated 2023-04-24) | `3383ad9` (0.0.1-beta.6) | https://cure53.de/audit-report_privy-sss-library.pdf |
| Zellic | 2023-06-27 to 06-29 (final report 2023-08-15) | `cd8422d` (0.0.2) | https://github.com/Zellic/publications/blob/master/Privy_Shamir_Secret_Sharing_-_Zellic_Audit_Report.pdf |

Both PDFs were downloaded and read on 2026-10-02.

### Findings and resolution

| ID | Severity | Summary | Upstream resolution | Status in 0.0.4 |
|---|---|---|---|---|
| Cure53 PVY-01-002 | High | The random polynomial's top coefficient may be 0, so the degree may be below t−1 | `d02a027` forced a nonzero top coefficient (verified by Cure53) | **Reverted** in `3333451` (2025-01-10); see the analysis below |
| Cure53 PVY-01-001 | Info | Suboptimal recovery computation | Fixed, verified | Fixed |
| Cure53 PVY-01-003 | Info | Lookup tables are not cache-side-channel resistant | Fixed, verified | Fixed (JS still gives no constant-time guarantee) |
| Zellic 3.1 | Low | Arithmetic functions lack uint8 input bounds | `1c51059` (0.0.3) | Fixed |

## Coverage of the pinned version

**Neither audit covers 0.0.4 as released.** `git diff v0.0.3 v0.0.4 -- src/` holds exactly two changes:
1. `3333451`, which reverts the PVY-01-002 fix: coefficients are drawn uniformly again, zero included;
2. `955bf20`, which adds a comment documenting that the x-coordinate shuffle is biased.

### Internal analysis (overwatcher decision, option a)

- **Coefficients.** Shamir's perfect secrecy needs the non-constant coefficients to be uniform over the whole field. Then any t−1 evaluations are uniformly distributed whatever the secret is.
  - Forcing a₍t−1₎ ≠ 0 rules out every polynomial whose top coefficient is zero.
  - Given t−1 shares, each candidate secret byte fixes a unique polynomial of degree ≤ t−1 through those points. The candidate whose polynomial has a zero top coefficient is impossible under the forced-nonzero rule.
  - So the "fix" leaks one excluded value per secret byte, and the revert restores the textbook construction.
- **x-coordinate shuffle bias.** The x-coordinates are public in every share encoding, including CryoShield's, so a biased choice reveals nothing about the secret.
- **Our use.** We split only a fresh uniformly random 32-byte data key; the payload is AES-GCM encrypted under it. Every share is AES-GCM wrapped, and the reconstructed key is authenticated by payload decryption. That covers the README's caveats about secret entropy and unverified reconstruction.

Decision: pin 0.0.4. The revert is unaudited and has been reviewed internally only. Task 8.3 asks the security reviewer to confirm this independently.

## Interoperability facts locked by test vectors

- Field: GF(2^8) with reduction polynomial x⁸ + x⁴ + x³ + x + 1 (0x11B, the AES/Rijndael field).
- Library share layout: `y[0..L-1] || x`, so the x-coordinate is the **last** byte, and x ∈ [1, 255], unique per split.
- CryoShield wraps each share as `x || y` (x first), and the adapter converts.
- Randomness consumed by `split(secret, n, t)` in 0.0.4:
  1. 255 bytes for the coordinate shuffle; the i-th share gets the i-th coordinate after the shuffle;
  2. then, for each secret byte in order, t−1 coefficient bytes, from degree 1 upward.

  `test-vectors/v1.json` replays exactly this stream (field `shamirRng`).

## Status

- [x] Audit reports located and read
- [x] Findings and resolutions recorded
- [x] Coverage gap for 0.0.4 escalated; overwatcher chose to pin 0.0.4
- [x] Independent diff review of 0.0.3 → 0.0.4 by the security reviewer (task 8.3): reviewed: APPROVE (see `docs/reviews/vault-crypto-v1.md`)
