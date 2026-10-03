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
| Privacy, grievance and security email | mail provider (10) | 3 years after closure (at least the 1-year DPDP log minimum) **[lawyer]** |
| Admin audit exports (Fly, GitHub, Pimlico, DNS) | CryoShield | 1 year rolling, India-resident store (CERT-In 180 d / DPDP 1 y) |
| On-chain and Arweave data | public networks (5, 6) | permanent; outside anyone's control |
| Aggregate metrics | CryoShield | indefinite (not personal data) |
