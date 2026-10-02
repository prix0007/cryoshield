# Hosting runbook: https://cryoshield.app on Fly.io

OpenSpec change: `add-fly-hosting`. The site is static: Fly runs one small Caddy container that serves the locally built,
verified `dist/`. There are no secrets in the image or in `fly.toml`.

| File | Purpose |
|---|---|
| `fly.toml` | App `cryoshield-web`, region `sin`, port 8080, `force_https`, health check `/healthz`, one warm machine |
| `deploy/Dockerfile` | Caddy 2.11.4 (alpine), pinned by digest, non-root; copies only `deploy/.build/` |
| `.dockerignore` | Whitelists `deploy/.build/` only (no `.env`, no sources) |
| `deploy/gen-context.mjs` | Writes `deploy/.build/site` (= `dist/` minus `_headers`) and a `Caddyfile` whose CSP is taken from the built `index.html` meta tag, plus `frame-ancestors 'none'` |
| `deploy/deploy.sh` | Guarded deploy (below) |
| `vite-plugins/security-headers.ts` | Single source for the non-CSP security headers |

## 0. Prerequisites

- `contracts/deployments/<VITE_CHAIN_ID>.json` exists. For the testnet that is `11155420.json`; until the solidity
  engineer deploys, the build fails, by design.
- `apps/web/.env` is filled in (see `.env.example`) with `VITE_RP_ID=cryoshield.app`. It is git-ignored and never enters
  the image.
- The Pimlico API key is restricted to origin `https://cryoshield.app` (see `docs/paymaster-policy.md`).

## 1. Create the app (once) [overwatcher]: DONE

```sh
fly apps create cryoshield-web --org cryoshield
```

Already done: a shared IPv4 `66.241.124.125` and a dedicated IPv6 `2a09:8280:1::1a4:b64:0` are allocated
(`fly ips list --app cryoshield-web`), and certificates are requested for `cryoshield.app` and `www.cryoshield.app`.

## 2. Deploy [overwatcher]

```sh
apps/web/deploy/deploy.sh          # DEPLOY_HOST defaults to cryoshield.app
```

`deploy.sh` refuses unless:
1. no `VITE_*` variable is exported (it would override `.env`);
2. the git tree is clean, untracked files included;
3. there is no `.env.local`, `.env.production`, or `.env.*.local` in `apps/web` (Vite would let them shadow `.env`);
4. `VITE_RP_ID` in `apps/web/.env` equals the deploy host;
5. `verify-build --real-env` passes: two production builds with the real `.env` are byte-identical, the bundle checks
   pass (no source maps, console, dev build, local paths, or E2E code; strict CSP), and the bundle's RP ID equals the
   host.

Only then does it generate `deploy/.build/` and the release manifest, and run
`fly deploy --config fly.toml --remote-only --app cryoshield-web`.

### Publish the release manifest (every deploy)

`deploy.sh` writes `deploy/.build/release-manifest.json` and prints its `treeHash`. The manifest holds:
- the git commit;
- `treeHash` = sha256 over the `shasum -a 256` lines of every served file, sorted (`LC_ALL=C`);
- the per-file hashes;
- a config summary (chain ID, RP ID, registry address and deploy block, and connect-src **origins only**; no API key,
  policy ID, or other key values).

Publish it as a GitHub release asset for the deployed commit:

```sh
gh release create web-$(git rev-parse --short HEAD) apps/web/deploy/.build/release-manifest.json \
  --target $(git rev-parse HEAD) --title "cryoshield.app $(git rev-parse --short HEAD)" \
  --notes "Served bundle treeHash: $(jq -r .treeHash apps/web/deploy/.build/release-manifest.json)"
```

**Anyone can check it:**
1. Check out the commit.
2. Create `apps/web/.env` with the published config. The Pimlico key and policy ID are visible in the served bundle.
3. Run `pnpm --filter @cryoshield/web build`, then `rm dist/_headers`.
4. Compare: `cd dist && find . -type f | sed 's#^./##' | LC_ALL=C sort | while read f; do shasum -a 256 "$f"; done | shasum -a 256`.
5. You can also hash the live files directly: `curl -s https://cryoshield.app/<path> | shasum -a 256` against
   `files[]`.

## 3. Certificates [overwatcher]: requested

```sh
fly certs add cryoshield.app --app cryoshield-web
fly certs add www.cryoshield.app --app cryoshield-web
```

Every non-canonical host (`www.cryoshield.app`, `cryoshield-web.fly.dev`, raw IPs) gets a **301 to
`https://cryoshield.app{uri}`**, except `/healthz`. There is one canonical origin, equal to the RP ID. The redirect
target host is a constant, so it can't be used as an open redirect.

