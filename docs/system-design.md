# CryoShield system design

How a secret travels from your browser to permanent storage and back, which parts CryoShield runs, and how code reaches production.

> **Status:** OP Sepolia testnet, not independently audited. Mainnet will be OP Mainnet.
> Last updated 2026-10-05. Normative details live in `openspec/specs/` and `docs/spec/vault-format-v1.md`; this page is the map.

## 1. Components and trust boundaries

CryoShield operates exactly one thing: a static website on Fly. Everything else runs on your device, or is third-party or public infrastructure that never sees a plaintext secret.

```mermaid
flowchart LR
  subgraph device["Your device"]
    keys["Security keys (2+ YubiKeys)<br/>PRF secret + P-256 signer, UV required"]
    web["Web app (/app in browser)<br/>encrypts/decrypts locally, AES-256-GCM"]
    cli["cryoshield-recover (CLI)<br/>works if CryoShield is gone"]
  end

  subgraph third["Third-party infrastructure"]
    fly["Fly.io · cryoshield.app<br/>static files only, the one thing we run"]
    pimlico["Pimlico<br/>bundler + paymaster under our sponsorship policy (we pay gas)"]
    rpc["Public RPCs<br/>2+ must agree for recovery"]
    gw["Arweave gateway / Turbo<br/>free upload ≤105 KiB · GraphQL"]
  end

  subgraph public["Public and permanent"]
    ep["EntryPoint v0.6"]
    sw["CryoShield Smart Wallet<br/>CBSW v1.1 code + PIN (UV) and RP ID required"]
    reg["VaultRegistry v2<br/>no admin, no upgrades<br/>blob ≤1 KB · locator → vaultIds (paged, no cap)"]
    reg1["VaultRegistry v1 (testnet only)<br/>legacy, read-only"]
    ar["Arweave permaweb<br/>mirror tagged by vaultId + locator"]
  end

  fly -- "serves HTML/JS" --> web
  keys <-- "WebAuthn: PRF + signature" --> web
  web -- "signed userOp" --> pimlico
  pimlico -- "handleOps" --> ep
  ep -- "validates key signature" --> sw
  sw -- "createVault / updateVault" --> reg
  web -- "eth_call" --> rpc
  rpc -- "reads" --> reg
  rpc -- "legacy reads" --> reg1
  web -- "mirror upload" --> gw
  gw -- "stores" --> ar
  cli <-- "CTAP2 hmac-secret over USB" --> keys
  cli -- "eth_call + logs" --> rpc
  cli -- "GraphQL by tag" --> gw

  classDef ours fill:#e6f0fa,stroke:#0066cc,color:#0066cc;
  class fly ours;
```

- **Writes** go through Pimlico because CryoShield sponsors gas, always under our sponsorship policy (limits per sender, per operation and per day; `apps/web/docs/paymaster-policy.md`). CryoShield runs no paymaster, webhook or proxy. The client allowlist only lets a sponsored operation call VaultRegistry v2 (or the account itself, to add an owner) with `value == 0`. If sponsorship is refused, nothing is sent and the app says "Saving is paused"; there is never an unsponsored fallback.
- **Abuse can only exhaust the gas budget.** A script making fresh accounts is bounded by the policy's daily global cap; a script skipping the policy (if Pimlico allows it) by the prepaid balance, with no overdraft. Neither can read, change or block any vault.
- **Reads, unlocks and recovery** never touch Pimlico or Fly. The recovery tool talks to the key over USB and reads the chain or Arweave directly, so it keeps working if the website, the domain or the company disappears.
- **The domain** `cryoshield.app` is the permanent WebAuthn RP ID. Losing control of it would let an attacker prompt users' keys in a browser. It is protected by DNSSEC, a CAA record (Let's Encrypt only), HSTS preload and registrar lock. The desktop tool is unaffected, because it is not bound by browser origin checks.

## 2. From one key tap to your secret

Each tap returns one 32-byte PRF output for a fixed global salt. Two independent keys are derived from it: one is public (the lookup), and one never leaves memory (the wrap key).

