# Proposal

## Why

The web app is built and tested, but it has no public home. The founder wants it at **https://cryoshield.app**, which is
also the WebAuthn RP ID, on Fly.io in the existing `cryoshield` org. Hosting a WebAuthn vault has sharp edges:
- clickjacking (a meta CSP can't set `frame-ancestors`);
- secrets leaking into images or config;
- a served bundle that differs from the one we verified;
- an RP ID mismatch that would orphan every vault in the browser.

This change makes hosting safe, repeatable, and reviewable.

## What Changes

- **Prebuilt, verified static files.** `dist/` is built locally with the existing reproducible `pnpm build` (reads
  `apps/web/.env` and `contracts/deployments/<chainId>.json`) and checked with `verify-build`. The Docker image only
  copies those files into a minimal Caddy server, pinned by image digest. There are no build args, no secrets, and no
  `.env` in the image or in `fly.toml`.
- **Security headers over HTTP:**
  - a CSP derived from the built meta tag, plus `frame-ancestors 'none'`;
  - `X-Frame-Options: DENY`, HSTS (2 years, subdomains, preload), `Referrer-Policy: no-referrer`, `nosniff`,
    COOP `same-origin`, CORP `same-origin`;
  - a `Permissions-Policy` that allows only WebAuthn (and clipboard-write) for self;
  - no `Server` banner.
- **Caching:** `index.html` is `no-cache`; hashed `/assets/*` are `immutable`. Unknown paths return 404, with no SPA
  fallback (the app has no client-side routes). `/healthz` serves the health check.
- **`fly.toml`:** app `cryoshield-web`, region `sin`, port 8080, `force_https`, auto stop/start with one machine always
  running, an HTTP health check, no volumes, no secrets.
- **`apps/web/deploy/deploy.sh`.** It refuses unless the git tree is clean and `VITE_RP_ID` equals the hostname being
  deployed. It then builds and verifies twice for reproducibility, generates the Caddy context, and only then runs
  `fly deploy`.
- **A runbook** (`apps/web/deploy/README.md`): app creation, certificates, the GoDaddy DNS records, verification, and
  the permanence of the RP ID.

**Out of scope:**
- running any `fly` command that creates, modifies, or deploys anything (the overwatcher runs those after review);
- the GoDaddy DNS changes themselves (the founder makes them);
- CI/CD auto-deploy;
- IPFS/ENS pinning;
- a CDN in front of Fly.

**Runtime dependencies:** Fly.io hosts static files only. Caddy serves files; it has no application logic, no admin
API, and no state. It is not an application backend, and it never sees PRF outputs, keys, or plaintext. All vault
operations stay client-side, against the same third-party endpoints as before.

## Capabilities

### New Capabilities
- `web-hosting`: how the static web app is packaged, served (headers, caching, health), deployed to Fly.io, and bound
  to its RP ID domain.

### Modified Capabilities
- None.

## Impact

- **New:**
  - `apps/web/fly.toml`;
  - `apps/web/deploy/` (Dockerfile, Caddyfile generator, deploy.sh, README, tests);
  - `apps/web/.dockerignore`;
  - `apps/web/vite-plugins/security-headers.ts`, the single source for the non-CSP headers;
  - `apps/web/scripts/verify-build.mjs` gains a `--real-env` production mode.
- **External:** Fly app `cryoshield-web` in org `cryoshield`, and a certificate for `cryoshield.app` (plus `www`).
  GoDaddy DNS records.
- **Cost:** one shared-cpu-1x / 256 MB machine, always on (about $2/month), plus outbound bandwidth.
