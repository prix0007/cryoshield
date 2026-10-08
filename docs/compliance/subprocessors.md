# Vendors and third-party services

> `add-privacy-and-compliance` design D10, updated 2026-10-08. CryoShield is an open-source project with no company
> (founder decision 2026-10-08), so it signs no data processing agreements: it relies on each vendor's **public**
> terms, privacy policy and (where published) DPA. Not legal advice. Every vendor row in
> [`data-inventory.md`](data-inventory.md) appears here and in [`retention.md`](retention.md).

| Vendor | Entity / country | What it does for CryoShield | Public terms relied on | Inventory row |
|---|---|---|---|---|
| Fly.io | Fly.io Inc., US; machines in Singapore (`sin`) | hosts `cryoshield.app` and `cryoshield-web-dev.fly.dev` | privacy policy, sub-processor list, DPA (fly.io/legal, fly.io/documents); EU-US DPF certified | 2 |
| Pimlico | Austerlitz Labs Ltd, UK | bundler and gas sponsorship | privacy policy and ToS (pimlico.io/privacy, /tos); no DPA published; retention unstated | 4 |
| ArDrive Turbo | Permanent Data Solutions Inc., US | Arweave upload and fast-finality index (`turbo-gateway.com`) | ardrive.io/tos-and-privacy | 6 |
| arweave.net gateway | ar.io; operator UNVERIFIED | Arweave reads | ar.io/legal/terms-of-service-and-privacy-policy | 6 |
| OP public RPC / PublicNode / dRPC | OP Labs (UNVERIFIED entity) / Allnodes / dRPC | chain reads (web app: OP Labs only) | their privacy pages; OP Labs RPC logging unpublished | 7 |
| Cloudflare Web Analytics (landing only) | Cloudflare, Inc., US; US + EU data centres | aggregate page analytics on `/` | cloudflare.com/cloudflare-customer-dpa, cloudflare.com/gdpr/subprocessors; EU-US DPF + SCCs | 8 |
| GitHub | GitHub Inc., US | source, issues, private advisories (the only contact channel), Actions (CI, metrics) | GitHub privacy statement and terms | 9, 10, 13 |
| GoDaddy | registrar | domain registration and the DNSSEC DS record (no user data) | n/a | 11 |
| Cloudflare DNS | Cloudflare, Inc., US | authoritative DNS for `cryoshield.app`, DNS-only (never proxied; no user traffic passes through Cloudflare) | cloudflare.com/cloudflare-customer-dpa | 11 |

There is no mail provider: CryoShield has no email address (`adopt-oss-project-defaults`).
