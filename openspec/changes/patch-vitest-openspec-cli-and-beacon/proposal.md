# Proposal

## Why

The 2026-10-22 incident sweep (GhostAction, Shai-Hulud/tensorlake, LiteLLM, php2shell, GitLab, Zeabur) found no
compromised package, workflow, account or deployment in this repository. It did find three loose ends that the
weekly automation would otherwise reach late or never:

- **Vitest 5.0.3** carries GHSA-p458-7748-mcp3 (moderate, published 2026-10-16): Vitest 5 dev servers misapply
  Vite's `server.fs.deny`, so a client that reaches the server can read `.env`, private keys and `.git`. Only the
  UI, Browser Mode or the `api` option open a server; `vitest run` does not. `packages/vault-crypto` runs Browser
  Mode (`test:browser`), and `apps/web` has a real `.env` next to its config, so a developer machine is the exposure.
  Built sites are unaffected. Dependabot's 7-day cooldown would propose 5.0.5 on its next weekly run at the earliest.
- **`braces` (GHSA-vfj7-8cjw-p6xm / CVE-2026-93687)** is accepted until 2026-12-31 in `.github/osv-scanner.toml`,
  `.github/trivyignore.yaml` and the README as "no fix released". A fix now exists: OpenSpec CLI 1.14.3
  (2026-10-17) no longer depends on `braces`. The exception should go the moment it can; this change finds out
  whether it can.
- **Landing analytics has been off since 2026-10-15.** Cloudflare published beacon 2026.10.1; the SRI pin failed
  closed as designed and the weekly drift check failed on 2026-10-19 (run 39213035469). The
  `add-privacy-preserving-analytics` review-and-bump procedure (`apps/web/analytics/README.md`) has not yet been run.

## What Changes

- `vitest` 5.0.3 → 5.0.5 in `apps/web`, `packages/vault-crypto` and `tools/metrics`, and `@vitest/browser-playwright`
  5.0.3 → 5.0.5 in `packages/vault-crypto`; `pnpm-lock.yaml` resolves every `@vitest/*` package at 5.0.5 with new
  integrity hashes. Exact pins stay exact.
- `.github/openspec-cli`: the move to `@fission-ai/openspec` 1.14.3 was attempted and **held at 1.14.0** (design D2):
  1.14.3's `validate --all --strict` fails 84 requirements over 500 characters across 19 main specs and 9 in-flight
  changes (a rule added in 1.14.1), and splitting them is its own change. The `braces` exception stays in
  `.github/osv-scanner.toml` and `.github/trivyignore.yaml`; its README row and the TOML comment now say the fix
  exists and what blocks it, and the "as of" line is re-dated.
- `apps/web/analytics/beacon.lock.json`: reviewed bump to beacon 2026.10.1 (`sha384`, `bytes`, `version`,
  `reviewedBy`, `reviewedAt`, `reviewNotes`). The diff review is recorded in `design.md`.

## Out of scope

- The Caddy base-image CVEs in the README table (they wait for Dependabot's docker bump to an image built with Go
  1.26.9 or later).
- Splitting the 84 over-long requirements that block OpenSpec CLI 1.14.3 (a follow-up change; see design D2), and
  the globally installed `openspec` CLI on developer machines.
- Any change to how tests run (Browser Mode stays, no `server.fs.deny` override: the upgrade is the fix).
- The pending human security-reviewer sign-off on the beacon (`add-privacy-preserving-analytics` 6.1) and the
  self-hosting question (3.2); `reviewedBy` keeps saying the human sign-off is pending.
- Dependabot's own future PRs for the same versions; GitHub closes them once `main` carries the versions.

## Runtime dependencies

No new dependency and no CryoShield-operated backend. Vitest and the OpenSpec CLI are development and CI tooling
only and never ship. The beacon is the already-approved third-party Cloudflare Web Analytics script, loaded only on the
production landing page; this change only moves the pinned bytes to the version Cloudflare now serves.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. `ci-pipeline` ("Dependency vulnerability audit", "Container image and filesystem vulnerability scan") already
requires that exceptions expire and be recorded; removing one that is no longer needed is that requirement working.
`landing-analytics` ("Integrity-pinned beacon") already requires a reviewer-approved, committed hash and a manual
bump after drift; this change performs that bump. No behaviour changes, so `.openspec.yaml` sets `skip_specs: true`.

## Impact

- **Changed:** `apps/web/package.json`, `packages/vault-crypto/package.json`, `tools/metrics/package.json`,
  `pnpm-lock.yaml`, `.github/osv-scanner.toml` (comment only), `README.md`, `apps/web/analytics/beacon.lock.json`.
- **CI:** `web`, `vault-crypto`, `metrics` and the scan steps (osv-scanner, trivy) run; `verify-build` re-checks the
  beacon pin against the lock. `beacon-drift` passes again on its next schedule. `contracts` and `recover` are
  unaffected.
- **Users:** none visible. Landing-page analytics (aggregate, identifier-free) resumes for production visitors who have
  not set GPC or DNT.
