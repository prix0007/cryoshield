# CryoShield

Permanent, non-custodial backup for the secrets you can't afford to lose (seed phrases, 2FA backup codes, recovery codes).

- Secrets are encrypted **in your browser**. CryoShield never sees them and runs no servers.
- Only your **FIDO2 hardware keys** (YubiKey 5, firmware ≥ 5.2) can unlock a vault. You enrol at least two, and any one of them opens it.
- The encrypted vault lives on an EVM rollup (**OP Mainnet**; currently testnet-only on **OP Sepolia**), mirrored to **Arweave**. Gas is sponsored, so you never need a wallet or crypto.
- If CryoShield disappears, the open-source **desktop recovery tool** still unlocks your vault, straight from the public chain.

> Status: pre-MVP. Not audited. Not deployed to any public network yet. Testnet target: OP Sepolia (chain 11155420). Get test ETH from the [Superchain faucet](https://console.optimism.io/faucet).

## Repository layout

| Path | What | Spec |
|---|---|---|
| `packages/vault-crypto` | Vault format v1: PRF → HKDF-SHA256 → AES-256-GCM envelope encryption, vaultId-bound AAD, Shamir option, test vectors | `openspec/specs/vault-crypto` · `docs/spec/vault-format-v1.md` |
| `contracts` | `VaultRegistry` (Foundry): no admin, no upgrades, append-only locator index | `openspec/changes/add-vault-registry-contract` |
| `apps/web` | Static web app: WebAuthn PRF, ERC-4337 passkey smart account, sponsored gas, Arweave mirror | `openspec/changes/add-web-app` |
| `tools/recover` | `cryoshield-recover` Python CLI (CTAP2 hmac-secret), an independent second implementation of the format | `openspec/changes/add-desktop-recovery-tool` |
| `docs/reviews` | Security review records | |

The system design (architecture, key derivation, flows, delivery pipeline) is in [`docs/system-design.md`](docs/system-design.md). The product requirements live in `.claude/PRPs/prds/cryoshield.prd.md`.

## How we work: OpenSpec is mandatory

Every feature, fix, and refactor starts as an OpenSpec change. No code is written without one.

```sh
openspec list              # active changes
openspec view              # dashboard
openspec validate --all --strict
```

Workflow: `/opsx:propose`, then implement with TDD via `/opsx:apply`, then a security review (required for any change touching crypto, contracts, the paymaster, or secret handling), then `/opsx:archive`. Project-wide constraints are in `openspec/config.yaml`.

## Development

Prerequisites: Node 22 and pnpm 9, Foundry 1.1.0, Python ≥ 3.10 with uv, and the openspec CLI 1.14.0.

```sh
pnpm install --frozen-lockfile

# crypto library
pnpm --filter @cryoshield/vault-crypto test

# contracts
cd contracts && forge test && forge snapshot --mc GasTest --check

# web app (unit, integration on local anvil, E2E with a virtual authenticator)
pnpm --filter @cryoshield/web test
pnpm --filter @cryoshield/web test:int
pnpm --filter @cryoshield/web test:e2e
pnpm --filter @cryoshield/web verify-build

# recovery tool
cd tools/recover && uv sync --locked && uv run pytest -q
```

Dependency install scripts are disabled (`pnpm.onlyBuiltDependencies: []`).

Real-hardware checklists:
- `apps/web/docs/hardware-test.md`
- `tools/recover/docs/manual-yubikey-test.md`

## Continuous integration

`.github/workflows/ci.yml` runs one job per area. Each job runs only when its paths change:
- `contracts`: build, tests, gas snapshot, Slither
- `vault-crypto`: Node and Chromium
- `recover`: Python 3.10 and 3.12
- `web`
- `openspec`: strict validation
- `workflow-lint`

- `pr-checks` (pull requests only), which runs on every PR event and checks:
  - the title follows Conventional Commits;
  - the OpenSpec gate passes;
  - gitleaks finds no secrets in the PR's commits;
  - osv-scanner finds no HIGH/CRITICAL vulnerabilities in any lockfile.

A final **`ci-ok`** job aggregates the results. Skipped jobs count as passing; failed or cancelled jobs fail it.

How the workflow is hardened:
- triggers are `push` (main) and `pull_request` only;
- `permissions: contents: read` at the top, and every job declares its own minimal permissions and a `timeout-minutes`;
- no secrets are referenced; PR title, body and labels reach scripts only through `env:`;
- every action is pinned by commit SHA, and the scanners are pinned by version and SHA-256 (Dependabot keeps them updated);
- checkouts don't persist credentials, and installs fail on lockfile drift;
- superseded PR runs are cancelled.

`workflow-lint` enforces these rules with actionlint, zizmor (pedantic persona) and `.github/scripts/workflow-policy.mjs`. Inline `zizmor: ignore` comments are rejected.

The gate scripts live in `.github/scripts` and are tested with `npm ci --ignore-scripts --prefix .github/scripts && npm test --prefix .github/scripts`.

## Contributing / PR workflow

`main` is protected by the ruleset in `.github/rulesets/main.json`. Every change, including the maintainer's, goes through a pull request. The step-by-step flow for agents and humans is in [`CLAUDE.md`](CLAUDE.md) → "Change flow (one PR per change)".

1. **OpenSpec first.** Propose a change under `openspec/changes/<name>/` before writing code (see above).
   - A PR that touches code or CI configuration (`apps/`, `packages/`, `contracts/src/`, `tools/recover/src/`, `.github/`, `scripts/`, `.gitleaks.toml`, the root workspace manifests or `contracts/foundry.toml`) must also add or modify something under `openspec/changes/`, archiving included.
   - The only exception is the `no-spec` label plus a `No-spec justification: <reason>` line in the PR description.
   - Dependabot PRs that touch only dependency manifests are exempt.
2. **Branch** from `main` with a prefix: `feat/`, `fix/`, `ci/`, `docs/` or `chore/`, for example `feat/shamir-recovery`.
3. **PR title** in Conventional Commits form, `type(scope)!: subject`, for example `fix(recover): handle empty log page`. It becomes the commit on `main`.
4. **Fill in the PR template:**
   - the OpenSpec change;
   - the tasks covered;
   - verification (the tests you ran);
   - a security-review link, or N/A;
   - screenshots for UI changes.
5. **Automatic ECC review** (`.github/workflows/ecc-review.yml`):
   - every push to a same-repo, non-draft PR gets one review from the ECC reviewer agents chosen by path;
   - it posts *request changes* on CRITICAL/HIGH findings, *comment* otherwise;
   - push fixes to re-run it, or, as the owner, comment `/ecc-review`;
   - fork PRs are refused;
   - it needs `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or `ANTHROPIC_API_KEY`, as both an Actions secret and a Dependabot secret.
6. **Auto-merge** (`.github/workflows/auto-merge.yml`):
   - every same-repo, non-draft, non-Dependabot PR squash-merges by itself once all required checks pass;
   - it is active only while `ecc-review` is a required check;
   - the `hold` label is the owner's veto.
7. **Merge rules:**
   - `ci-ok` must be green and up to date with `main`;
   - all conversations must be resolved;
   - squash merge only, so history stays linear;
   - force-pushes to `main` and deleting it are blocked;
   - no approval is required, since the single maintainer cannot approve their own PRs;
   - nobody can bypass these rules.

Secret-scan exceptions are in `.gitleaks.toml` (public test vectors only). Vulnerability exceptions are in `.github/osv-scanner.toml`; each needs a reason and expires within 90 days. Changing either one needs a security review.

**Applying the ruleset (repository admin, `gh auth login` with admin rights):**

```sh
.github/rulesets/apply.sh           # dry run: diff of live vs committed (exit 3 on drift)
.github/rulesets/apply.sh --apply   # create/update only what differs; idempotent
```

The script syncs:
- the `main` ruleset;
- the repository merge settings in `.github/rulesets/repo-settings.json` (squash only, PR title as the commit title, delete the branch on merge);
- the Actions workflow permissions in `.github/rulesets/actions-permissions.json` (read-only default token; Actions may not approve PRs);
- the `no-spec` and `hold` labels;
- auto-merge, enabled in the repository settings.

`ecc-review` is **not** a required check by default, and auto-merge stays off until it is.

To enable both:
1. Add the `CLAUDE_CODE_OAUTH_TOKEN` secret (or `ANTHROPIC_API_KEY`) twice: as an Actions secret and as a Dependabot secret.

   ```sh
   claude setup-token
   gh secret set CLAUDE_CODE_OAUTH_TOKEN
   gh secret set CLAUDE_CODE_OAUTH_TOKEN --app dependabot
   ```
2. Wait until an ECC review has succeeded on a PR.
3. Run `.github/rulesets/apply.sh --with-ecc-review --apply`.

Keep passing `--with-ecc-review` from then on: without it, `--apply` refuses to drop the requirement.

To change protection, edit those files in a PR and re-run the script after it merges.

## Deployment

Every new commit on `main` is deployed to https://cryoshield.app automatically by `.github/workflows/deploy.yml`, usually within 15 minutes of the merge:

1. **detect:** compare `https://cryoshield.app/release.json` with the `main` HEAD, and skip if they are equal.
2. **test:** run the **full** `ci.yml` on that exact commit.
3. **deploy:** run the guarded `apps/web/deploy/deploy.sh` in the GitHub Environment `production`.
4. **smoke:** check the routes, headers, registry address and `/release.json`. On failure, roll back to the previous image automatically.

The pipeline never runs on pull requests. To redeploy by hand, run `gh workflow run deploy.yml -f force=true`. To roll back, see [`docs/deploy.md`](docs/deploy.md), which also covers first-time setup and token rotation. Note that polling every 15 minutes costs about 2,900 Actions minutes a month on a private repo; the runbook lists cheaper cadences.

## Security

There is no external audit for the MVP. Mitigations: an open specification, deterministic cross-implementation test vectors, symmetric-only cryptography, and an internal adversarial review of every security-relevant change (`docs/reviews/`, `apps/web/docs/security-review.md`). Please report vulnerabilities privately, never in public issues: see [`SECURITY.md`](SECURITY.md) (scope, safe harbour, timelines) and [`/.well-known/security.txt`](https://cryoshield.app/.well-known/security.txt), or use [GitHub private vulnerability reporting](https://github.com/prix0007/cryoshield/security/advisories/new).

## License

[MIT](LICENSE). Every first-party package declares MIT, and `scripts/check-licenses.sh` enforces this in CI.
