# Security review: add-donation (address-swap threat model)

The CryoShield security reviewer looked at branch `feat/donation`.

**Verdict: APPROVE WITH NITS.** All findings are addressed in this PR.

## What was confirmed

- **Single source:** `config/donation.json`. `loadDonation` enforces exact EIP-55 casing, chain 1 and ETH. The value
  is pinned in a unit test, and the README must carry the same address and no other.
- **`/support`:**
  - the CSP and Trusted Types are unchanged (equal to `/app`);
  - one same-origin script, with no `window.ethereum`;
  - Copy uses `textContent` only;
  - no analytics, cookies or storage.
- **Dependencies:** the QR is built at build time. `qrcode-generator` and `jsqr` are not in the shipped assets (checked
  in a build).
- **Landing sheen:** a lazy, same-origin `motion/mini` chunk with no URLs, off under reduced motion.
- **Legal and privacy:** the statements are accurate.
- **Tests:** 30 targeted tests passed in the reviewer's run.

## Findings and resolutions

- **MEDIUM: the QR test ignored shapes other than modules.** **Resolution:** the built `/support` must contain exactly
  one QR SVG, and it must equal `qrSvg(URI)` byte for byte. It's still decoded back to the URI.
- **LOW: the anti-swap check skipped some forms.** It skipped CSS and SVG files, addresses split by tags or written as
  entities, and upper-case or entity-encoded `ethereum:` URIs. **Resolution:** it now scans HTML, JS, CSS and SVG;
  matches URIs case-insensitively with an encoded colon; and checks `/support`'s tag-stripped, entity-decoded text.
  Tests were added for each case.
- **LOW: a tampered page could link to a fake README.** **Resolution:** the page now tells donors to type
  `github.com/prix0007/cryoshield` themselves.
- **LOW: the deploy smoke test didn't check the live address.** **Resolution:** `smoke.sh` now requires
  `DONATION_ADDRESS` (exported from `config/donation.json` in the deploy workflow). The live `/support` must show it
  exactly (case-sensitive) and no other address. Tests were added.
- **INFO: string replacements honoured `$` patterns.** **Resolution:** they now use replacer functions.

## Residual risk

- Malware on a donor's device that rewrites the clipboard can't be prevented by the site. The page tells donors to
  verify what they paste against the README.
- Changing the address needs a deliberate commit to the config, the README and the pinned test, and review sees all
  three.
