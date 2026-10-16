# Design

## Decisions

### D1. Two sections, after "How it works"
The README is the project's front page. The crisis section "If you need your vault" stays near the top and links the
drill. The drill and the dependency caveats come after "How it works", so a reader meets the architecture before the
threat-model notes, and before the development material that most readers skip.

The dependency section is called "What CryoShield depends on" rather than "Caveats", because every row says what
breaks and what survives; that is the question the issue asks.

### D2. What the README claims, and where each claim comes from

| Claim | Source |
|---|---|
| The PRF output is the key's `hmac-secret` over a salt, scoped to one RP ID | WebAuthn PRF extension; CTAP 2.1 `hmac-secret`; `docs/spec/vault-format-v1.md` §3 |
| The tool presents the RP ID through python-fido2's `prf` extension over `hmac-secret`, with UV always | `tools/recover/src/cryoshield_recover/authenticator.py` (`HmacSecretExtension(allow_hmac_secret=False)`, `require_user_verified`); `vault-recovery` "CTAP2 PRF evaluation" |
| The salt mapping equals the browser's | `authenticator.py` module docstring, pinned by a test; cross-implementation vectors `packages/vault-crypto/test-vectors/` |
| The tool never contacts `cryoshield.app` | the only occurrence of the domain in `tools/recover/src` is the `DEFAULT_RP_ID` constant (`config.py`); `vault-recovery` "Infrastructure independence" |
| The vault records its RP ID; with `--vault-id` or `--blob-file` the tool tries the configured RP ID first, then the RP IDs recorded in the copies it found, one tap each (never the vault's first: a candidate's RP ID is attacker-influenced) | `vault-format-v1.md` header fields 9–10; `recover.py` `_rp_id_order`; `vault-recovery` "Safe RP ID choice" |
| `--testnet` selects the chain only; the development site has its own RP ID (`cryoshield-web-dev.fly.dev`), so a vault made there needs `--rp-id` too | `cli.py` `--testnet`; `CLAUDE.md` → Deploy ("Its RP ID is that host") |
| The quoted sponsorship messages are the app's `paused` and `pausedCreate` strings | `apps/web/src/ui/strings.ts` |
| The checksum checks integrity only; `gh attestation verify` checks the release workflow built the file | `tools/recover/README.md` "Verifying a download" |
| The key refuses without user verification | credProtect level 3 at enrolment (`enforce-credprotect-uv`); `authdata.py` |
| Pimlico is the bundler and paymaster; there is no unsponsored fallback; "Saving is paused" message | `docs/system-design.md` ("Writes go through Pimlico"); `sponsored-vault-writes` "Cap reached" scenario; `apps/web/.env.example` |
| Reads, unlocks and recovery never touch Pimlico or Fly | `docs/system-design.md` ("Reads, unlocks and recovery never touch Pimlico or Fly") |
| Three public RPCs per network, `--rpc` override, Arweave fallback, `--offline` from a file | `tools/recover/README.md` "Networks", "Other ways in"; `vault-recovery` "Built-in defaults with overrides" |
| `v1.0.0` live on OP Mainnet on 2026-10-12; the founder unlocked a vault with the tool | `docs/reviews/launch-op-mainnet.md`; `gh release view v1.0.0` (published 2026-10-12T20:57:05Z) |

Deliberately **not** claimed: how long the public RPCs or Arweave gateways will exist; that a chain shutdown leaves
the data on L1 (blob data expires); any PIN-attempt count; that CryoShield can recover anything.

### D3. The drill
- **Hosts file, not airplane mode.** The issue asks for the site blocked in the hosts file, which keeps the public
  RPCs reachable and proves the point that matters: the tool needs the chain, not the site. Step 6 is the optional
  fully-offline variant (`--save-blob`, then `--blob-file … --offline` with the network off).
- **Throwaway vault.** Step 5 prints the secret and the terminal keeps scrollback, so the drill tells readers to use
  a test vault. The clean-up step says to close the terminal, as `tools/recover/README.md` "Security notes" does.
