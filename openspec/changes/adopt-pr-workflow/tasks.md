# Tasks

## 1. Gate-script scaffold

- [x] 1.1 Create `.github/scripts/package.json` (private, MIT, `type: module`, `yaml` 2.9.1 exact, `test: node --test test/`) and a committed `package-lock.json`. Verify with `npm ci --ignore-scripts --prefix .github/scripts` and `scripts/check-licenses.sh`, which must stay green.

## 2. Ruleset as code

- [x] 2.1 Test first: `test/ruleset-normalize.test.mjs` covers the projection onto declared keys, rule order and the dropping of server-added defaults. Then implement `ruleset-normalize.mjs`. Verify with `npm test --prefix .github/scripts`.
- [x] 2.2 Write `.github/rulesets/main.json` (decision 1) and `repo-settings.json`. Verify that a test asserts the required properties: `ci-ok` with integration 15368 and strict mode, 0 approvals, thread resolution, squash only, linear history, `non_fast_forward`, `deletion`, and empty `bypass_actors`.
- [x] 2.3 Test first: `test/apply-sh.test.mjs` runs `apply.sh` against a stub `gh` and covers four cases:
  - the dry run makes no writes;
  - a missing ruleset is POSTed;
  - a different ruleset is PUT;
  - a matching ruleset makes no write call (idempotent).

  Then implement `.github/rulesets/apply.sh`, including the repo merge settings and the `no-spec` label. Verify with the tests and `shellcheck`.

## 3. PR hygiene

- [x] 3.1 Add `.github/pull_request_template.md` (OpenSpec change, tests run, security review link or N/A, screenshots, a `No-spec justification:` line) and `.github/CODEOWNERS` (`* @prix0007`). Verify that a test checks the template headings and the justification marker the gate parses.

## 4. PR gates (scripts, tests first)

- [x] 4.1 `pr-title.mjs` with tests. Positives include `feat(web): x`, `fix!: y` and `chore(deps): bump`. Negatives include `Update stuff`, `feat:no-space`, an unknown type and a title over 100 characters. Verify with `npm test`.
- [x] 4.2 `openspec-gate.mjs` with tests covering every scenario in `specs/contribution-workflow` (code without spec, with spec, archive, label plus justification, label without justification, docs-only), the Dependabot exemption and its negative (Dependabot touching a `.ts` file). Verify with `npm test`.
- [x] 4.3 `osv-gate.mjs` with tests, run against JSON fixtures. Each case has an expected result:
  - HIGH: fails;
  - CRITICAL: fails;
  - unscored: fails;
  - MEDIUM only: passes;
  - empty: passes;
  - scanner error exit: fails.

  It also lints the ignore file, rejecting a missing reason, a missing expiry or an expiry more than 90 days ahead. Verify with `npm test`.
- [x] 4.4 `.gitleaks.toml` (decision 7) and `.github/osv-scanner.toml` (decision 8, baseline triage A2). Verify locally:
  - gitleaks over the tree and the full history reports 0 findings;
  - a planted fake AWS key in a temporary commit is caught;
  - a planted hex key in another file is caught;
  - osv-gate passes with the ignore file and fails without it.

## 5. Workflow hardening

- [x] 5.1 `workflow-policy.mjs` with tests. Fixture workflows cover:
  - `pull_request_target`;
  - missing or broad top-level permissions;
  - a job without `permissions` or `timeout-minutes`;
  - a `secrets.` reference;
  - a `zizmor: ignore` comment;
  - a weakened `zizmor.yml`;
  - a clean pass.

  Verify with `npm test`, and the script passes on the real `.github/`.
- [x] 5.2 Edit `ci.yml`:
  - add the `pr-checks` job (title, OpenSpec gate, gitleaks, osv-scanner; pinned downloads with `sha256sum -c`; inputs via `env` only), add it to `ci-ok.needs`, and give it its own path-filter output so it always runs on PRs;
  - extend the `pull_request` types;
  - add the explicit `permissions` that jobs lack;
  - name every step;
  - in `workflow-lint`, add the policy script, the gate-script tests and zizmor `--persona=pedantic`.

  Verify with `actionlint`, zizmor in the pedantic persona (0 findings) and `workflow-policy.mjs` all green locally.
- [x] 5.3 Extend `.github/dependabot.yml` (decision 10). Verify that actionlint and zizmor parse it and that it lists the npm (×3), uv, docker and github-actions ecosystems.

## 6. Documentation

- [x] 6.1 Add a README "Contributing / PR workflow" section covering branch prefixes, OpenSpec-first plus `no-spec`, Conventional titles, squash merges, the PR gates, and how to apply the ruleset. Replace the old manual branch-protection note. Verify that the section exists and that its commands match `apply.sh --help`.

## 7. Integration

- [x] 7.1 Run the full local suite:
  - `npm test --prefix .github/scripts`;
  - actionlint;
  - `zizmor --persona=pedantic`;
  - `workflow-policy.mjs`;
  - gitleaks over the tree and history;
  - the osv-scanner gate;
  - `openspec validate --all --strict`;
  - `scripts/check-licenses.sh`.

  Verify that all are green and that the findings are triaged in the report.

## 8. Security review

- [x] 8.1 The security reviewer reviews the change, covering:
  - PR trigger safety and fork behaviour;
  - permissions;
  - injection via title, body or labels;
  - pinning and checksums of the downloaded scanners;
  - allowlist and ignore-file narrowness;
  - gate bypasses (label, Dependabot exemption, self-modifying PR);
  - ruleset bypass and status spoofing.

  Verify by recording an APPROVE, or the findings plus fixes, in design.md.
