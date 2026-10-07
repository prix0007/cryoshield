# Spec Delta

## MODIFIED Requirements

### Requirement: Main branch protection as code
The repository SHALL keep the `main` branch ruleset as a committed file in the GitHub ruleset API format, with a script that shows the difference from the live ruleset and applies it idempotently. The ruleset MUST require a pull request, conversation resolution, linear history, squash-only merges, and the required status checks (`ci-ok`, plus `ecc-review` once enabled) passing on the pull request's head commit. It MUST NOT require the branch to be up to date with `main`, so that auto-merge does not stall when another pull request merges first. Each `main` commit is re-verified by the deploy pipeline's full CI before deployment. The ruleset MUST block force-pushes and deletion, and grant no bypass.

#### Scenario: Direct push to main rejected
- **WHEN** anyone, the repository admin included, pushes a commit directly to `main`
- **THEN** GitHub rejects the push because a pull request is required

#### Scenario: Merge blocked until CI passes on current main
- **WHEN** a pull request's required checks are failing or missing on its head commit (whether or not that commit includes the latest `main`)
- **THEN** the pull request cannot be merged

#### Scenario: Another pull request merged first
- **WHEN** a pull request's required checks passed and `main` has since moved because another pull request merged
- **THEN** the pull request still auto-merges without needing a rebase, and the resulting `main` commit runs the full CI in the deploy pipeline before anything is deployed

#### Scenario: Re-applying an unchanged ruleset
- **WHEN** the apply script runs and the live ruleset already matches the committed file
- **THEN** it reports no difference and makes no write call
