# Tasks

## 1. Header source and CSP derivation

- [x] 1.1 Write failing tests for `vite-plugins/security-headers.ts`: the exact HSTS, XFO, Referrer, nosniff, COOP, CORP and Permissions-Policy values, and WebAuthn allowed for self only. Implement, make `_headers` use it, and verify the existing CSP build tests still pass.
- [x] 1.2 Write failing tests for `deploy/gen-context.mjs`:
  - it copies `dist/` minus `_headers` into `deploy/.build/site`;
  - the Caddyfile CSP equals the meta CSP + `; frame-ancestors 'none'`;
  - it fails when the meta tag is missing or already has `frame-ancestors`;
  - cache rules, health, www redirect, `-Server`, admin off.
  
  Implement and verify.

## 2. Image and Fly config

- [x] 2.1 Add `deploy/Dockerfile` (Caddy pinned by digest, non-root, only `deploy/.build`) and `.dockerignore` (whitelist). Verify with a test that the build context contains no `.env` and that the image's `/srv` equals the generated site.
- [x] 2.2 Write a failing container test (`deploy/test/container.test.ts`: docker build + run, then fetch) asserting:
  - every security header and its exact value, and no `Server` header;
  - CSP == served meta CSP + frame-ancestors;
  - `no-cache` on `/` and `/index.html`, `immutable` on an asset;
  - 404 (with headers) on an unknown path and on `/_headers`;
  - 200 on `/healthz`;
  - a 301 www → apex.
  
  Implement until it passes.
- [x] 2.3 Add `fly.toml` (app `cryoshield-web`, `sin`, 8080, `force_https`, auto stop/start, min 1, `/healthz` check, no env/secrets/mounts). Verify with a test that parses it and asserts these fields and that it contains no secret-like values.

## 3. Guarded deploy script

- [x] 3.1 Add `verify-build.mjs --real-env`: two production builds with the real `.env`, identical, plus the bundle checks, leaving `dist/` in place. Verify it fails cleanly while `contracts/deployments/11155420.json` is absent, and passes with a fixture chain.
- [x] 3.2 Write failing tests for `deploy/deploy.sh` in a throwaway git repo with stub `pnpm`/`node`/`fly`: a dirty tree is refused and `fly` is never called; a `VITE_RP_ID` ≠ host mismatch is refused; a bundle RP ID mismatch is refused; on a clean tree with a matching host the steps run in order and end with `fly deploy --config fly.toml --remote-only`. Implement deploy.sh and verify.

## 4. Runbook

- [x] 4.1 Write `deploy/README.md`:
  - `fly apps create cryoshield-web --org cryoshield`, `deploy.sh`, `fly certs add` (apex + www), `fly ips list`;
  - the GoDaddy A/AAAA/CNAME (or `_acme-challenge`) records, and `fly certs show`;
  - a post-deploy `curl -I` header check;
  - rollback;
  - the RP ID permanence warning.
  
  Verify that every command in it is read-only or listed for the overwatcher.

## 5. Security review

- [x] 5.1 Security review of `apps/web/deploy/`, `fly.toml`, and the header set: clickjacking, CSP parity, secret exposure in the image/context/fly.toml, Caddy hardening (admin off, non-root, no banner), deploy guard bypasses, and DNS takeover risk (dangling records). Verify that all CRITICAL/HIGH findings are resolved and the review is recorded in `apps/web/docs/security-review-hosting.md`.

## 6. Review follow-ups (APPROVED with fixes; see apps/web/docs/security-review-hosting.md)

- [x] 6.1 README hardening: hardware-key 2FA on GoDaddy and Fly, DNSSEC, CAA (Let's Encrypt only, `issuewild ";"`, optional iodef), the hard-coded apex A/AAAA re-check note, forwarding and parking off, and the real IPs and ACME CNAMEs. Verify by review.
- [x] 6.2 Write a failing test, then implement `deploy/release-manifest.mjs`: a deterministic tree hash equal to the coreutils pipeline, and no key values. deploy.sh writes `deploy/.build/release-manifest.json`; README documents publishing it as a GitHub release asset.
- [x] 6.3 Write a failing test, then make deploy.sh refuse `.env.local`, `.env.production`, and `.env.*.local`.
- [x] 6.4 Write a failing container test, then implement: every non-apex host gets a 301 to `https://cryoshield.app{uri}` except `/healthz`, with no open redirect.
