# Design

## Context

See proposal.md for the motivation. Constraints observed in the repo (2026-10-02):
- `vite-plugins/csp.ts` builds one CSP (`default-src 'none'`, `script-src 'self'`, `connect-src 'self' <origins>`,
  Trusted Types required) and injects it as a meta tag into `index.html`. `deploy/gen-context.mjs` copies that meta CSP
  into a single Caddy `header` block for every path, adding `frame-ancestors 'none'`. **Both the meta and the HTTP CSP
  are enforced, and a browser applies both**, so a per-route change needs per-document meta tags and per-path headers.
- Caddy has no `log` directive, so it writes no access log.
- `VaultRegistry` emits `VaultCreated(vaultId indexed, owner indexed, version, blobHash)`,
  `VaultUpdated(vaultId indexed, version, blobHash)`, `LocatorAdded(vaultId indexed, locator indexed)`. The blob header
  carries the key count N in cleartext (`docs/spec/vault-format-v1.md` §5). EntryPoint v0.6 emits
  `UserOperationEvent(userOpHash, sender indexed, paymaster indexed, nonce, success, actualGasCost, actualGasUsed)`.
- The recovery tool already pages `eth_getLogs` adaptively across public RPCs that cap block ranges.
- The landing page and the `/app` split do not exist on `main` yet. They arrive with `redesign-landing-and-app-ui`
  (branch `feat/ui-redesign`). On that branch today only `docs/design/visual-language.md` is pushed; the OpenSpec
  change itself was not visible on `origin` when this design was written (UNVERIFIED how it splits entries).

## Goals / Non-Goals

**Goals:** answer "how many vaults, how active, how much gas, is the mirror healthy" from public data; count landing
visits with no cookies and no identifiers; make it impossible by test for analytics to reach `/app`.

**Non-Goals:** funnels from landing to vault creation (that would need joining a visitor to an on-chain account,
which is exactly the tracking we refuse); per-user metrics; real-time dashboards.

## Decisions

### D1. Metrics run as a local CLI plus a weekly GitHub Action (one codebase)
- `tools/metrics` is a TypeScript CLI (viem, already a dependency of `apps/web`). It runs locally (`pnpm metrics --network op-sepolia`) and in `.github/workflows/metrics.yml` (weekly cron + manual dispatch), which uploads `metrics.json` as a 90-day workflow artifact.
- *Why both:* the Action gives a regular history without anyone remembering to run it and needs no secrets, because every input is public. The CLI lets anyone, including outside auditors, reproduce a number. Neither is a server we operate, so the "no backend" rule holds.
- *Alternatives rejected:*
  - a static dashboard page that queries RPCs from visitors' browsers: it adds `eth_getLogs` load to public RPCs on every view and an extra page to secure, for little benefit;
  - committing the JSON back to the repo: it needs `contents: write`, which breaks the CI hardening rule (`permissions: contents: read`);
  - The Graph, Dune or Goldsky: a third-party indexer adds an account and a dependency, and Dune does not index OP Sepolia well (UNVERIFIED). Revisit on mainnet if `eth_getLogs` paging becomes slow; Dune on OP Mainnet would be a good public dashboard then.

### D2. What is measured, and how
| Metric | Source |
|---|---|
| Vaults total, created per ISO week | `VaultCreated` count, block timestamps |
| Updates per week | `VaultUpdated` count |
| Keys per vault | key count N byte from the latest blob (`getVault`), as a distribution |
| Weekly active vaults | distinct vaultIds with any of the 3 events in the week (an "address" proxy: one account owns one vault, `OwnerAlreadyHasVault`) |
| Mirror coverage | Arweave GraphQL by `CryoShield-Vault-Id` + `CryoShield-Version`, byte-checked against `blobHash` |
| Sponsored gas | `UserOperationEvent` filtered by `paymaster` topic ∈ sponsor paymasters, `sender` ∈ vault owners; sum `actualGasCost` |
| USD bill | Pimlico dashboard, monthly, by hand (Pimlico bills in USD and adds 10% on mainnet, free on testnets: docs.pimlico.io/guides/pricing). A usage-export API is UNVERIFIED; the platform API lists sponsorship policies (docs.pimlico.io/references/platform/api/sponsorship-policies/list) |

