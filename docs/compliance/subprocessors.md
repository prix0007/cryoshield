# Sub-processors and vendors

> Source: design D10 of `add-privacy-and-compliance`. Not legal advice; UNVERIFIED items are open founder/lawyer tasks
> (`add-privacy-and-compliance` 1.3). Every vendor row in [`data-inventory.md`](data-inventory.md) appears here and in
> [`retention.md`](retention.md).

| Vendor | Entity / country | Role | DPA | Transfer safeguard | Inventory row |
|---|---|---|---|---|---|
| Fly.io | Fly.io Inc., US; machine in Singapore (`sin`) | processor | pre-signed in dashboard (fly.io/documents) | EU-US DPF certified; SCCs UNVERIFIED | 2 |
| Pimlico | Austerlitz Labs Ltd, UK | processor | **none published; requested (task 1.3)** | UK adequacy (EU→UK) | 4 |
| ArDrive Turbo | Permanent Data Solutions Inc., US | independent controller (its ToS) | none | n/a; disclosed | 6 |
| arweave.net gateway | ar.io (Stichting, NL); operator UNVERIFIED | independent controller | none | n/a; disclosed | 6 |
| OP public RPC / PublicNode / dRPC | OP Labs (US/Cayman, UNVERIFIED) / Allnodes / dRPC | independent controllers | none | disclosed | 7 |
| Cloudflare Web Analytics (landing only) | Cloudflare, Inc., US; US + EU data centres | processor | cloudflare.com/cloudflare-customer-dpa (v6.4, 3 Apr 2026, M); sub-processors cloudflare.com/gdpr/subprocessors | EU-US DPF + SCCs (cloudflare.com/cloudflare-customer-scc) | 8 |
| GitHub | GitHub Inc., US | controller of accounts; hosts repo content, issues and private advisories (the only contact channel) | GitHub DPA (plan-dependent, UNVERIFIED) | DPF | 9, 10 |
| (no mail provider) | n/a: CryoShield is an open-source project with GitHub-only contact (adopt-oss-project-defaults) | n/a | n/a | n/a | 10 → GitHub |
| GoDaddy | registrar | n/a (no user data) | n/a | n/a | 11 |