## 4. DNS and account hardening at GoDaddy [founder]

**Before touching DNS:**
- **2FA with a hardware security key** on the GoDaddy account and on every Fly.io account in the `cryoshield` org.
  Whoever controls DNS or the Fly app can serve a phishing page on our RP ID that captures PRF outputs.
- Turn off GoDaddy **domain forwarding** and **parking** for `cryoshield.app`, and delete the default "Parked" `A @`
  record.
- Enable **auto-renew** and the registrar **domain lock**.

**Records** (GoDaddy → Domain → DNS → Manage DNS for `cryoshield.app`):

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | `66.241.124.125` | 600 |
| AAAA | `@` | `2a09:8280:1::1a4:b64:0` | 600 |
| CNAME | `www` | `cryoshield-web.fly.dev` | 600 |
| CNAME | `_acme-challenge` | `cryoshield.app.rkqjzy6.flydns.net` | 600 |
| CNAME | `_acme-challenge.www` | `www.cryoshield.app.rkqjzy6.flydns.net` | 600 |
| CAA | `@` | `0 issue "letsencrypt.org"` | 3600 |
| CAA | `@` | `0 issuewild ";"` (no wildcard certs) | 3600 |
| CAA | `@` | `0 iodef "mailto:security@cryoshield.app"` (optional: misissuance reports) | 3600 |

Notes:
- **CAA:** Fly.io issues certificates through **Let's Encrypt** (Fly custom-domain docs). Any other CA is refused once
  the CAA record exists. If Fly ever switches CA, `fly certs show` will report validation errors: update CAA first.
- **No ALIAS/ANAME at the apex on GoDaddy**, so the apex A/AAAA values are hard-coded copies of Fly's IPs. After any IP
  change (`fly ips release` / `allocate`, or an app re-creation), re-check `fly ips list --app cryoshield-web` and update
  both records. A stale record would send users to someone else's server.
- **DNSSEC:** enable it at GoDaddy (Domain → DNS → DNSSEC), so resolvers can detect forged answers for our RP ID.
  GoDaddy-hosted DNS signs the zone and publishes DS records at the `.app` registry.
- `.app` is on the HSTS preload list, so browsers never use plain HTTP for it.

## 5. Verify [read-only]

```sh
fly certs show cryoshield.app --app cryoshield-web       # Status: Ready / Issued
fly certs show www.cryoshield.app --app cryoshield-web
fly certs check cryoshield.app --app cryoshield-web
curl -sI https://cryoshield.app/ | grep -iE 'content-security-policy|x-frame-options|strict-transport|permissions-policy|referrer-policy|x-content-type|cross-origin|cache-control|^server'
curl -sI https://www.cryoshield.app/ | grep -iE '^(HTTP|location)'   # 301 -> https://cryoshield.app/
curl -s https://cryoshield.app/healthz                                # ok
```

Expected:
- `https://cryoshield-web.fly.dev/` → 301 to `https://cryoshield.app/`;
- `dig CAA cryoshield.app +short` shows the CAA records, and `dig DS cryoshield.app +short` shows a DS record (DNSSEC);
- the CSP header equals the page's meta CSP followed by `; frame-ancestors 'none'`;
- `X-Frame-Options: DENY`;
- HSTS `max-age=63072000; includeSubDomains; preload`;
- no `Server` header from Caddy (Fly's proxy may add its own `via` / `fly-request-id`, which is harmless).

## Rollback [overwatcher]

```sh
fly releases --app cryoshield-web                                   # read-only
fly deploy --app cryoshield-web --image <previous image ref>        # roll back
fly scale count 0 --app cryoshield-web                              # take the site offline
```

Vaults are on-chain, so taking the site down never affects them. Users can still recover with the desktop tool.

## The RP ID is permanent

`cryoshield.app` is the WebAuthn RP ID baked into every credential and every vault blob.
- **Once real vaults exist, the RP ID must never change**, and the domain must never lapse.
- If it changed, browser unlock would stop working for every existing vault. Only the desktop recovery tool, which
  talks to the keys directly, would still work.
- Keep the domain on auto-renew with registrar lock enabled.
- Never leave DNS records pointing at a deleted Fly app: a dangling record could let someone else claim the hostname
  and phish PRF outputs for our RP ID. If the app is ever deleted, remove the records first.

## Tests

```sh
pnpm --filter @cryoshield/web test:deploy   # generator, fly.toml, deploy.sh guards, verify --real-env, container (needs Docker)
```
