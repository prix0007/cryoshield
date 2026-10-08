# Security policy

CryoShield protects secrets that people cannot afford to lose. It is an open-source project maintained by its
contributors (github.com/prix0007/cryoshield). We take every report seriously and are grateful for
careful, good-faith research.

> **Status:** testnet preview on OP Sepolia, **not independently audited**. There is no paid bug bounty yet.

## How to report

- **Use [GitHub private vulnerability reporting](https://github.com/prix0007/cryoshield/security/advisories/new).**
  Only the maintainers can see the report. CryoShield is an open-source project maintained by its contributors; there
  is no company and no email address.
- Machine-readable contact: [`/.well-known/security.txt`](https://cryoshield.app/.well-known/security.txt) (RFC 9116).

Please include what you found, how to reproduce it, the impact you expect, and whether it is already public. **Never
send real seed phrases, recovery codes, PINs or private keys**, yours or anyone else's. We will never ask for them.

## Scope

In scope:
- the website and vault app at `https://cryoshield.app` (`apps/web`), including its CSP and security headers;
- the contracts in `contracts/` and their deployments (`contracts/deployments/`): `VaultRegistryV2`, the legacy
  read-only `VaultRegistry` (v1), and the `CryoShieldSmartWallet` and its factory (the PIN-enforcing smart account);
- the vault format and cryptography (`packages/vault-crypto`, `docs/spec/vault-format-v1.md`);
- the desktop recovery tool (`tools/recover`);
- abuse of the sponsored network fees (paymaster policy bypass, draining);
- the CI and release pipeline in `.github/` (a path from a pull request to the production site or its secrets).

Out of scope:
- volumetric denial of service, spam, and rate-limit testing against third-party services;
- vulnerabilities in third-party services we do not control (Fly.io, Pimlico, public RPCs, Arweave, Cloudflare), unless
  our integration makes them exploitable: report those to the vendor too;
- social engineering of maintainers, and physical attacks;
- findings that need a compromised device, browser or security key.

## Our commitments

| Step | Target |
|---|---|
| Acknowledge your report | within **72 hours** |
| Triage (severity, affected versions) | within **7 days** |
| Coordinated public disclosure | within **90 days**, or sooner once a fix ships; we agree the date with you |

We will keep you informed, credit you in the advisory and a hall of fame (unless you prefer not to be named), and
tell you if we disagree with your assessment and why.

## Safe harbour

We will not pursue or support legal action against research that:
- is in good faith and within the scope above;
- avoids privacy violations, data destruction and service disruption, and uses only test vaults and test keys you own;
- does not access, modify or retain other people's data beyond the minimum needed to show the issue;
- gives us reasonable time to fix the issue before any disclosure.

If in doubt, ask us first.
