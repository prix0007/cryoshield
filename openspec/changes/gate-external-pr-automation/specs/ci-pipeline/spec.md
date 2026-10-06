# Spec Delta

## ADDED Requirements

### Requirement: Trusted-author gate enforced by the workflow policy
The workflow policy SHALL require the trusted-author gate in `ecc-review.yml` and `auto-merge.yml`.

In the `ecc-review` review job, the gate MUST:
- be the step directly after the fork refusal, before any credential, checkout or model step;
- have no condition;
- receive its inputs only through `env:` (author, sender, owner, event time, default branch, token);
- not override its working directory;
- fail the job (`exit 1`) for non-trusted authors.

In the `auto-merge` job, the gate MUST be the first step, and every later step MUST be conditioned on its `trusted` output.

The gate run steps MUST be pinned by digest like every other privileged run step. The policy SHALL also validate `.github/trusted-authors.json` as a JSON array of 1 to 20 unique GitHub logins, with no bot accounts and no wildcards.

#### Scenario: Gate removed or moved
- **WHEN** a change deletes the gate step from `ecc-review.yml`, moves it after a checkout, or adds an `if:` to it
- **THEN** the workflow policy fails and names the gate

#### Scenario: Auto-merge step unguarded
- **WHEN** a change removes `if: steps.author.outputs.trusted == 'true'` from the step that enables auto-merge
- **THEN** the workflow policy fails

#### Scenario: Invalid trusted-author entry
- **WHEN** `.github/trusted-authors.json` contains `dependabot[bot]`, `*`, a duplicate login or a non-string value
- **THEN** the workflow policy fails
