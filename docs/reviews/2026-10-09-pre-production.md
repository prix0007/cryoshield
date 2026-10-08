# Pre-production security review (2026-10-09)

**Subject:** releasing `main@7cf8fd8` to https://cryoshield.app with the `production-build` parameters (OP Sepolia,
chain 11155420, RP ID `cryoshield.app`). Live production at the time of review was `f06ccb9` (v1 registry only).
**Date:** 2026-10-09 · **Reviewers:** security-reviewer agents, two read-only passes (release path and hosting; chain,
paymaster, WebAuthn and recovery parameters) · **External audit:** none.

**Verdict: APPROVE the release to cryoshield.app on OP Sepolia**, conditional on the founder-only items in M1 and
F1 being done and recorded **before** `gh release create`. No CRITICAL or HIGH finding. **This is not a mainnet
approval:** `harden-gas-sponsorship` 8.x and `launch-op-mainnet` stay gated.

## Scope and method

Read-only. No secret value and no `.env` file was read or printed, and the Pimlico key was never handled (a stub key
was used for builds). Nothing was written to any chain.

| Area | What was checked |
|---|---|
| Release path | `deploy.yml`, `deploy-dev.yml`, `release-ref.sh`, `smoke.sh`, rulesets, environments (GET-only `gh api`), workflow policy, artifact hand-off |
| Supply chain | action SHA pins, flyctl and Caddy pins, permissions, `persist-credentials`, `${{ }}` in `run:` |
| Hosting | `fly.toml`, Dockerfile, live headers on `/`, `/app/` and 404, redirects, TLS, `/release.json`; DNS and registrar via DoH and RDAP; `fly tokens list` / `fly ips list` (ids only) |
| Build configuration | `production-build` parameters, CSP `connect-src`, negative builds (wrong RP ID, wrong chain) |
| Contracts | `contracts/script/check-deployments.sh 11155420` (online), Blockscout verification, owner/proxy slots, `RP_ID_HASH()`, `entryPoint()`, `forge test` |
| Paymaster | how sponsorship requests are built, what the public key allows, the runbook's live columns |
| WebAuthn and crypto | PRF salt, HKDF, AES-GCM nonces and AAD, UV, credProtect, resident key, ES256, test-vector regeneration |
| Recovery tool | defaults, registries, a live v2 read with the tool's own code, the offline suite |

**Test evidence at the time of review:** `forge test` 143 passed, 6 skipped (ERC-7562 trace tests, known C4);
`pnpm -C packages/vault-crypto test` 351 passed, 2 failed for a local venv only (F6), and vectors regenerate
byte-identically in a fresh hash-pinned venv; `pnpm -C apps/web test` 1336/1336 and `test:deploy` 122/122;
`tools/recover` 882 passed, 5 skipped; `openspec validate --all --strict` 36/36. Live: every OP Sepolia deploy
transaction, address and runtime code matches the deployment record; all six contracts are source-verified; the
v2 vault `0x94a6…5e87` written by the dev build reads back CURRENT on 3/3 RPCs.

## What was verified OK

- **Release path.** Production secrets are reachable only through a `v*` tag: both production environments accept
  only `v*` tags, no branch, no admin bypass. Tag creation is admin-only and the only collaborator is the owner.
  `deploy.yml` runs only for the owner at a `refs/tags/v*` ref; every later job depends on it. `release-ref.sh`
  re-checks the tag right before `fly deploy`. `FLY_API_TOKEN` appears only in the `deploy` and `rollback` steps.
- **Supply chain.** Every third-party action is SHA-pinned, flyctl is pinned by version and SHA-256, the Caddy image
  by digest. Default token `read`; every job has its own permissions and timeout; no `${{ }}` inside any `run:`.
- **Hosting.** Strict CSP with Trusted Types and `frame-ancestors 'none'`, XFO DENY, HSTS preload, COOP/CORP
  same-origin, `Referrer-Policy: no-referrer`, nosniff. The Permissions-Policy split is correct live: no WebAuthn on
  `/`, WebAuthn (self) on `/app/`. HTTP, `www` and `cryoshield-web.fly.dev` all 301 to the apex. TLS 1.2 and 1.3
  only. Not proxied by Cloudflare (no `cf-ray`). `/release.json` holds only public data.
- **Contracts.** Records match the chain; no owner, no proxy admin; implementations are locked; `RP_ID_HASH` is
  `sha256("cryoshield.app")` for production and the dev host for dev; EntryPoint v0.6. A production build cannot
  select the dev factory, and the dev implementation would reject every production assertion anyway.
- **WebAuthn and crypto.** UV required and checked on every response; credProtect 3 enforced; ES256 only; RP ID equals
  the host; vectors agree across TypeScript, Solidity and Python. The blob stays ≤ 1 KB (live v2 blob 442 bytes) and
  holds no plaintext, PRF output or key.