- Output is aggregate only, and buckets under 3 are suppressed on public networks. Every input is public, but the report must not become a convenient index of who uses CryoShield, and aggregates keep the report outside personal-data rules.

### D3. Per-route CSP: two HTML documents, per-path headers in Caddy
- After the redesign, Vite builds two HTML entries: `index.html` (landing, `/`) and `app/index.html` (`/app`). `csp.ts` injects the **app CSP** into every document except the landing one, which gets the **landing CSP** = app CSP with exactly one extra `connect-src` origin.
- `gen-context.mjs` reads each HTML file's meta CSP and emits one Caddy `header` block per document path. The landing block uses `@landing path / /index.html`; the default block for every other path, including errors, is the app CSP. A test fails if any path other than those two gets the analytics origin.
- *Alternative rejected:* one CSP for all routes with the vendor origin in `connect-src`. Then a script injected into `/app` could exfiltrate to the vendor endpoint. Its event API only carries a short URL and props, but there is no reason to widen the app's egress.
- *Risk:* path normalisation. Caddy matches on the cleaned path, and `/app` serves `app/index.html`. Tests cover `/index.html`, `//`, `/App`, `/app/`, and `/%61pp` (task 4.4, task 6.1).

### D4. Vendor: Plausible Cloud, called by our own ~40-line client (no vendor package)
Comparison (sources in the research notes; confidence high unless marked):

| | Plausible | Simple Analytics | Fathom | Umami Cloud |
|---|---|---|---|---|
| Cookies/storage | none (npm package *reads* `localStorage.plausible_ignore`) | none | none | none (medium) |
| Visitor counting | daily-salted hash of IP+UA+domain, salt deleted after 24h; raw IP not stored | no IP/UA hash; referrer-based uniques; country from timezone | daily-salted signature, IP/UA up to 24h | hash with **monthly** salt; IP use UNVERIFIED |
| Owner / hosting | Estonia; Hetzner DE + Bunny SI | Netherlands; NL/DE/SI hosts | Canada; storage on **AWS USA** | Delaware; EU region option; sub-processors UNVERIFIED |
| First-party bundling | official npm tracker; documented Events API | no official bundle; proxy route serves vendor script | custom domains discontinued 2023 | MIT script, self-hostable |
| Endpoint | `POST https://plausible.io/api/event` (documented) | `queue.simpleanalyticscdn.com` | `cdn.usefathom.com` | `cloud.umami.is/api/send` |
| DNT / GPC | neither by default | DNT by default | DNT opt-in | DNT opt-in |
| Cheapest plan | $9/mo (10k pageviews) | free (30-day retention) or $20/mo | $15/mo | free hobby / $20/mo (medium) |
| Open source | CE AGPL-3.0 | scripts public, backend closed | closed | MIT |

Sources: plausible.io/data-policy, plausible.io/docs/events-api, plausible.io/dpa, docs.simpleanalytics.com/unique-visits,
simpleanalytics.com/subprocessors, usefathom.com/features/data-isolation, usefathom.com/legal/dpa,
docs.umami.is/docs/api/sending-stats, vendor pricing pages (accessed 2026-10-02).

**Decision: Plausible Cloud.** It is EU-owned and EU-hosted with a public DPA, and it has the only documented
first-party Events API meant for direct POSTs. That lets us skip the vendor's script entirely. We write the request
ourselves: `fetch('https://plausible.io/api/event', { method: 'POST', keepalive: true, credentials: 'omit',
referrerPolicy: 'no-referrer', body: JSON.stringify({ name: 'pageview', domain: 'cryoshield.app', url:
'https://cryoshield.app/' }) })`. The URL is a constant and no referrer is sent (D5). So:
- `script-src 'self'` is unchanged and no third-party code runs, which also sidesteps the npm tracker's localStorage
  read (banned by our lint) and any Trusted Types surprise;
