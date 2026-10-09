## 1. Split the E2E job

- [x] 1.1 `ci.yml`: a `web-e2e` matrix with `desktop` (chromium, analytics) and `mobile` (mobile, mobile-small) entries,
  `fail-fast: false`, passing the projects as `--project` flags
- [x] 1.2 `playwright.config.ts`: start the analytics preview server only when the `analytics` project is selected
- [x] 1.3 `e2e/README.md`: document running one shard locally
- [x] 1.4 Verify locally:
  - the `--project` filter selects the expected spec counts;
  - `actionlint` passes;
  - `openspec validate --all --strict` passes
- [ ] 1.5 Record both shard durations from the PR's CI run

## 2. Review

- [x] 2.1 Security review (design.md D4): CI scheduling only, with no new secrets, permissions or actions
