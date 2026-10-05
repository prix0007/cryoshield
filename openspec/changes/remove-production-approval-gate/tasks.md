## 1. Configuration

- [x] 1.1 Set `required_reviewers` to `[]` for `production` in `.github/rulesets/environments.json`
- [ ] 1.2 After merge, the owner runs `.github/rulesets/apply.sh --with-ecc-review --environments --apply` (dry run first) and confirms `production` has no `required_reviewers` rule

## 2. Docs

- [x] 2.1 Update `CLAUDE.md` step 9, `README.md`, `docs/deploy.md`, `docs/agent-account.md`
- [x] 2.2 Mark CI-C1 in `docs/reviews/security-audit-2026-10.md` as an accepted risk, to be re-gated before mainnet

## 3. Verify

- [x] 3.1 `openspec validate remove-production-approval-gate --strict`
- [x] 3.2 `.github/scripts/test` suites pass
- [ ] 3.3 The next merge to `main` deploys with no pending approval (`curl -s https://cryoshield.app/release.json` names it)
