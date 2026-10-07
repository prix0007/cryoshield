> **Archive after:** add-continuous-deploy, gate-production-deploys, deploy-skip-when-unconfigured (this change REMOVES and MODIFIES their requirements).

## Why

The founder asked on 2026-10-05: "Make as such a release triggers production, else main merge triggers development deployment via op sepolia."

Today every commit on `main` goes to https://cryoshield.app once the owner approves it in the `production` environment (`gate-production-deploys`). The founder decided that a merge should not wait for an approval (PR #32, folded into this change). Without one, audit finding CI-C1 would be open: an agent (Write role) could get code to production through a PR, the LLM review and auto-merge alone. Splitting the targets keeps a fast, automatic loop for `main` and puts a human step, owned by the repository owner, in front of production.

## What Changes

- **Development target.** A merge to `main` (push, the existing 15-minute schedule that catches auto-merges, or `workflow_dispatch`) deploys to a new Fly app, `cryoshield-web-dev`, at `https://cryoshield-web-dev.fly.dev`. The new workflow `.github/workflows/deploy-dev.yml` does this with no approval, using two new GitHub Environments:
  - `development` holds only the dev app's `FLY_API_TOKEN`;
  - `development-build` holds the `VITE_*` build config and the `VITE_BUNDLER_URL` secret.

  Both are deployable from `main` only. Dev runs on OP Sepolia. It is served on its own `fly.dev` name, and its WebAuthn RP ID is `cryoshield-web-dev.fly.dev`. `fly.dev` is on the Public Suffix List, so this is a **different registrable domain** from `cryoshield.app`. WebAuthn only lets a page use its own host, or a registrable-domain suffix of it, as the RP ID. A dev page therefore cannot assert `rpId: 'cryoshield.app'`, and code that reaches dev without a human step can never request PRF outputs for production vaults. `dev.cryoshield.app` is retired: it would have allowed exactly that. Dev sends `X-Robots-Tag: noindex, nofollow` on every response (header only: no dev `robots.txt`, which another change owns for production), and it has no analytics beacon.
- **Production target.** `.github/workflows/deploy.yml` now runs only when:
  - a GitHub Release is published for a tag `v*`; or
  - the owner starts `workflow_dispatch` **at** a `v*` tag (`gh workflow run deploy.yml --ref vX.Y.Z`, no inputs), to redeploy or roll back to an earlier release.

  The tagged commit must be reachable from `main`, and missing production config fails the run. The workflow runs the full CI on that commit, builds in `production-build`, and releases to `cryoshield-web` (https://cryoshield.app) in `production`, with no reviewer. The release job re-checks, right before deploying, that the tag still points at the commit and that the commit is still reachable from `main`. Releases are not polled. The chain is whatever `production-build` configures: OP Sepolia today, OP Mainnet later, by changing environment variables only.
- **Only the owner can ship to production.**
  - A tag ruleset as code (`.github/rulesets/release-tags.json`, synced by `apply.sh`) restricts creating, updating and deleting `refs/tags/v*`, with the repository admin role as the only bypass actor.
  - The production workflow runs only when `github.triggering_actor` is the repository owner.
  - `production` and `production-build` are deployable **only from `v*` tags** (no branch, not even `main`), so the only path to production secrets is an admin-created tag.
- **Per-target parametrisation:**
  - `deploy.sh` takes `DEPLOY_TARGET=production|development` (host, Fly app, Fly config, noindex);
  - `gen-context.mjs --noindex` adds the dev-only header;
  - `smoke.sh` checks that the noindex header is present on dev and absent on production;
  - `previous-image.sh` and `rollback.sh` take the app and config.
- **Policy.** `workflow-policy.mjs` gets one profile per deploy workflow. Each Fly token's environment can be used only by its own workflow's release job, and no other workflow may use any of the four environments or `FLY_API_TOKEN`. The `supersede` job, its script and the policy's only `actions: write` exception are removed: with no approval, runs never wait, and pending releases are replaced natively by concurrency.
- **CI.** Unchanged: both production events run at the tag, so the reusable `ci.yml` tests the tagged commit as the run's own commit.
- **Folds in PR #32** (which failed ECC review; its OpenSpec change is dropped): this change removes the owner-approval requirement of `gate-production-deploys`, and carries the security review (threat table, compensating controls, explicit acceptance for dev, mainnet re-gate criterion), its `apply.sh` test fixes (single-property drift cases, reviewer removal) and its fix to look up the owner only when an environment names `@owner`.
- **Policy hardening (ECC review of PR #33):**
  - no `always()`/`failure()`/`cancelled()` in deploy job conditions;
  - config-dependent jobs require `configured == 'true'`;
  - the dev workflow never references the analytics token;
  - `gen-context.mjs` parses arguments strictly, and accepts only the two host/noindex pairs.
- **Docs:** `docs/deploy.md`, `CLAUDE.md` (step 9), `README.md`, `apps/web/deploy/README.md`, `docs/agent-account.md`, `docs/system-design.md`, and the audit report (CI-C1 partly restored).

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `continuous-deployment`: `main` goes to development; production only from an owner-published release; owner-only tag ruleset.
- `ci-pipeline`:
  - the deploy workflow restrictions and the deploy environment policy now cover two workflows;
  - "Unconfigured deploys skip without failing" now covers both workflows: dev skips, and production fails.

## Out of scope

- Re-adding a required reviewer on `production`. The owner-only release is the human step.
- Creating the Fly app, the DNS records, the environments or the secrets. The owner does these once; `docs/deploy.md` gives the commands.
- OP Mainnet. Production keeps whatever chain `production-build` configures.
- A separate dev contract deployment. Dev uses the OP Sepolia registry recorded in `contracts/deployments/`.
- Automatic release creation (release-please or similar). Agents never create releases or tags.

## Impact

- **Runtime dependencies:** none new. The dev site is another static Caddy container on Fly, with the same allowed pieces (public RPC, third-party bundler/paymaster, Arweave). It is not a CryoShield-operated backend.
- **Security:** see `design.md` → Threats and Security review.
  - Dev auto-deploys on another registrable domain under its own RP ID, so code that reaches dev without a human step can never request PRF outputs for production vaults (T1 resolved).
  - CI-C1 is partly restored: production needs the owner's release.
- **Operations:** the owner must, once:
  - create the app-scoped deploy token for `cryoshield-web-dev` (the app already exists, and serves on its `fly.dev` name);
  - delete the DNS records for `dev.cryoshield.app` (its Fly certificate is already removed);
  - run `apply.sh --environments --apply` (the environments and the tag ruleset);
  - fill in `development-build`.

  Until `development-build` is configured, the dev workflow skips without failing (`deploy-skip-when-unconfigured`).
