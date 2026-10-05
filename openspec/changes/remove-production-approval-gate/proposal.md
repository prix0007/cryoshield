## Why

The founder decided on 2026-10-05 that production releases should not wait for a manual approval ("no need to stop push for prod"). Every commit on `main` has already passed the PR checks, the ECC review and the full CI re-run on the merge commit, and the release job rolls back automatically on a failed smoke test. For a testnet-only site, the click adds delay without enough benefit.

## What Changes

- Remove the required reviewer from the GitHub Environment `production` (`.github/rulesets/environments.json`, applied with `apply.sh --environments --apply`). Releases deploy as soon as CI and the build pass on `main`.
- Keep everything else from `gate-production-deploys`: the Fly token only in `production`, build config in `production-build`, `main`-only branch policies, supersede, the HEAD re-check, the smoke test and automatic rollback.
- Update `CLAUDE.md`, `README.md`, `docs/deploy.md`, `docs/agent-account.md` and the audit report so they no longer promise an owner approval.
- `deploy.yml` is unchanged. Its comments still mention approval; they are corrected in a later workflow PR, because a workflow edit cannot auto-merge.

## Impact

- **Security (accepted risk):** this reopens audit finding CI-C1. A PR that passes CI and the LLM review reaches production with no human in the loop. The founder accepts this for the testnet phase. Mitigations that remain: rulesets, ECC review, workflow policy, the Fly token's isolation, rollback, and the `hold` label as the owner's veto before merge. The gate should be re-added before the OP Mainnet launch.
- Capability `continuous-deployment`: the owner-approval requirement is replaced by automatic releases.
