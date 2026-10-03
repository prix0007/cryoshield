# Data retention

> Source: design D8 of `add-privacy-and-compliance`. **[lawyer]** items are open.

| Data | Holder (inventory row) | Retention |
|---|---|---|
| Caddy request logs | CryoShield (3) | none (none written; tested by `deploy/test/container.test.ts`). If counsel requires them: truncated-IP format, 180 days (CERT-In) or 1 year (DPDP Rule 8(3)), then deleted |
| Fly platform logs | Fly.io (2) | Fly's policy (unpublished); `fly logs` ~7 days |
| Pimlico bundler/paymaster logs | Pimlico (4) | Pimlico's policy (unpublished; requested) |
| ArDrive Turbo / arweave.net logs | Turbo, ar.io (6) | each vendor's policy |
| Public RPC logs | OP Labs / PublicNode / dRPC (7) | unpublished / ≤24 h / weekly purge |
| Cloudflare Web Analytics | Cloudflare (8) | Cloudflare's policy (UNVERIFIED); aggregate dashboard |
| GitHub issues, reports, commits | GitHub (9) | until deleted by us or the author |
| Privacy requests and grievances (GitHub issues, private advisories) | GitHub (10) | issues: until deleted/redacted on request; private advisories: at most 3 years after closure. No email exists |
| Admin audit exports (Fly, GitHub, Pimlico, DNS) | the maintainer | 1 year rolling, maintainer-held (re-scoped by adopt-oss-project-defaults) |
| On-chain and Arweave data | public networks (5, 6) | permanent; outside anyone's control |
| Aggregate metrics | CryoShield | indefinite (not personal data) |