```mermaid
flowchart LR
  prf["PRF output<br/>32 bytes, UV required"]
  h1["HKDF-SHA256<br/>info cryoshield/v1/locator"]
  h2["HKDF-SHA256<br/>salt = vault wrapSalt<br/>info cryoshield/v1/wrap"]
  loc["Locator<br/>bytes32, public"]
  look["resolveLocator → vaultIds<br/>try each, keep the one that authenticates"]
  wk["Wrap key<br/>memory only, wiped"]
  dek["Data key<br/>unwrapped"]
  sec["Your secrets<br/>decrypted locally"]

  prf --> h1 --> loc --> look
  prf --> h2 --> wk -- "AES-256-GCM unwrap" --> dek -- "AES-256-GCM decrypt" --> sec
```

- **Symmetric only.** The ciphertext stays public forever, so it has no elliptic-curve layer that a future quantum computer could strip.
- **One wrap per key.** Every enrolled key wraps its own copy of the data key. Losing one key loses nothing. Losing every key loses the vault, and nobody can reset it.
- **Clone-proof.** The AAD binds the vault header and the 32-byte `vaultId`. A blob copied under any other vaultId fails to authenticate and is skipped.
- **UV is mandatory, and the key enforces it via credProtect level 3.** hmac-secret returns different outputs with and without user verification. Without UV, browser and desktop could derive different keys.
  - Every key is enrolled with credProtect level 3 (`userVerificationRequired`, requested with enforcement and confirmed from the authenticator data). A stolen key will not produce *any* assertion without its PIN, even though credential IDs are public.
- **The account enforces it too (audit AA-H1).** `CryoShieldSmartWallet` is the Coinbase Smart Wallet v1.1 code with two changes. Every signature it accepts (user operations, the cross-chain owner path, ERC-1271) must carry the UV flag and `sha256(rpId)` of its RP ID, and owners are P-256 keys only, at most 8. New accounts come from our own factory, one per RP ID; there is no admin key.
  - Keys enrolled before this rule must be re-created; that is only the founder's test vault.
  - A contract-level validator that checks UV, rpId and origin is planned, and it is a hard gate for mainnet. It also closes the U2F/CTAP1 path, where a key that accepts a CTAP2 credential ID over U2F could sign without its PIN.
- **Desktop salt mapping.** CTAP salt = `SHA-256("WebAuthn PRF" || 0x00 || input)`. This lets the browser and the desktop tool derive identical outputs.

## 3. Create a vault

```mermaid
sequenceDiagram
  autonumber
  actor U as You
  participant K as Security keys
  participant W as Web app
  participant P as Pimlico
  participant C as OP Sepolia (EntryPoint → Smart Wallet → VaultRegistry)
  participant A as Arweave

  U->>K: Tap key 1, then key 2
  K-->>W: Discoverable credential + PRF output + P-256 public key (each)
  W->>W: assertUserVerified; account address from our factory; random salt
  W->>W: vaultId = keccak256(account, salt), checked with the registry; encrypt secret; wrap data key per key
  U->>K: One more tap
  K-->>W: Signature over the userOp
  W->>P: eth_chainId guard, then sponsored userOp
  P->>C: handleOps → account checks UV + rpIdHash → createVault(salt, blob, locators)
  W->>A: Upload blob, tags CryoShield-Vault-Id + CryoShield-Locator
  W->>W: Zeroize PRF outputs and keys
```

- **No front-running failures (VaultRegistry v2).** The registry derives the vaultId from the account address, so copying a pending create gives the copier a different id, and locators have no entry cap, so filling one cannot block a registration.

## 4. Unlock or recover

```mermaid
sequenceDiagram
  autonumber
  actor U as You
  participant K as Any enrolled key
  participant W as Web app or recovery CLI
  participant R as Public RPCs
  participant A as Arweave (fallback)

  U->>K: One tap
  K-->>W: PRF output (UV verified)
  W->>W: Derive locator
  W->>R: v2: locatorLength, then resolveLocator(locator, start, 256) page by page
  R-->>W: Candidate vaultIds (append-only, no cap)
  W->>R: v2 getVaults(≤32 ids) per batch; then v1 resolveLocator + getVault (testnet only)
  alt chain unreachable (CLI)
    W->>A: GraphQL by CryoShield-Locator tag
    A-->>W: Blobs, checked against the latest on-chain event hash when available
  end
  W->>W: Derive wrap key, try each candidate, keep the one that authenticates
  W-->>U: Secrets shown locally (CLI asks for explicit confirmation)
```

