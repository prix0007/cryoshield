# Design

## Context

See proposal.md. The app is a static Vite build. Its CSP is injected as a meta tag by `vite-plugins/csp.ts`, which also
emits a Netlify-style `_headers` file that Fly doesn't read. `verify-build` already proves reproducibility and bundle
hygiene with a fake production env. The founder is in IST (UTC+5:30). flyctl v0.4.104 is authenticated, and the org
`cryoshield` has no apps (`fly apps list --org cryoshield`, read-only).

## Decisions

### D1. Prebuilt dist, minimal Caddy image
- `deploy.sh` builds `dist/` locally (production mode, the real `apps/web/.env`) twice, compares hashes, runs the bundle
  checks, then generates a Docker context at `deploy/.build/` containing `site/` (= `dist/` minus `_headers`) and a
  `Caddyfile`.
- The Dockerfile is `FROM caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b`,
  which copies the two and runs as a non-root user (D6).
- `.dockerignore` whitelists only `deploy/.build/`, so `.env`, `node_modules`, and sources never reach the builder.
- *Alternatives rejected:*
  - building inside Docker: needs the `.env` values as build args, and the image bytes would differ from the verified
    build;
  - nginx: `server_tokens off` still sends `Server: nginx`, and removing it needs extra modules. Caddy removes it with
    `header -Server`.

### D2. Headers from one source, CSP from the build output
- `vite-plugins/security-headers.ts` exports the non-CSP headers (`SECURITY_HEADERS`). Both `_headers` (`csp.ts`) and
  the Caddyfile generator use it.
- The generator reads the CSP from `site/index.html`'s meta tag, which is the built output, and appends
  `; frame-ancestors 'none'`. It fails if the meta tag is missing or already has `frame-ancestors`.
- The container test fetches `/` and compares the header byte for byte with the served page's own meta tag.
- **Permissions-Policy:** `publickey-credentials-get=(self), publickey-credentials-create=(self), clipboard-write=(self)`,
  and `=()` for camera, microphone, geolocation, payment, usb, hid, serial, bluetooth, display-capture, midi,
  accelerometer, gyroscope, magnetometer, and browsing-topics.
  - Clipboard-write is allowed because the Copy button uses it.
  - Cross-origin WebAuthn is never needed, since the RP is our own origin.
- **CORP `same-origin`** is added too; it is harmless for a single-origin site.

### D3. Caching, 404, health
- `/` and `/index.html`: `Cache-Control: no-cache`, so a new deploy is picked up immediately and the CSP is always the
  current one.
- `/assets/*`: `public, max-age=31536000, immutable`; the filenames are content-hashed.
- Anything else that exists (none today) gets no explicit cache header.
- Missing paths return 404 via `file_server` with the default error handling. There is no SPA fallback: the app has no
  URL routes, and a fallback would turn typos into 200s.
- `/healthz` responds `200 ok`, with no cache.

### D4. fly.toml
- **Region `sin` (Singapore).** The founder is in IST; Fly has no Indian region (`fly platform regions`: Asia Pacific
  is sin, nrt, syd), and sin is the nearest. Static files are tiny and served from one machine. Users elsewhere still
  get acceptable latency, and the heavy calls (RPC, bundler) go to third parties anyway.
- **Port:** `internal_port = 8080`, with Caddy listening on `:8080` (all interfaces, which includes `0.0.0.0` and
  Fly's IPv6 `fly-local-6pn`).
- **`force_https = true`.** HSTS covers the rest, and `.app` is HSTS-preloaded.
- **Machines:** `auto_stop_machines = "stop"`, `auto_start_machines = true`, `min_machines_running = 1`.
  - One warm machine avoids a 1–3 s cold start on a security product's first impression, for about $2/month.
  - Extra machines still stop when idle.
  - Setting it to 0 is a one-line change if cost matters more than first-load latency.
- **Health check:** HTTP `GET /healthz`, every 30 s, with a 5 s timeout.
- **VM:** `shared-cpu-1x`, 256 MB. No `[mounts]`, no `[env]`, no secrets. The org is chosen at `fly apps create
  --org cryoshield`; fly.toml has no org field.

### D5. deploy.sh order (fail closed)
1. Resolve the repo root and target host (`DEPLOY_HOST`, default `cryoshield.app`), and require `git`, `pnpm`, and
   `fly` on PATH.
2. `git status --porcelain` must be empty, counting untracked files (ignored files such as `.env` are fine).
3. `VITE_RP_ID` from `apps/web/.env` must equal `DEPLOY_HOST`.
4. `node scripts/verify-build.mjs --real-env`: two production builds with the real `.env`, identical hashes, plus
   the bundle checks.
5. The built bundle's `"rpId":"<host>"` must equal the host.
6. Generate `deploy/.build/` (site plus Caddyfile).
7. `fly deploy --config fly.toml --remote-only` (Fly's builders build the trivial image).

Tests run deploy.sh in a throwaway git repo with stub `pnpm`, `node`, and `fly` on PATH.

### D6. Non-root, read-only server
- Caddy runs with `admin off`, `auto_https off` (Fly terminates TLS), and no persistence.
- The official image runs as root by default, so the Dockerfile sets `USER` to a non-root uid. Port 8080 doesn't need
  privileges, and Caddy's data and config dirs aren't written because admin and auto-HTTPS are off.

### D7. Custom domain
- `fly certs add cryoshield.app` and `fly certs add www.cryoshield.app`. The records come from `fly certs show` /
  `fly ips list`: A and AAAA for the apex, and a CNAME `www → cryoshield-web.fly.dev`, or the `_acme-challenge` CNAME
  if pre-validating.
- **www:** Caddy redirects `Host: www.cryoshield.app` with a 301 to the apex. A ceremony on www would technically be
  allowed (RP ID `cryoshield.app` covers subdomains), but one canonical origin keeps the CSP, clipboard, and user
  expectations simple.

## Risks / Trade-offs

- [Fly adds its own response headers (`fly-request-id`, `via`)] → harmless. The container test checks our headers;
  the runbook adds a post-deploy `curl -I` check.
- [A dirty-tree check blocks hotfixes] → intentional: what's deployed must be reproducible from a commit.
- [`.env` holds the public Pimlico key] → it is public by design (shipped in the bundle). The image only gets the
  built bundle, the same exposure.
- [The registry deployment for 11155420 doesn't exist yet] → `deploy.sh` fails at the build step until the
  solidity engineer publishes `contracts/deployments/11155420.json`. This is correct, fail-closed behaviour.

## Migration Plan

This is the first deployment. Rollback is `fly releases` followed by `fly deploy --image <previous>`, or
`fly scale count 0` to take the site down. Vault data is on-chain and unaffected.
