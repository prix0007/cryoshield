# Security review: add-fly-hosting

**Verdict: APPROVE**, with 2 MEDIUM and 3 LOW follow-ups, all fixed below. Reviewer: security-reviewer via the
overwatcher. Scope: `apps/web/deploy/`, `fly.toml`, `.dockerignore`, the header set, and `deploy/README.md`.

## Checks that passed

- **Clickjacking:**
  - the HTTP CSP equals the built meta CSP plus `frame-ancestors 'none'`, derived from the build output, never hand-copied;
  - plus `X-Frame-Options: DENY`;
  - the container test checks this on 200, 404 and 301 responses.
- **Secrets:**
  - no `.env`, sources, build args, or secrets in the image, the Docker context (`.dockerignore` whitelist), or
    `fly.toml` (tests check all three);
  - the Pimlico key is public by design, the same exposure as the bundle.
- **Bundle integrity:**
  - two production builds with the real `.env` are byte-identical;
  - bundle hygiene checks (no dev build, local paths, source maps, console, or E2E code);
  - the bundle's RP ID equals the deploy host.
- **Caddy hardening:**
  - pinned by digest, non-root (uid 65534), read-only web root;
  - `admin off`, `auto_https off`, `persist_config off`;
  - no `Server` header;
  - 404 with no SPA fallback; `_headers` never shipped.
- **Deploy guards:**
  - clean tree, exported `VITE_*` refused, `VITE_RP_ID` == host, verify before deploy;
  - `fly` is never reached on any failure (tested with stub binaries).
- **Platform:** `force_https`, HSTS 2 years with preload (`.app` is preloaded), health check, no volumes.

## Findings and fixes

| # | Sev | Finding | Fix | Test |
|---|---|---|---|---|
| 1 | MEDIUM | The runbook lacked account and DNS hardening. | README: hardware-key 2FA on GoDaddy and Fly; DNSSEC; CAA `issue "letsencrypt.org"` (Fly issues via Let's Encrypt), `issuewild ";"`, optional `iodef`; no apex ALIAS at GoDaddy, so A/AAAA are hard-coded and must be re-checked with `fly ips list` after any IP change; forwarding and parking off; auto-renew and lock; real IPs and ACME CNAMEs in the DNS table. | review |
| 2 | MEDIUM | There were no publishable build hashes, so third parties couldn't check what is served. | `deploy/release-manifest.mjs` (run by deploy.sh): commit, deterministic `treeHash` (sha256 of sorted `shasum -a 256` lines), per-file hashes, and a config summary with origins only (no key values). README documents publishing it as a GitHub release asset and how to rebuild and compare. | `deploy/test/release-manifest.test.ts` (determinism across runs and file order, equality with a coreutils pipeline, no `pim_`/`apikey`/policy ID) |
| 3 | LOW | deploy.sh didn't refuse `.env.local` / `.env.production` / `.env.*.local`, which Vite loads in production mode and which would shadow `.env`. | Refuse if any exist. | `deploy-sh.test.ts` (4 cases; `fly` never called) |
| 4 | LOW | Non-apex hosts other than www (for example `cryoshield-web.fly.dev`, raw IPs) served the app on a second origin. | Every non-canonical Host gets a 301 to `https://cryoshield.app{uri}` (constant target host, so no open redirect); `/healthz` is exempt. | `container.test.ts` (fly.dev, www, a foreign host, an IP, a `//evil.example` path, `/healthz` on every host, apex served) |
| 5 | LOW | The review record was missing. | This file. | n/a |

Open (tracked elsewhere):
- the first real deploy waits on `contracts/deployments/11155420.json`;
- the GoDaddy changes are the founder's.