- **Recovery tool.** Defaults point at OP Sepolia v2 then v1, and it reads main's v2 output live.

## Findings

Severity is as reported. **Owner:** *founder* = dashboard or account action only the founder can take; *code* = a
PR. **Status** is as of this record's PR; branches named below are committed but not yet merged.

### Release path and hosting

| # | Sev | Finding | Owner | Status |
|---|---|---|---|---|
| M1 | MEDIUM | DNS is on **Cloudflare** nameservers (registrar GoDaddy), not GoDaddy as the runbook said. **DNSSEC is not in effect** (zone signed, no DS at the registry). **CAA is Cloudflare's default five-CA set** for `issue` and `issuewild`, not Let's Encrypt only with no wildcards. Anyone who can forge DNS answers or obtain a certificate from any of five CAs could serve a phishing page on the RP ID. | founder (Cloudflare, GoDaddy) + docs | **Docs fixed in this PR** (`apps/web/deploy/README.md` section 4: Cloudflare DNS-only, the two CAA records, DNSSEC in Cloudflare plus a DS at GoDaddy; `docs/system-design.md` no longer claims DNSSEC/CAA are on). **Founder action open:** enable DNSSEC and add the DS, replace the CAA set, hardware-key 2FA on Cloudflare. |
| M2 | MEDIUM | Pimlico dashboard limits not recorded as applied, while the key and policy id ship in the public bundle by design. | founder + docs | Same as F1 below. |
| M3 | MEDIUM | The tag boundary relied on two `v*` patterns (ruleset and environment) never shown to match the same names. Not exploitable today (no Write collaborator). | code + founder apply | **Code on branch `ci/release-path-hardening`** (change `harden-release-path`): ruleset include `~ALL`. **Founder:** after merge, `.github/rulesets/apply.sh --with-ecc-review --environments --apply`; once the machine account exists, a push of `refs/tags/probe-1` by it must be refused. |
| L1 | LOW | Repository-level `sha_pinning_required` is off (every workflow is pinned anyway). | founder | Open: `apply.sh --founder-hardening --apply`, then confirm a dev deploy still runs. |
| L2 | LOW | Dependabot security updates off (alerts on). | founder | Open (same command as L1). |
| L3 | LOW | Secret scanning: non-provider patterns and validity checks off (scanning and push protection on). | founder | Open. |
| L4 | LOW | The release job verified the artifact only against the manifest inside the same artifact. | code | **Code on branch `ci/release-path-hardening`:** hashes cross jobs as build-job outputs; release and smoke compare against them. |
| L5 | LOW | The smoke test did not assert the Permissions-Policy split. | code | **Code on branch `ci/release-path-hardening`.** |
| L6 | LOW | The live production Fly token is named `flyctl deploy token` and expires **2027-10-05**; the runbook named it `github-actions-deploy`. | founder + docs | **Docs fixed in this PR** (`docs/deploy.md`: live name, expiry, rotate before 2027-10-05). Founder: calendar the rotation. |
| L7 | LOW | Runbook drift: DNS provider, `www` described as a CNAME to `fly.dev` (it is a CNAME to the apex, and Caddy 301s it), `dev.cryoshield.app` cleanup still listed as to-do (it is NXDOMAIN). | docs | **Fixed in this PR.** |
| I1–I4 | INFO | Fly's `Server` header (cannot be removed); root static files use ETag only; the public keyless RPC is rate-limited; a rollback by tag runs that tag's workflow file. `security.txt` expires 2027-09-30, two days before the domain (2027-10-02): renew both before September 2027. | n/a | No action, noted. |

### Chain, paymaster, WebAuthn, recovery

