# Tasks

## 1. Ruleset
- [x] 1.1 Update `ruleset-files.test.mjs` to expect `strict_required_status_checks_policy: false`. Verify: the test fails against the current file.
- [x] 1.2 Set `strict_required_status_checks_policy` to `false` in `.github/rulesets/main.json`. Verify: the test passes and `apply.sh --with-ecc-review` shows only that diff.

## 2. Docs
- [x] 2.1 Update CLAUDE.md "Change flow" step 8 and the merge note, plus the README PR-workflow section. Verify: no doc still claims branches must be up to date.

## 3. Rollout
- [ ] 3.1 After merge, run `.github/rulesets/apply.sh --with-ecc-review --apply`. Verify: the live ruleset is in sync and strict is off.
