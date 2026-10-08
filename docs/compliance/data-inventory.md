# Data-flow inventory

> `add-privacy-and-compliance` design D1, completed 2026-10-08. CryoShield is an open-source project maintained by its
> contributors; there is no company (founder decision 2026-10-08). This is a factual record of what data goes where,
> not a legal analysis. UNVERIFIED marks a vendor fact we could not confirm from the vendor's public documents.
> Machine-readable origin mapping: [`origins.json`](origins.json), checked by `apps/web/scripts/verify-build.mjs`
> (every production `connect-src` / `script-src` origin must be listed).

"PD?" says whether the data identifies, or can be linked to, a person (an IP address, or a stable pseudonymous
identifier such as an account address). "Who controls it" is factual: who chose the party and who can delete what it
holds. How the design keeps this list short is in [`legal-analysis.md`](legal-analysis.md).

| # | Where | Data | PD? | Who chose it / who controls it | Retention / control |
|---|---|---|---|---|---|
| 1 | Browser (user's device) | PRF outputs, wrap and data keys, plaintext secrets, labels and vault name (in memory only); the WebAuthn credential lives on the security key | Plaintext may contain PD; never leaves the device | The user. CryoShield's code runs there but sends none of it anywhere | PRF buffers wiped after use; open vault cleared on Lock, after 5 min idle and on page hide (spec `vault-web-app` "Secrets in memory only with auto-lock"); no cookies or storage (lint + `test/privacy.test.ts` + E2E sweep) |
| 2 | Fly.io edge proxy (`cryoshield.app`, `cryoshield-web-dev.fly.dev`) | Client IP, TLS metadata, Host, path, user agent, timestamps | Yes (IP) | The maintainers chose Fly. Fly holds its edge logs; we cannot see or delete them | Fly exposes no edge access logs to customers; internal retention **unpublished (UNVERIFIED)**. `fly logs` keeps container stdout ~7 days (it contains no request data, row 3). Fly Inc. is US-based; machines in Singapore (`sin`). Fly's public privacy policy and DPA terms apply |
| 3 | Caddy container (our config) | Would see `Fly-Client-IP`, path, user agent | Only if logged | The maintainers (config in this repo) | **No `log` directive, so Caddy writes no access log.** Tested: `apps/web/deploy/test/container.test.ts` sends 100 requests with distinct IPs, user agents and query strings and finds none in the output |
| 4 | Pimlico bundler/paymaster (Austerlitz Labs Ltd, UK) | Client IP, Origin, user agent, smart-account address (sender), user-operation calldata (ciphertext blob, locators, vaultId), WebAuthn signatures, sponsorship policy ID | Yes (IP linked to the account address) | The maintainers chose Pimlico and hold the API key. Pimlico holds its logs | Pimlico's public terms and privacy policy apply; retention **unstated (UNVERIFIED)**. No separate agreement is sought (OSS, founder 2026-10-08) |
| 5 | Public chain (OP Sepolia today; OP Mainnet after `launch-op-mainnet`) | VaultRegistry v2 (writes) and v1 (legacy, read-only): `vaultId`, `owner` (smart-account address), version, blob (RP ID, key count N, credential IDs, `wrapSalt`, wrapped keys, ciphertext), `blobHash` per version, `LocatorAdded` (≤8 locators per vault); every earlier blob version; block timestamps. CryoShield smart account: each enrolled key's P-256 public key | Pseudonymous identifiers (account address, locators, credential IDs, P-256 keys) that a bundler, an RPC or the user can link to a person. The ciphertext needs a key and its PIN to read | The protocol design is ours; the user signs every write. Nobody controls the chain | **Permanent, public, cannot be erased** |
| 6 | Arweave via ArDrive Turbo upload (Permanent Data Solutions Inc., US); Turbo's fast-finality index `turbo-gateway.com` (app only, `fix-arweave-mirror-status`); arweave.net gateway (ar.io; operator UNVERIFIED) | Upload: client IP, signed data item = blob + tags `App-Name`, `CryoShield-Vault-Id`, `CryoShield-Version`, `CryoShield-Locator`×N, and the uploader's ephemeral secp256k1 address. Reads: IP, GraphQL query (vaultId, locators) | Yes (IP; same pseudonymous IDs as row 5). The uploader key is random per browser session, so it does not link sessions | The maintainers chose these services; each holds its own logs | Data permanent; a gateway may hide an item but the network keeps it. Vendor log retention per their public terms |
| 7 | Public RPCs: web app `sepolia.optimism.io` / `mainnet.optimism.io` (OP Labs); recovery tool and metrics presets also PublicNode and dRPC | IP, `eth_call` / `eth_getLogs` parameters (locators, vaultIds) | Yes (an IP looking up a locator suggests "this IP owns this vault") | The maintainers chose the defaults; the recovery tool lets the user choose | OP Labs logging policy **unpublished (UNVERIFIED)**; PublicNode ≤ 24 h; dRPC weekly purge (their privacy pages) |
| 8 | Cloudflare Web Analytics (landing `/` only, beacon only, `add-privacy-preserving-analytics`) | IP + user agent in transit; page path (query and fragment stripped first), referrer, Performance API timings; country derived from IP | Yes in transit (IP). Cloudflare states that IPs are not stored and no cookies or local storage are used | The maintainers chose it and hold the account | Off under GPC or DNT; never on `/app/` or the legal pages (CSP). Cloudflare's public DPA and privacy policy apply; retention UNVERIFIED |
| 9 | GitHub (public repo, issues, pull requests, Actions) | Contributor and reporter GitHub accounts, emails in commits, issue and PR content | Yes | GitHub hosts it; maintainers can delete or redact issue content they control | Until deleted by the maintainers or the author |
| 10 | GitHub correspondence (privacy-request issues, private security advisories; `adopt-oss-project-defaults`) | Reporter GitHub account, request contents, possibly an account address | Yes | The maintainers, for this correspondence only | Issue content deleted or redacted on request; private advisories closed once handled, kept at most 3 years after closure. There is no email address |
| 11 | Domain and DNS (GoDaddy), CAA | WHOIS data of the registrant, not of users | No user PD | The maintainer | n/a |
| 12 | Desktop recovery tool (`tools/recover`) | Runs locally; contacts the preset or user-chosen RPCs and Arweave gateways (rows 6–7) through one module, `net.py` | IP to those RPCs and gateways | The user chooses the network and endpoints | No telemetry: the only network calls are the RPC and gateway requests in `rpc.py` and `arweave.py` |
| 13 | Product metrics job (`tools/metrics`, `.github/workflows/metrics.yml`) | Reads public chain and Arweave data only; writes weekly aggregates | No: no visitor data; the report is refused if it contains any 20- or 32-byte identifier other than the registry addresses, and cells under 3 are suppressed (`docs/reviews/product-metrics.md`) | The maintainers | GitHub Actions artifact, 90 days |

## Inside the ciphertext only (payload v2, `vault-list-labels-archive`)

Payload v2 (`docs/spec/payload-v2.md`) adds two fields, and both exist **only inside the encrypted blob** (rows 5 and 6
publish the ciphertext; no new plaintext field, tag, event or log carries them):

- **Vault name** (optional, typed by the user at creation or in "Rename or archive"). It may contain personal data. It is
  encrypted client-side with the rest of the payload and is never sent, logged or stored in plaintext: not in a
  credential, the URL, the page title, `errorReference`, analytics (landing page only) or device storage. Older
  versions stay readable to anyone with one of the vault's keys and its PIN, like every older version of the vault.
- **Archived flag** (and the length padding written by "Archive and clear"). Inside the ciphertext only; the blob
  length is kept, so archiving reveals nothing on-chain beyond the fact that the vault was updated.

**Credential labels** (the WebAuthn user name/display name stored on the security key and shown by browsers) are
generic and month-only, "CryoShield vault · Oct 2026 (key 1)" (`apps/web/src/webauthn/index.ts`); they never carry
the vault name or any secret. They sit on the user's key (row 1), never with CryoShield.

## What the public data reveals (on-chain confidentiality review, F3 and F6)

Beyond the identifiers in rows 5 and 6, a reader of the chain can learn: the number of keys, how many times and when a
vault was edited, a size range of the payload (padding hides the exact length, not the class: a 12-word and a 24-word
seed phrase usually differ), and, through a locator, every vault the same credential ever opened. None of it reveals
a secret. `/privacy` "Public and permanent data" lists all of it.

## Browser-side device storage

One optional preference, nothing else. If the visitor picks Light or Dark in the Theme menu (`add-theme-switch`), the
browser keeps `localStorage["cryoshield-theme"]` = `light` or `dark` on every route; choosing System deletes it, and
clearing the site's data in the browser removes it. It holds no identifier, is not personal data, and is never sent
anywhere. Apart from it, CryoShield's code sets no cookie and uses no localStorage, sessionStorage, IndexedDB, Cache
Storage or service worker on any route (`apps/web/legal/storage-inventory.json`, enforced by a build scan of every
shipped script, which allows `localStorage` only in the theme script, and an E2E sweep before and after choosing a
theme). The Cloudflare beacon (row 8) states it uses no client-side state.

## Sources

Fly privacy policy https://fly.io/legal/privacy-policy/, sub-processors https://fly.io/legal/sub-processors/, logging
https://docs.fly.io/monitoring/logging-overview; Pimlico https://www.pimlico.io/privacy and /tos; ArDrive
https://ardrive.io/tos-and-privacy/; ar.io https://ar.io/legal/terms-of-service-and-privacy-policy/; PublicNode
https://www.publicnode.com/privacy, dRPC https://drpc.org/privacy-policy; Optimism
https://www.optimism.io/data-privacy-policy (does not cover RPC traffic); Cloudflare https://www.cloudflare.com/web-analytics/.
On-chain fields: `docs/spec/vault-format-v1.md` §5, `docs/reviews/on-chain-confidentiality-2026-10.md` §1.