- only `connect-src https://plausible.io` is added, on `/` only;
- we gate GPC/DNT ourselves (Plausible doesn't).

*Trade-off accepted:* Plausible's server needs the visitor's IP and UA to compute the daily hash, so the IP is seen in
transit by an EU processor and then discarded. Simple Analytics avoids even that and is the documented fallback if
the founder prefers "vendor never needs the IP" over first-party bundling and price.
*Rejected:* a Caddy `reverse_proxy` to Plausible. It would make the endpoint same-origin and dodge ad-blockers, but
Plausible requires the real client IP in `X-Forwarded-For`, so the same IP still reaches the vendor, now through our
edge. It also turns our static server into a forwarding proxy that needs its own tests. Ad-blocked visits are an
acceptable undercount.

### D5. Consent posture for the landing analytics
- **No cookies or storage** on the device, and the event is built from constants only: name, domain and a fixed URL.
  Nothing is read from the device (no referrer, screen size or URL parameters). The IP and UA are what the browser
  sends with any request.
- **The residual EU risk is real.** EDPB Guidelines 2/2023 v2 (7 Oct 2024), para 32, treats JavaScript that instructs
  the browser to send requests as "gaining access" under ePrivacy Art. 5(3), so "cookieless" alone is not an
  exemption. Two things narrow the risk: (a) the CNIL's audience-measurement exemption (publisher-only, anonymous
  statistics, IP not kept, user informed and able to object; cnil.fr "sheet n°16"); (b) the UK's new PECR statistical
  exception under the Data (Use and Access) Act 2025 (ico.org.uk "what are the exceptions"; in force from
  5 Feb 2026 per secondary sources, UNVERIFIED). Neither applies EU-wide.
- **Recommended posture:** no banner. Inform on `/privacy` and the landing footer, honour GPC/DNT as an objection, and
  keep the constant-only payload so there is as little "access" as possible. Mark this **needs lawyer review**
  (`add-privacy-and-compliance` D5). Founder decision: accept this residual EU risk or add a one-click opt-out. A
  remembered opt-out would need storage, which itself falls under 5(3) but is exempt as strictly necessary for the
  user's own request.
- **A banner becomes necessary** if we add cookies or storage, cross-site identifiers, a second vendor, campaign
  attribution, URL or referrer collection beyond the constant URL, or any analytics on `/app`.

## Risks / Trade-offs

- [Analytics leaks into `/app` through a shared chunk] → `verify-build` walks the `/app` module graph for the marker and origin (task 4.2); E2E network log (task 4.5).
- [Meta CSP and HTTP CSP disagree] → the container test compares header vs meta per document, as today.
- [Public metrics reveal adoption to competitors] → accepted; the data is public on-chain anyway.
- [Pimlico paymaster address changes] → `paymasters.json` lists all known addresses with a source URL; the report counts unknown paymasters separately so drift is visible.
- [`eth_getLogs` limits on public RPCs] → reuse the adaptive paging of the recovery tool; on mainnet consider a public indexer (D1).
- [Ad-blockers undercount] → accepted; analytics is directional only. Product truth comes from on-chain data.

## Migration Plan

Groups 1–2 ship independently. Groups 4–5 ship in one deploy after `redesign-landing-and-app-ui` and the `/privacy`
page exist. Rollback: remove the origin from the landing CSP config and redeploy. The client then fails closed, with
requests blocked by CSP and no errors shown.

## Open Questions

- Does `plausible.io/api/event` accept `Content-Type: application/json` cross-origin from a `fetch` with `credentials: 'omit'` (CORS preflight)? Verify in task 3.2; fall back to `text/plain` if needed. This does not change the design.
- Pimlico's OP Sepolia and OP Mainnet paymaster addresses for `paymasters.json` (task 1.5).
