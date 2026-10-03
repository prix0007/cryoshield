# Data-flow inventory

> Source: `openspec/changes/add-privacy-and-compliance` design D1 (2026-10-02/03). Not legal advice. Items marked
> UNVERIFIED or **[lawyer]** are open. Machine-readable origin mapping: [`origins.json`](origins.json), checked by
> `apps/web/scripts/verify-build.mjs` (every production `connect-src` / `script-src` origin must be listed).

"PD" = personal data under GDPR Art. 4(1) / DPDP s.2(t). Role = CryoShield's role for that flow.

| # | Where | Data | PD? | CryoShield role | Other party's role | Retention / control |
|---|---|---|---|---|---|---|
| 1 | Browser (user's device) | PRF outputs, data key, plaintext secrets (in memory only); WebAuthn credential lives on the YubiKey | Plaintext secrets may contain PD; never leaves the device | **Neither**: CryoShield code runs on the user's device but CryoShield never receives anything (household/own-device processing by the user) | User | Wiped after use; no cookies or storage (lint + `test/privacy.test.ts`) |
| 2 | Fly.io edge proxy | Client IP, TLS metadata, Host, path, user agent, timestamps | **Yes** (IP) | **Controller** (we chose to run a website; GDPR Art. 4(7)); Data Fiduciary under DPDP | **Processor** for app traffic (Fly privacy policy, DPA at fly.io/documents) | Fly exposes no edge access logs to customers; internal retention **unpublished (UNVERIFIED)**; `fly logs` keeps app stdout ~7 days. Fly is US-based, DPF-certified; 34 sub-processors |
| 3 | Caddy container (our config) | Would see `Fly-Client-IP`, path, UA | Yes, if logged | Controller | n/a | **No `log` directive → Caddy writes no access log** (Caddy default). Spec "Minimal hosting logs" makes this a tested guarantee |
| 4 | Pimlico bundler/paymaster (Austerlitz Labs Ltd, UK) | Client IP, Origin, user agent, smart-account address (sender), userOp calldata (ciphertext blob, locators, vaultId), signatures, sponsorship policy ID | **Yes** (IP; account address linked to IP) | **Controller** (we choose Pimlico and embed it in our app) | **Processor** (Pimlico self-describes as sub-processor for customers); **no DPA/SCCs published, retention unstated (UNVERIFIED)** | Ask Pimlico for a DPA and retention; UK adequacy for EU→UK transfers |
| 5 | Public chain (OP Sepolia → OP Mainnet) | Smart-account address, vaultId, locators (≤8), blob: RP ID, key count N, credential IDs, PRF salts, wrapped keys, ciphertext; timestamps; `VaultCreated.owner` | **Likely yes for GDPR** (pseudonymous identifiers that a node operator, bundler or the user can link; credential IDs are stable device-bound IDs). Ciphertext is PD for anyone with a key, arguably not for others (SRB relative test) | **Controller** for the decision to publish (we designed the protocol, the app builds and signs the transaction), jointly with the user who submits it; EDPB 02/2025 treats a dApp provider that determines on-chain processing as a controller | Validators/sequencer/nodes: neither our processors nor controllers we instruct (no contract) | **Permanent, public, cannot be erased** |
| 6 | Arweave via ArDrive Turbo (Permanent Data Solutions Inc., US) + arweave.net gateway (ar.io, NL; operator UNVERIFIED) | Upload: client IP, signed data item = blob + tags `App-Name`, `CryoShield-Vault-Id`, `CryoShield-Version`, `CryoShield-Locator`×N, ephemeral uploader public key; reads: IP, GraphQL query (vaultId, locators) | Yes (IP; same pseudonymous IDs as #5). Uploader key is ephemeral per session, so it does not link sessions | Controller (upload decision) | Turbo/gateway: independent controllers of their logs (their own ToS/privacy, no DPA offered to us; UNVERIFIED) | Data permanent; gateway may blocklist but the network keeps it |
| 7 | Public RPCs (`sepolia.optimism.io`/OP Labs; publicnode; drpc) | IP, `eth_call`/`eth_getLogs` params (locators, vaultIds) | Yes (IP linked to locator lookups = "this IP owns this vault") | Controller (we chose the endpoints) | Independent controllers in practice (no contract); OP Labs logging policy **unpublished (UNVERIFIED)**; PublicNode ≤24h; dRPC weekly purge | Plan: rotate/let user choose RPC; disclose |
| 8 | Cloudflare Web Analytics (landing `/` only, beacon only, `add-privacy-preserving-analytics`) | IP + UA in transit; page path (query and fragment stripped first), referrer, Performance API timings; country derived from IP | Yes in transit (IP). Cloudflare says IPs are not stored and no cookies or localStorage are used (cloudflare.com/web-analytics, H for the claim) | Controller | Processor (Cloudflare DPA, cloudflare.com/cloudflare-customer-dpa; sub-processors cloudflare.com/gdpr/subprocessors) | Metadata processed in US + EU data centres; EU-only needs the Enterprise Data Localization Suite (M). Retention UNVERIFIED |
| 9 | GitHub (public repo, issues, private vulnerability reports, Actions) | Reporter/contributor GitHub accounts, emails in commits, report contents | Yes | Controller for report handling; GitHub is an independent controller of its users' accounts | GitHub: controller of accounts; processor for our repo content (GitHub DPA for org customers; UNVERIFIED for free plan) | Delete reports/issue content on request where we control it |
| 10 | Email (security@ / privacy@ / grievance@) | Sender address, request contents, possibly account address | Yes | Controller | Mail provider = processor (provider not chosen yet: **founder decision**) | Retain 3 years after closure (DPDP Rules log-retention minimum is 1 year; lawyer to confirm) |
| 11 | Domain/DNS (GoDaddy), CAA iodef mail | WHOIS (company, not users) | No user PD | n/a | n/a | n/a |
| 12 | Desktop recovery tool | Runs locally; contacts preset RPCs and Arweave gateway like #6–7 | IP to RPCs | Neither for local processing; controller only for the default RPC choice | Same as #7 | No telemetry (by design) |

## Browser-side device storage

None. CryoShield's code sets no cookie and uses no localStorage, sessionStorage, IndexedDB, Cache Storage or service
worker on any route (`apps/web/legal/storage-inventory.json`, enforced by a build scan and an E2E sweep). The
Cloudflare beacon (row 8) states it uses no client-side state.

## Sources

Inventory sources: Fly privacy policy https://fly.io/legal/privacy-policy/, sub-processors https://fly.io/legal/sub-processors/,
logging https://docs.fly.io/monitoring/logging-overview (H); Pimlico https://www.pimlico.io/privacy and /tos (H);
ArDrive https://ardrive.io/tos-and-privacy/ (H); ar.io https://ar.io/legal/terms-of-service-and-privacy-policy/ (H);
PublicNode https://www.publicnode.com/privacy, dRPC https://drpc.org/privacy-policy (M); Optimism
https://www.optimism.io/data-privacy-policy (does not cover RPC traffic).
