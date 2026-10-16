# Proposal

## Why

Issue [#107](https://github.com/prix0007/cryoshield/issues/107) names two threat-model gaps in the README and asks
for one addition, all before "security people find them":

1. **The RP ID binding is undocumented.** A WebAuthn PRF output is bound to the RP ID, so the recovery path has to
   present the same RP ID through CTAP2 `hmac-secret` once the site is gone. The README does not say that, which
   library does it, or that it works with the site offline. Without that, the recovery story looks as if it rests on
   a domain the project may not control forever.
2. **Sponsored gas is a one-company dependency,** exactly the kind the project says it avoids. If sponsorship stops,
   writes stop while reads survive. The README has no caveats section that says so.
3. **A recovery drill.** A reader can repeat a ten-minute drill, with the website blocked in their hosts file, that
   ends with the decrypted secret on screen. Readers in this space trust a documented drill more than a security
   section, and it doubles as the check the maintainer runs before every release.

The issue also asks which library the CLI uses for `hmac-secret`: python-fido2 (`fido2>=2.0,<3`,
`tools/recover/pyproject.toml`; `HmacSecretExtension` in `tools/recover/src/cryoshield_recover/authenticator.py`).

The README's status line is also stale: it still says "testnet only (OP Sepolia)" although `v1.0.0` went live on
OP Mainnet at https://cryoshield.app on 2026-10-12 (`docs/reviews/launch-op-mainnet.md`).

## What Changes

- **README.md**
  - the status line and the intro bullet say OP Mainnet is live, where the testnet preview is, and point to the
    Security section for the audit status;
  - a new **Recovery drill** section: prerequisites, seven numbered steps with the real commands, what the drill proves
    and what it does not, and that the maintainer runs it before every release;
  - a new **What CryoShield depends on** section: why the vault is bound to the RP ID `cryoshield.app` and not to the
    website (the tool presents the RP ID with python-fido2, offline, and never contacts the site), the residual
    phishing risk if the domain changes hands, the gas-sponsorship caveat (Pimlico is the one company in the write
    path; writes stop, reads and recovery survive), and a table of every remaining dependency;
  - "If you need your vault" links the drill.
- **tools/recover/tests/test_root_readme.py** (written first): every `cryoshield-recover` command in the root README
  parses with the real argument parser; the RP ID named is the tool's `DEFAULT_RP_ID`; the library named is
  python-fido2; the sponsorship caveat quotes the app's "Saving is paused" message; the drill blocks the site before
  `show`; the status line no longer says testnet-only.
- **docs/launch/mainnet-release-checklist.md** 8.4 and **tools/recover/README.md** point at the drill.

## Out of scope

- Any change to the recovery tool's behaviour, flags or defaults.
- The "Known vulnerabilities" subsection (owned by `add-trivy-scan` and its follow-up).
- The website's copy, `/architecture` or `llms.txt`.
- A new page on the site for the drill; GitHub renders the README, and the drill is for people who already have the
  repository or the tool.

## Runtime dependencies

None. This change adds documentation and one test. It adds no runtime piece and no CryoShield-operated backend.

## Capabilities

### New Capabilities
- `project-readme`: what the repository README must say about the live status, the RP ID binding, the dependency
  caveats and the recovery drill, and how that text is kept tied to the tool.

## Impact

- **Changed:** `README.md`, `docs/launch/mainnet-release-checklist.md` (one line), `tools/recover/README.md` (one
  line).
- **New:** `tools/recover/tests/test_root_readme.py`, this change.
- **CI:** the new test runs with the `recover` job, which runs when `tools/recover/**` changes and on every full CI
  run (every merge, through the deploy pipeline). A README-only PR does not run it; design.md D4 explains why that is
  accepted.
- **Issue:** #107 gets a reply naming the library and linking this PR.