| # | Sev | Finding | Owner | Status |
|---|---|---|---|---|
| F1 | MEDIUM | **Production sponsorship limits and key restrictions are unverified.** The key ships to every visitor and Pimlico policies cannot restrict targets, so the dashboard settings are the only server-side control. Without a global daily cap, an origin restriction, or with policy-less sponsorship allowed, a script can exhaust the budget and every user sees "Saving is paused" (availability only). | founder + docs | **Open, blocks the release.** `apps/web/docs/paymaster-policy.md` section 3 now lists the recommended production values in every pending row; the founder confirms them in the dashboard and records them with the date (tasks `harden-gas-sponsorship` 1.1, 1.2). |
| F2 | LOW | No recorded end-to-end run through the hosted bundler with real keys (sponsored create/edit/add-key, the UV=0 refusal, the hardware checklist, the founder's vault on v2). | founder + fe/sol | **Open, not yet recorded.** Run `apps/web/docs/hardware-test.md` on dev now, and one create + unlock on cryoshield.app right after the release; record receipts (tasks 6.2–6.4). |
| F3 | LOW | Two legacy v1 vaults on Coinbase Smart Wallet v1.1 accounts (created 2026-10-03T22:06Z and 2026-10-05T21:02Z; owners `0xce16…448e`, `0xaf8a…93fe`) keep a write path that checks neither UV nor rpIdHash. The first predates credProtect enforcement, so a key thief **without the PIN** might overwrite or brick it (not decrypt it). | founder + docs | **Docs: named in the `harden-gas-sponsorship` review residuals (this PR).** Founder: task 6.4, treat both as disposable. |
| F4 | LOW | The only live recovery-tool check (`tests/test_live_op_sepolia.py`) used removed preset fields and failed with `AttributeError`. | code | **Code on branch `fix/recover-live-test-registries`** (change `fix-recover-live-test`): checks v2 and v1 live, plus an always-run offline test. |
| F5 | LOW | `launch-op-mainnet` said the mainnet per-sender cap is **lifetime**; the approved `harden-gas-sponsorship` design D2 (and its review P5) says **monthly**, so long-lived users are never locked out. | docs | **Fixed in this PR**: `launch-op-mainnet` proposal, design and task 1.2 now say monthly, with a note. That change is a pending plan; the approved design was not touched. |
| F6 | INFO | The local `packages/vault-crypto/scripts/.venv` lacks pycryptodome, so two regeneration tests fail locally; CI enforces the environment. | developer | Noted (`uv pip install --require-hashes -r packages/vault-crypto/scripts/requirements.txt`). |
| F7 | INFO | `contracts/deployments/README.md` said v2 on OP Sepolia exists "once the owner broadcasts". | docs | **Fixed in this PR.** |

## Residual risks (stated before production)

1. **Testnet only.** Production runs on OP Sepolia: the chain can be reset or deprecated, RPC and sequencer
   availability is best-effort, and nothing has economic finality. Users must be told vaults are a testnet preview.
   The v1 and v2 addresses will not exist on OP Mainnet (v1 never will).
2. **No external audit.** Assurance rests on audited libraries (WebCrypto, `@noble/*`, vendored CBSW v1.1), the
   published spec and cross-implementation vectors, internal reviews, and this review.
3. **A public bundler key, bounded only by Pimlico policy caps.** The key is in the `/app` bundle by design. Abuse is
   bounded only by the dashboard settings (F1: chain allowlist, per-operation and global daily caps; the prepaid
   balance if a request can skip the policy) and can pause all saving. No vault's confidentiality or integrity
   depends on it. Until F1 is recorded, even that bound is unconfirmed.
4. **Pimlico is a single provider for writes.** An outage means "Saving is paused". Reads and recovery need neither
   CryoShield nor Pimlico.
5. **The Arweave mirror is best-effort.** Uploads go through Turbo with an ephemeral signer and can fail; anyone can
   publish items with CryoShield tags, so the mirror can serve stale or foreign blobs. The vaultId in the AAD rejects
   clones, and the recovery tool classifies staleness against chain history, but with the chain unavailable the
   newest Arweave copy is not provably current.
6. **Archive and clear does not erase.** Earlier blobs stay in chain history and on Arweave, readable with any one
   enrolled key and its PIN.
7. **Quantum.** Vault ciphertext is symmetric-only. The accounts' P-256 keys authorise writes only, so a quantum
   attacker could overwrite, not decrypt.
8. **Hardware assumption.** Confidentiality rests on the authenticator releasing `CredRandomWithUV` only after user
   verification. Attestation is `none`, so "hardware key" is enforced in practice by the credProtect-3 confirmation,
   not by attestation.
9. **Locators link vaults** created with the same credential (public and stable per credential).
10. **The two early v1 vaults (F3)** keep the CBSW write path that does not check UV; they are disposable test data.
11. **F2 is not yet recorded:** the production policy has never sponsored a `CryoShieldSmartWallet` operation, and the
    UV=0 refusal through Pimlico's simulation is unrecorded.
12. **DNS (M1) until the founder acts:** without DNSSEC and with a five-CA CAA set, the RP ID's DNS and certificate
    trust is weaker than the design assumes.

## Before `gh release create` (founder checklist)

- [ ] M1: DNSSEC enabled in Cloudflare and the DS added at GoDaddy; CAA reduced to the two records; hardware-key 2FA on
      Cloudflare. Verify with the commands in `apps/web/deploy/README.md` section 5.
- [ ] F1: production policy and key confirmed and recorded with the date in `apps/web/docs/paymaster-policy.md`
      sections 3 and 4.
- [ ] After the release: one create and unlock on cryoshield.app, recorded (F2).
- [ ] After `harden-release-path` merges: `apply.sh --with-ecc-review --environments --apply` (M3).

Source reports: the two reviewers' working reports (release path and hosting; chain and parameters), not committed;
every finding they contain is summarised above, and they hold no secret values.