- No account, no gas and no wallet are needed to read.
- **v2 is authoritative.** A v1 entry whose vaultId also exists in v2 is ignored (v1 accepts any id, so it could hold a stale copy). If v2 can't be read, nothing opens: the app says it couldn't confirm the latest version, rather than falling back to v1.
- **Legacy v1 vaults** (OP Sepolia only) open read-only. When a key opens one v2 vault, it opens directly, with v1 copies behind "Open an older test vault".
- **Web app guard:** the web app checks the RPC's `eth_chainId` before any registry read, and refuses with "wrong network" rather than a misleading "no vault".
- **Recovery CLI hardening:**
  - hostile JSON from a server is discarded and recovery continues;
  - disagreeing RPCs are compared to the latest event hash;
  - event history needs 2 agreeing configured RPCs;
  - remote text is stripped of terminal escape sequences.

## 5. How code reaches cryoshield.app

Nothing reaches `main` or production without a spec, a pull request and a green `ci-ok`. The `main` ruleset has no bypass actors, so this applies to admins too. Every new commit on `main` is then deployed to the **development** site https://cryoshield-web-dev.fly.dev by `.github/workflows/deploy-dev.yml`, after the full CI passes again on that exact commit. **Production** is deployed by `.github/workflows/deploy.yml` only when the owner publishes a `v*` release of a commit on `main` (runbook: `docs/deploy.md`; change `split-dev-and-release-deploys`). Agents work through a non-admin machine account (`docs/agent-account.md`) that cannot create `v*` tags, so an auto-merged PR reaches `main` and dev, but never production by itself.

```mermaid
flowchart LR
  spec["OpenSpec change<br/>proposal → specs → design → tasks"]
  pr["Branch + PR<br/>feat/ fix/ ci/ docs/ chore/"]
  checks["pr-checks<br/>Conventional title · OpenSpec gate<br/>gitleaks · osv-scanner"]
  jobs["Area jobs<br/>contracts · vault-crypto · web · web-e2e<br/>recover · openspec · workflow-lint"]
  ok["ci-ok<br/>required, strict"]
  main["main<br/>squash only, linear, no force-push"]
  devpipe["deploy-dev.yml<br/>every main commit (push · every 15 min)<br/>full CI · build in development-build"]
  dev["Fly.io cryoshield-web-dev<br/>cryoshield-web-dev.fly.dev · OP Sepolia<br/>RP ID cryoshield-web-dev.fly.dev · noindex"]
  release["owner publishes release vX.Y.Z<br/>(only admins can create v* tags)"]
  prodpipe["deploy.yml<br/>tag on main? · full CI on the tag<br/>build in production-build (no Fly token)"]
  prod["Fly.io cryoshield-web<br/>cryoshield.app"]
  smoke["each release job: flyctl deploy + smoke test<br/>routes · headers · registry · /release.json<br/>auto rollback on failure"]

  spec --> pr
  pr --> checks --> ok
  pr --> jobs --> ok
  ok --> main --> devpipe --> dev
  main --> release --> prodpipe --> prod
  dev -.- smoke
  prod -.- smoke

  classDef ours fill:#e6f0fa,stroke:#0066cc,color:#0066cc;
  class dev,prod ours;
```