- **Real commands.** The commands are the single-file macOS arm64 program, as in the tool's README; the same flags
  apply to every platform. The test parses each of them with the real parser, so a renamed flag breaks the drill in
  CI rather than for a reader.
- **Verification that the block took effect.** `curl --max-time 5 https://cryoshield.app` must fail to connect, after
  a DNS cache flush on macOS and Windows. Browsers cache DNS too, so the drill says the page must not load either.
- **Before every release.** The checklist already has the founder's recovery checks (3.2, 7.2, 8.4). 8.4 now names
  the README drill, so the monthly check and the drill are the same procedure.

### D4. The test lives in the recovery tool's suite
`tools/recover/tests/test_root_readme.py` imports the parser, `DEFAULT_RP_ID` and `TESTNET`, so the README can only
name flags and an RP ID that exist. That makes it a recovery-tool test, next to `test_readme.py`, which does the same
for the tool's own README.

The `recover` CI job runs on `tools/recover/**` changes, on push to `main` and on every full run (every merge,
through `deploy-dev.yml`), not on a README-only PR. Accepted: a README-only PR that breaks a drill command is caught
by the deploy pipeline's full CI on the merge commit, which fails the dev deploy and is fixed forward. Adding
`README.md` to the `recover` path filter is a `.github/workflows/` edit, which agents cannot push; it is noted as an
owner option, not required.

### D5. Status wording
The footer legal line on every page says "not independently audited" (`trim-landing-cta-audit-note`). The README's
Security section already says "There is no external audit". The status line now says "No external audit: see
Security", so the README has one audit statement, in one place, and the status line carries the facts that changed:
OP Mainnet live since `v1.0.0` on 2026-10-12, and where the testnet preview is.

### D6. ECC review follow-ups (review of #109, d1c24c3)
All nine advisory findings were applied: the RP ID precedence sentence now matches `_rp_id_order`; the `--testnet`
line says it covers pre-launch vaults made on `cryoshield.app`, and vaults from the development site get
`--rp-id cryoshield-web-dev.fly.dev`; step 6 says to keep the step-3 flags; the sponsorship paragraph quotes the
app's `paused` and `pausedCreate` strings exactly, and the test reads them from `strings.ts`; step 1 adds
`gh attestation verify` and says what the checksum does not prove; the command test calls `config_from_args`
without a `try`, in a temporary directory, replaces only `<vault-id>` and fails on any other placeholder, asserts
the parsed network, offline, blob and vault-ID fields, reads with `encoding="utf-8"`, and the dead `TESTNET`
clause is gone. The optional suggestions were taken too: an `::1` hosts line, a no-count PIN-lock warning, and
"stop using `cryoshield.app` at all" once the project ends. A CodeQL alert on the test's `"https://cryoshield.app"
in text` assertion (URL-substring sanitisation pattern, a false positive in a test) is avoided by matching the
whole status line with an anchored regular expression.

## Security review (2026-10-16)

Scope: documentation only; no code, CI or configuration change beyond one test file.

- **Social-engineering surface:** the drill never asks for a seed phrase, recovery code, PIN or key, names no
  third-party site to paste secrets into, and tells readers to use a throwaway vault. **Pass.**
- **False comfort:** every claim is in D2 with its source; the "What it does not prove" list and the phishing
  paragraph (a future owner of the domain can run a site under the RP ID; the key still needs the PIN; never present a
  CryoShield key to a site you did not verify) state the residual risks rather than hide them. **Pass.**
- **Accuracy drift:** the test fails if a drill command stops parsing or an unknown placeholder appears, if the RP
  ID or the testnet preset change, or if the two quoted sponsorship messages no longer equal the app's `paused` and
  `pausedCreate` strings, which it reads from `apps/web/src/ui/strings.ts`. **Pass.**
- **Secrets in the diff:** none; the vault ID in the drill is a `<vault-id>` placeholder. **Pass.**

No findings.
