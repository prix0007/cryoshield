# CryoShield: agent guide

CryoShield is a permanent, non-custodial backup for small secrets (seed phrases, 2FA/recovery codes), unlocked only by FIDO2 hardware keys via the WebAuthn PRF extension. Read `README.md` for the layout and commands, and `docs/system-design.md` for the architecture.

The ECC reviewer in `.github/workflows/ecc-review.yml` reads this file from `main`, so these rules are also the review rules.

## Project rules (non-negotiable)

The source of truth is `openspec/config.yaml`; the product requirements are in `.claude/PRPs/prds/cryoshield.prd.md`.

- **OpenSpec first.** Every feature, fix and refactor starts as an OpenSpec change (`openspec/changes/<name>/`). There is no code without an approved change. A deviation from the change's specs or design is a defect.
- **No CryoShield backend.** The only allowed runtime pieces are:
  - a static frontend;
  - public chain RPCs;
  - a third-party ERC-4337 bundler/paymaster;
  - Arweave.

  Never add a server we operate.
- **CryoShield never sees plaintext or key material.** All encryption happens client-side.
- **Symmetric-only crypto for vault data:** PRF → HKDF-SHA256 → AES-256-GCM key wrapping. No ECIES, RSA or ECDH. Public ciphertext must stay quantum-safe forever.
- **Key policy:** any single enrolled key unlocks a vault (1-of-N, N ≥ 2 at creation). The vault format must also support Shamir M-of-N.
- **Recovery without CryoShield.** The open-source desktop tool (`tools/recover`, CTAP2 hmac-secret) must read and unlock vaults from public RPCs or Arweave alone. The vault format records the RP ID, PRF salts, credential IDs and algorithm IDs.
- **Chain:** mainnet is OP Mainnet. Deploy only to OP Sepolia until funded. Contracts stay portable across OP Stack, Arbitrum and L1. A vault blob is ≤ 1 KB.
- **No external audit.** Use audited libraries (WebCrypto, `@noble/*`), the published spec (`docs/spec/vault-format-v1.md`) and deterministic cross-implementation test vectors (`packages/vault-crypto/test-vectors/`). Crypto and on-chain format changes must update and reference vectors.
- **TDD:** write the failing test first.
- **Security review:** any change touching crypto, contracts, the paymaster, secret handling or CI ends with a security-review task and record (`docs/reviews/`, or the change's `design.md`).
- **Secrets:** never commit secrets, real seed phrases or keys; test vectors only. The PR gates run gitleaks and osv-scanner. Exceptions live in `.gitleaks.toml` and `.github/osv-scanner.toml` and need a security review.
- **Non-technical users:** they never handle gas, seed phrases or wallets in the default flow.

## Change flow (one PR per change)

`main` is protected by `.github/rulesets/main.json`, admins included. Nothing reaches it except through a pull request.

1. **Branch** from an up-to-date `main` as `<type>/<change-name>`, with type one of `feat`, `fix`, `ci`, `docs` or `chore` (for example `feat/shamir-recovery` or `fix/recover-empty-page`). Use one OpenSpec change or one fix per branch.
2. **OpenSpec:**
   - propose the change (`/opsx:propose`), or continue an approved one;
   - implement it with TDD (`/opsx:apply`), ticking `tasks.md` as you go;
   - code paths without a change fail CI. The only exception is the `no-spec` label plus a `No-spec justification:` line.
3. **Build and test** on the branch with small Conventional Commits:
   - run the area's commands from `README.md` → Development;
   - `openspec validate --all --strict` must be green;
   - when touching CI, also run `npm test --prefix .github/scripts`.
4. **Open the PR** with `gh pr create`, using `.github/pull_request_template.md`. Fill in the OpenSpec change, tasks covered, verification, security review (or N/A) and screenshots for UI. The PR title is a Conventional Commit and becomes the squash commit.
5. **ECC review runs automatically.** `.github/workflows/ecc-review.yml` runs on `pull_request_target`, so it always comes from `main` and a PR cannot weaken its own gate. It:
   - picks the ECC reviewers from the changed paths;
   - checks the PR against its OpenSpec change and these rules;
   - verifies each finding;
   - posts one review as `github-actions[bot]`: *request changes* on any CRITICAL/HIGH finding, *comment* otherwise.

   The `ecc-review` check fails while blocking findings stand. The reviewing agent never touches GitHub, so text inside a PR cannot make it comment, approve or call the API. Plugin hooks are off, and the agent can write only its two output files. The check needs a `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` secret, as both an Actions secret and a Dependabot secret; without one it fails. Fork PRs are refused.
6. **Fix and ask for a re-review.**
   - Fix every blocking finding in new commits, and advisory ones where cheap.
   - Reply to each finding on the PR saying what changed, then push. Every push re-runs the review.
   - The owner can comment `/ecc-review` (as the first word) to re-run it without a push.
   - Repeat until no blocking findings remain.
7. **Watch the PR while it is open.** Check for new reviews and owner comments, and treat owner comments like findings: fix, push, reply. Mark your own PR comments with `<!-- claude-pr-flow -->` so they are never mistaken for the owner's.
8. **Auto-merge.** `.github/workflows/auto-merge.yml` turns on GitHub auto-merge (squash, delete branch) for every same-repo, non-draft, non-Dependabot PR into `main`.
   - It does so only while `ecc-review` is a required check (`apply.sh --with-ecc-review --apply`). Until then, the maintainer merges by hand after the review.
   - Once on, it merges the moment all required checks are green.
   - Branches do not need to be up to date with `main` (strict mode is off, change `relax-strict-up-to-date`), so a PR keeps auto-merging after another PR lands. Each resulting `main` commit is re-tested by the deploy pipeline before it goes live.
   - **Owner veto:** the `hold` label switches auto-merge off for that PR; remove it to switch it back on. `gh pr merge <n> --disable-auto` also works.
9. **Deploy.** After the merge, `.github/workflows/deploy.yml` deploys `main` automatically within about 15 minutes (on push for human merges, on its 15-minute schedule for auto-merges). It runs:
   - the full CI on the merge commit;
   - the guarded `deploy.sh --build-only` in a job without the Fly token;
   - `fly deploy` of that verified build;
   - a smoke test.

   Check what is live with `curl -s https://cryoshield.app/release.json`. If the deploy or smoke test fails, it rolls back by itself, the run fails, and that commit is not retried. Fix forward with a new PR, or roll back by hand (`docs/deploy.md` → Rollback).
10. **After the merge,** archive the OpenSpec change (`/opsx:archive`) in a follow-up PR.

   Merges made by the workflow token do not trigger `push` workflows on `main`. The deploy pipeline's full CI on the merge commit is the verification of the merged result.