- **Security review.** Every change touching crypto, contracts, the paymaster or secret handling ends with a security-review task. The records are in `docs/reviews/` and `apps/web/docs/`.
- **Pinned toolchain.** All third-party GitHub Actions are pinned by commit SHA. The gitleaks and osv-scanner binaries are pinned by version and checksum. Installs fail on lockfile drift.
- **Rebuildable deploys.** Every deploy writes `apps/web/deploy/.build/release-manifest.json` with the commit and a deterministic tree hash, so anyone can rebuild the site and compare it with what Fly serves. The site also serves the commit, tree hash and public config at `https://cryoshield.app/release.json` (not part of the tree hash), so anyone can see which commit is live.
- **Continuous deployment to dev, owner releases to production.**
  - `deploy-dev.yml` runs on every push to `main`, every 15 minutes (merges made by auto-merge start no push workflow), and on demand. It skips when the dev site's `/release.json` already shows the `main` HEAD.
  - `deploy.yml` runs only for a release the owner publishes (or the owner's redeploy of a tag). It refuses a tag that is not on `main`.
  - Both run the full `ci.yml` on the exact commit, and build with the guarded `deploy.sh --build-only` in a build environment that has no Fly token.
  - Both then run one `release` job in their own token environment: `development` holds a token for `cryoshield-web-dev` only, and `production` one for `cryoshield-web`. The job runs the flyctl-only deploy, the smoke test, and the automatic rollback to the previous image on any failure or cancellation.
  - The two pipelines use separate concurrency groups and never cancel each other.
  - The dev site is served from `cryoshield-web-dev.fly.dev`, a different registrable domain (`fly.dev` is on the Public Suffix List), with that host as its WebAuthn RP ID. A dev page therefore cannot assert `rpId: 'cryoshield.app'`, so auto-deployed dev code cannot reach production vaults. No host under `cryoshield.app` serves the dev site (`dev.cryoshield.app` is retired).

## 6. Hosting and headers

The static site is served by a digest-pinned Caddy image that runs as a non-root user.

| Header | Value |
|---|---|
| Content-Security-Policy | Derived from the built meta CSP, plus `frame-ancestors 'none'`. No `unsafe-eval` or `unsafe-inline`; Trusted Types `'none'` |
| Strict-Transport-Security | `max-age=63072000; includeSubDomains; preload` |
| X-Frame-Options | `DENY` |
| Permissions-Policy | `publickey-credentials-get/create=(self)`; camera, microphone, geolocation, USB and the rest denied |
| Referrer-Policy | `no-referrer` |
| Cross-Origin-Opener-Policy | `same-origin` |
| X-Content-Type-Options | `nosniff` |

- **Redirects:** every non-apex host, including `*.fly.dev`, is sent with a 301 to `https://cryoshield.app`, except `/healthz`.
- **Caching:** `index.html` is `no-cache`, and hashed assets are `immutable`.
- **Routes:** the landing page is at `/` and loads Motion lazily; it never loads React, viem or vault code. The vault app is at `/app/`.

## 7. Live reference values

| Item | Value |
|---|---|
| Network | OP Sepolia, chain 11155420 (mainnet: OP Mainnet, not deployed yet) |
| VaultRegistry v2 | `contracts.vaultRegistryV2` in `contracts/deployments/<chainId>.json` (same CREATE2 address on every chain); the live value is on `/architecture` |
| VaultRegistry v1 (legacy, read-only, OP Sepolia only) | `0xB43f58cF17e64B603aE5588a1DD17E96a0849e44`, deploy block `49568053`; never deployed to OP Mainnet |
| Smart account | CryoShield Smart Wallet (CBSW v1.1 code + UV and rpIdHash on every signature) on EntryPoint v0.6, from `contracts.wallets.<rpId>.factory`; P-256 precompile at `0x100` |
| WebAuthn RP ID | `cryoshield.app` (permanent) |
| Hosting | Fly app `cryoshield-web`, org `cryoshield`, region `sin`; DNSSEC and CAA on |
| Vault limits | blob ≤ 1024 bytes · 2–8 keys · no per-locator cap (v2; v1 had 16) |
| Chain presets | `config/chain-presets.json` (anvil, op-sepolia, op-mainnet, arbitrum-sepolia, arbitrum-one) |
| License | MIT |

## 8. Where to look next

| Topic | File |
|---|---|
| Vault binary format and derivations | `docs/spec/vault-format-v1.md`, `openspec/specs/vault-crypto/` |
| Contracts | `contracts/src/VaultRegistryV2.sol`, `contracts/src/CryoShieldSmartWallet.sol`, `contracts/src/CryoShieldSmartWalletFactory.sol`, `contracts/README.md`, `contracts/GAS.md` |
| Gas sponsorship runbook | `apps/web/docs/paymaster-policy.md` |
| Web app, paymaster policy, costs | `apps/web/docs/` |
| Hosting runbook and DNS hardening | `apps/web/deploy/README.md` |
| Recovery tool and manual YubiKey test | `tools/recover/README.md`, `tools/recover/docs/manual-yubikey-test.md` |
| Design language | `docs/design/visual-language.md` |
| Product requirements | `.claude/PRPs/prds/cryoshield.prd.md` |
