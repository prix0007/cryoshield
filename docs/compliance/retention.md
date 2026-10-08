# Data retention

> `add-privacy-and-compliance` design D8, updated 2026-10-08 for the open-source project (no company, founder decision
> 2026-10-08). Not legal advice.

| Data | Holder (inventory row) | Retention |
|---|---|---|
| Caddy request logs | CryoShield (3) | none: none are written (tested by `apps/web/deploy/test/container.test.ts`). If request logs are ever needed, only the truncated format of spec `privacy-compliance` "Minimal hosting logs", with a stated period |
| Fly platform logs | Fly.io (2) | Fly's policy (unpublished); `fly logs` ~7 days of container stdout, which holds no request data |
| Pimlico bundler/paymaster logs | Pimlico (4) | Pimlico's policy (unpublished) |
| ArDrive Turbo / arweave.net logs | Turbo, ar.io (6) | each vendor's policy |
| Public RPC logs | OP Labs / PublicNode / dRPC (7) | unpublished / ≤ 24 h / weekly purge |
| Cloudflare Web Analytics | Cloudflare (8) | Cloudflare's policy (UNVERIFIED); aggregate dashboard |
| GitHub issues, PRs, commits | GitHub (9) | until deleted by the maintainers or the author |
| Privacy requests and grievances (GitHub issues, private advisories) | GitHub (10) | issues: until deleted or redacted on request; private advisories: at most 3 years after closure. No email exists |
| Platform audit trails (Fly, GitHub, Pimlico, DNS) | each platform | the platform's own retention. No separate export: that export existed only to meet company log duties (N/A, OSS, founder 2026-10-08) |
| Product metrics reports | GitHub Actions (13) | 90 days (artifact); aggregate, no personal data |
| On-chain and Arweave data | public networks (5, 6) | permanent; outside anyone's control |
