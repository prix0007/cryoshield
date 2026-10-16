# CryoShield

Permanent, non-custodial backup for the secrets you can't afford to lose (seed phrases, 2FA backup codes, recovery codes).

- Secrets are encrypted **in your browser**. CryoShield never sees them and runs no servers.
- Only your **FIDO2 hardware keys** (YubiKey 5, firmware ≥ 5.2) can unlock a vault. You enrol at least two, and any one of them opens it.
- The encrypted vault lives on **OP Mainnet** (an EVM rollup), mirrored to **Arweave**. Gas is sponsored, so you never need a wallet or crypto.
- If CryoShield disappears, the open-source **desktop recovery tool** still unlocks your vault, straight from the public chain.

> Status: live on **OP Mainnet** at https://cryoshield.app since `v1.0.0` (2026-10-12). A development copy runs at https://cryoshield-web-dev.fly.dev (OP Sepolia, with its own RP ID; test ETH for local work from the [Superchain faucet](https://console.optimism.io/faucet)). No external audit: see [Security](#security).

## If you need your vault

- **Recover without the website:** [`tools/recover/README.md`](tools/recover/README.md) explains how to install or download `cryoshield-recover` and unlock a vault with one of your keys, using only public RPCs or Arweave.
- **Lost or compromised hardware key:** follow [`docs/lost-or-compromised-key.md`](docs/lost-or-compromised-key.md).
- **Which keys work:** [`docs/supported-devices.md`](docs/supported-devices.md).
- **Practise before you need it:** the [recovery drill](#recovery-drill) below takes ten minutes and ends with your secret on screen, with the website blocked.

## How it works

The architecture, key derivation and flows are in [`docs/system-design.md`](docs/system-design.md). The vault format is specified in [`docs/spec/vault-format-v1.md`](docs/spec/vault-format-v1.md), with deterministic test vectors in `packages/vault-crypto/test-vectors/`.

| Path | What |
|---|---|
| `packages/vault-crypto` | Vault format: PRF → HKDF-SHA256 → AES-256-GCM, Shamir option, test vectors |
| `contracts` | Vault registry and smart wallet (Foundry). No admin, no upgrades |
| `apps/web` | Static web app: WebAuthn PRF, ERC-4337 passkey account, sponsored gas, Arweave mirror |
| `tools/recover` | `cryoshield-recover`, the Python desktop recovery tool and a second implementation of the format |
| `tools/metrics` | Aggregate, identifier-free metrics from public chain and Arweave data |

## Recovery drill

Ten minutes, with the website blocked on your computer, ending with your secret decrypted on screen. Run it once you have a vault, and again whenever you want proof that recovery does not depend on CryoShield. The maintainer runs it before every release and monthly after it ([`docs/launch/mainnet-release-checklist.md`](docs/launch/mainnet-release-checklist.md), steps 3.2, 7.2 and 8.4); the runs are recorded in [`docs/reviews/launch-op-mainnet.md`](docs/reviews/launch-op-mainnet.md).

**You need:** a vault you created on https://cryoshield.app, one of its hardware keys, that key's PIN, and a computer with a USB port. **Use a test vault with throwaway contents.** Step 5 prints the secret on the screen, and your terminal keeps scrollback. A test vault is a real vault: its ciphertext stays public forever and creating it uses a sponsored write, so you can instead drill against a vault you already have and stop at the vault list: quit the tool there instead of typing `show`.

1. **Get the tool (3 minutes).** Download the single-file program for your computer and check its checksum ([`tools/recover/README.md` → Download](tools/recover/README.md#download) has every platform). On a Mac with Apple silicon:

   ```sh
   curl -LO https://github.com/prix0007/cryoshield/releases/latest/download/cryoshield-recover-macos-arm64
   curl -LO https://github.com/prix0007/cryoshield/releases/latest/download/cryoshield-recover-macos-arm64.sha256
   shasum -a 256 -c cryoshield-recover-macos-arm64.sha256
   gh attestation verify cryoshield-recover-macos-arm64 --repo prix0007/cryoshield
   chmod +x cryoshield-recover-macos-arm64
   ./cryoshield-recover-macos-arm64 --version
   ```

   The checksum detects a corrupt download, not a replaced release: both files come from the same place. The `gh attestation verify` line (GitHub CLI) checks that a GitHub Actions workflow of this repository built the file, and prints which workflow and commit; see [`tools/recover/README.md` → Verifying a download](tools/recover/README.md#verifying-a-download).

2. **Block the website (1 minute).** Add this line to your hosts file (`/etc/hosts` on macOS and Linux, `C:\Windows\System32\drivers\etc\hosts` on Windows; editing it needs administrator rights):

   ```text
   127.0.0.1 cryoshield.app www.cryoshield.app
   ::1       cryoshield.app www.cryoshield.app
   ```

   Flush the DNS cache (macOS: `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`; Windows: `ipconfig /flushdns`), then check that the block took: `curl -sS --max-time 5 https://cryoshield.app` must fail to connect, and the site must not load in your browser. If the browser still loads it, it is using secure DNS (DNS over HTTPS) or a cached copy; turn secure DNS off for the drill, or rely on the `curl` check and on the server list the tool prints in step 3.

3. **Run the tool (1 minute).** Plug in the key and start the tool. It prints the servers it will contact: public OP Mainnet RPCs and Arweave gateways, and `cryoshield.app` is not among them.

   ```sh
   ./cryoshield-recover-macos-arm64             # a vault created on cryoshield.app
   ./cryoshield-recover-macos-arm64 --testnet   # a vault created on cryoshield.app before the launch (OP Sepolia)
   ./cryoshield-recover-macos-arm64 --testnet --rp-id cryoshield-web-dev.fly.dev   # a vault made on the development site
   ```

   `--testnet` only picks the chain. The development site has its own RP ID, so a vault made there needs `--rp-id` as well, and everything below then applies to that name instead of `cryoshield.app`.

4. **Touch the key and enter its PIN** when asked. Type it carefully: a key allows only a few wrong attempts before it locks. If the key opens several vaults, pick one by number.

5. **Type `show`.** The secret is on screen, decrypted on your computer, with the website unreachable. That is the drill.

6. **Optional, three more minutes, with no network at all.** Save the encrypted vault, note the vault ID the tool prints, disconnect from the internet, and open the file. Add the flags you used in step 3 (`--testnet`, `--rp-id`) to both commands:

   ```sh
   ./cryoshield-recover-macos-arm64 --save-blob my-vault.bin
   ./cryoshield-recover-macos-arm64 --blob-file my-vault.bin --vault-id <vault-id> --offline
   ```

7. **Clean up.** Remove the hosts line and close the terminal window, because its scrollback holds the secret. Keep `my-vault.bin` together with the vault ID if you want an offline copy; it is useless without your key.

**What the drill proves:**
- the tool never needed the website: for the whole run, the name `cryoshield.app` pointed at your own computer;
- your key produced the PRF output for the RP ID `cryoshield.app` on request from a program that is not a browser, with nothing from CryoShield involved (see [below](#your-vault-is-bound-to-the-name-cryoshieldapp-not-to-the-website));
- the vault was read from public servers (step 6: from a file) and decrypted locally, and the result is the secret you stored.

**What it does not prove:** that today's public RPCs or Arweave gateways will exist in twenty years (the tool takes `--rpc` for any OP Mainnet node, including your own, and `--offline` for a saved copy), or that you will still have the tool (keep a copy of the program or the source; it is MIT-licensed, and the format is specified in [`docs/spec/vault-format-v1.md`](docs/spec/vault-format-v1.md) with test vectors, so anyone can reimplement it).

## What CryoShield depends on

The promise is that your vault outlives the project. These are the dependencies that remain, what each one's loss stops, and what keeps working.

### Your vault is bound to the name `cryoshield.app`, not to the website

A WebAuthn PRF output is your hardware key's `hmac-secret` over a salt, computed with a secret that never leaves the key and that belongs to one credential. A credential is scoped to one **RP ID**, here `cryoshield.app`. The key returns the PRF output only for an assertion request that names that RP ID. In a browser, the RP ID comes from the page's origin, which is why no website outside `cryoshield.app` can derive your vault key. A program running on your computer can ask the key directly, as the recovery tool does, and still needs your PIN.

The recovery tool is not a browser. It is a CTAP2 client built on [python-fido2](https://github.com/Yubico/python-fido2) (Yubico's library; `fido2>=2.0,<3` in [`tools/recover/pyproject.toml`](tools/recover/pyproject.toml), used in [`authenticator.py`](tools/recover/src/cryoshield_recover/authenticator.py)). It sends the RP ID string straight to the key inside the `hmac-secret` request, over USB or NFC. The key does not resolve the name, open a connection or check who owns the domain: the RP ID is a label it compares with the credential's. So the tool never contacts `cryoshield.app`. It presents the RP ID offline, reads the encrypted vault from public OP Mainnet RPCs or Arweave (or from a file), and decrypts on your computer. The tool's built-in RP ID is `cryoshield.app`, and `--rp-id` overrides it. Every vault also records the RP ID it was created for: with `--vault-id` or `--blob-file`, the tool tries the configured RP ID first when any copy it found records it, then the RP IDs recorded in the other copies (on-chain copies before your file, then Arweave), one tap each and at most three, so a copy made for another site is never silently skipped and never gets to choose ahead of the configured name.

**The salt is hashed twice, and a recovery tool must hash it the same way.** There is one PRF input for every CryoShield credential: `SHA-256("cryoshield/v1/locator-salt")`. A browser's PRF extension does not hand that input to the key as it is; it hashes it first, so a client talking CTAP2 `hmac-secret` directly must send `SHA-256("WebAuthn PRF" || 0x00 || input)` as the salt. Sending the input unhashed returns a different 32 bytes that opens nothing, and that is the detail most direct `hmac-secret` reimplementations get wrong. The tool applies the second hash in [`derive.py`](tools/recover/src/cryoshield_recover/derive.py) (`ctap_salt()`), a test pins the formula, the specification is [vault-format-v1 §3](docs/spec/vault-format-v1.md#3-single-prf-input-and-ctap-salt-mapping), and both salts appear in every cross-implementation vector in [`packages/vault-crypto/test-vectors/`](packages/vault-crypto/test-vectors/), so a reimplementation can check itself without a key.

**A wrong RP ID does not look like a bad key.** The PRF output for a wrong name is a different value, but the failure is never an opaque decrypt error. Ask the key for a name it holds no credential for and it returns nothing: the tool stops with "This key has no discoverable CryoShield credential for" that name and points at `--rp-id`, before any decryption is attempted. Use `--rp-id` only with the exact name your vault was created under, never a name someone else gives you. If the key does hold a credential for the other name too (one enrolled on the live site and on the development site), the discovery path derives a different lookup value, finds the other site's vaults or none, and its "No vault unlocked" message names `--rp-id` as well. When you give the tool a vault ID or a file, it reads the RP ID from the vault's own header, so the name cannot be mistyped on that path at all. And the format has a key check that runs before the ciphertext is touched: the vault's data key (or, in a Shamir vault, one share of it) is wrapped once per enrolled credential under AES-256-GCM, the tool picks the entry by the credential ID the key answered with (when the key reports one; otherwise it tries every entry), and that wrap's authentication tag is verified before the payload is read. So "the key answered, but the derived key does not fit this entry" is its own message, "This key is listed in that vault but did not unlock it.", with the one thing to check on that path (a wrong `--vault-id` for a saved file, since the wrap is bound to the vault ID) and the other cause (a damaged copy); it is distinct from the not-listed case, where the tool first echoes each site name it tried ("This key has no credential for" that name, which is also what a key enrolled only on the other site sees; the name comes from a copy's header, and an Arweave copy is untrusted until it opens, so never act on a name you do not recognise) and then says "This key holds none of the credentials that vault lists for the site(s) named above." There is no separate key-check value in the format because the wrap tag is one: 48 bytes (49 for a Shamir share), verified first, and never the payload.

If the domain expires or changes hands, your vault is unaffected: recovery needs your key, its PIN and the public ciphertext, none of which a domain owner has. The recovery tool always requires user verification, keys enrolled with credProtect level 3 (every key enrolled since the mainnet launch) refuse to answer without it, and a PRF output obtained without user verification (PIN or fingerprint) is a different value that opens nothing. None of this stops a site that asks for verification and gets it, which is why the next sentence matters. The residual risk is phishing. A future owner of the name could run a site under the same RP ID, and if you used your key and PIN there, that site would get your PRF output and could decrypt your public vault. So treat the end of the domain like the end of the project: recover with the tool, stop using `cryoshield.app` at all, and never present a CryoShield key with its PIN to a site you did not verify.

### The one company in the write path: gas sponsorship

Writes (creating a vault, saving changes, adding a key, archiving) are ERC-4337 user operations sent through **Pimlico**'s bundler and paid by its paymaster under CryoShield's sponsorship policy ([`apps/web/docs/paymaster-policy.md`](apps/web/docs/paymaster-policy.md)). This is the single-company dependency in the system, and it is in the write path only. If sponsorship stops, because a policy cap is hit, the prepaid balance runs out, Pimlico is down or CryoShield stops paying, **writes stop**: when you save, the app says "Saving is paused right now. Your existing vault is safe; please try again later."; when you create a vault, it says "Nothing was saved. Please try again later." It never falls back to an unsponsored operation or charges you. Reads survive: unlocking in the app, the recovery tool and every existing vault never touch Pimlico, because a vault is read straight from the chain or Arweave. The contracts themselves have no admin and need no sponsor, so a future client could pay its own gas; the CryoShield app does not offer that. Each vault's wallet contract also has the RP ID hash baked in: every write is signed by a key under `cryoshield.app`, so writes depend on that name too, while reads and recovery do not.

### Everything else

| Dependency | If it goes away | What keeps working |
|---|---|---|
| Pimlico (bundler and paymaster) | writes stop; the app shows "Saving is paused" | unlocking in the app, the recovery tool, every existing vault |
| The website (static files on Fly.io) | no new vaults and no in-browser unlock | the recovery tool, as in the drill |
| The domain `cryoshield.app` | the website; the RP ID is a label the tool keeps presenting (above), and the name the wallet contracts expect on every write | the recovery tool |
| Public OP Mainnet RPCs | the tool ships three independent endpoints and takes `--rpc` for any node, including your own | reading from any node that has the chain |
| Arweave gateways | the chain copy is primary; Arweave is the fallback (and the chain is read with `--no-arweave`) | reading from the chain |
| OP Mainnet | the Arweave copy and any `--save-blob` file hold the same bytes; this is the one loss that needs them | reading from Arweave or from a file |
| GitHub (downloads and source) | the tool is MIT-licensed source that runs from any copy at a release tag with `uv`; the format is specified, so it can be reimplemented | recovery from a saved copy of the tool |

## Development

Prerequisites: Node 22 and pnpm 9, Foundry 1.1.0, Python ≥ 3.10 with uv, and the openspec CLI 1.14.0.

```sh
pnpm install --frozen-lockfile

pnpm --filter @cryoshield/vault-crypto test                  # crypto library
(cd contracts && forge test && forge snapshot --mc GasTest --check)
pnpm --filter @cryoshield/web test                           # web: unit
pnpm --filter @cryoshield/web test:int                       # web: integration on local anvil
pnpm --filter @cryoshield/web test:e2e                       # web: E2E, virtual authenticator
pnpm --filter @cryoshield/web verify-build
(cd tools/recover && uv sync --locked && uv run pytest -q)   # recovery tool
pnpm --filter @cryoshield/metrics test                       # metrics
pnpm metrics --network op-sepolia                            # metrics run (tools/metrics/README.md)
openspec validate --all --strict
```

Dependency install scripts are disabled (`pnpm.onlyBuiltDependencies: []`). Real-hardware checklists: `apps/web/docs/hardware-test.md` and `tools/recover/docs/manual-yubikey-test.md`.

## Contributing / PR workflow

- **OpenSpec first.** Every feature, fix and refactor starts as a change under `openspec/changes/<name>/`. A PR that touches code or CI without one (the exact paths are in [`docs/maintainers.md`](docs/maintainers.md#pull-request-rules)) fails the gate (unless labelled `no-spec` with a `No-spec justification:` line).
- **Branch** as `feat/`, `fix/`, `ci/`, `docs/` or `chore/`. The **PR title** is a Conventional Commit (`fix(recover): handle empty log page`); it becomes the squash commit on `main`.
- Fill in the PR template. CI and an automated review run on every PR; the owner approves the review and merges PRs from outside contributors.

Product requirements: `.claude/PRPs/prds/cryoshield.prd.md`. The full flow is in [`CLAUDE.md`](CLAUDE.md) → "Change flow". CI, branch protection and deployment details are in [`docs/maintainers.md`](docs/maintainers.md) and [`docs/deploy.md`](docs/deploy.md).

## Support the project

CryoShield is free, open-source software. If it helps you, you can send a voluntary donation in **ETH on Ethereum mainnet** (chain ID 1) to:

```
0xfb4172e26AC8735C06656f1df14151cFe8441481
```

- **Check the address.** It is also shown on [cryoshield.app/support](https://cryoshield.app/support). Before you send, check that the address there matches this README character for character, so a tampered page can't redirect your donation.
- **Use the right network and asset.** Send only ETH on Ethereum mainnet. Tokens, or ETH on other networks, sent to this address may be lost.
- **What donations fund:** gas sponsorship and hosting.
- **Terms:** donations are non-refundable and come with no perks, goods or services. This is an open-source project with no company behind it, so there are no tax receipts.

## Security

There is no external audit. CryoShield relies on an open specification, cross-implementation test vectors, symmetric-only cryptography and an internal review of every security-relevant change ([`docs/reviews/`](docs/reviews/)).

Report vulnerabilities privately, never in a public issue: see [`SECURITY.md`](SECURITY.md) or use [GitHub private vulnerability reporting](https://github.com/prix0007/cryoshield/security/advisories/new). Also see [`security.txt`](https://cryoshield.app/.well-known/security.txt). New issues get an automatic acknowledgement and a sandboxed first diagnosis ([`CLAUDE.md`](CLAUDE.md) → "Issue triage"). **Never post seed phrases, recovery codes, PINs or keys in an issue.**

### Known vulnerabilities

Every pull request is scanned by gitleaks (secrets, every commit), osv-scanner (every lockfile) and [Trivy](https://trivy.dev) (every lockfile, the Caddy base image that serves the site, and its Dockerfile). A CRITICAL, HIGH or unscored finding fails CI. Exceptions live in `.github/osv-scanner.toml` and `.github/trivyignore.yaml`, each with a reason and an expiry of at most 90 days, and CI fails if a Trivy exception is missing from the table below.

As of 2026-10-16: the browser app (`pnpm-lock.yaml`) and the recovery tool (`tools/recover/uv.lock`) have no known vulnerability. The web server image carries HIGH-rated denial-of-service findings in the Go toolchain compiled into Caddy, fixed upstream on 2026-10-08 and waiting for a Caddy image built with Go 1.26.9. The accepted findings are:

| Advisory | Where | Severity | Why it is accepted | Until |
|---|---|---|---|---|
| CVE-2026-93687 (GHSA-vfj7-8cjw-p6xm) | `braces`, in the CI-only OpenSpec CLI | HIGH, no fix | it expands only glob patterns written in this repository and is never shipped | 2026-12-31 |
| CVE-2026-78667, CVE-2026-78669, CVE-2026-78659, CVE-2026-78660 | Go `net/http` and `x/net` in the Caddy 2.11.7 binary | HIGH / unscored | denial of service only, against a static site behind Fly's proxy, which restarts it; no data at risk | 2026-12-31 |
| CVE-2026-97031 | Go `crypto/tls` (ECH) in the Caddy binary | HIGH | TLS is terminated by Fly and Caddy's TLS server is off, so the code is not reachable | 2026-12-31 |
| CVE-2026-94440, CVE-2026-97030, GO-2026-5932 | Go `mime/multipart`, `html/template`, `x/crypto/openpgp` in the Caddy binary | unscored | code paths a static file server never runs: no forms, no templates, no OpenPGP | 2026-12-31 |

Medium and low findings are printed in the CI log and do not block.

## License

[MIT](LICENSE), enforced in CI by `scripts/check-licenses.sh`.
