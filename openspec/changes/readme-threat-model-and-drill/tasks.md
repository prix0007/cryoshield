# Tasks

## 1. README (tests first)

- [x] 1.1 `tools/recover/tests/test_root_readme.py`: every `cryoshield-recover` command in the root README parses with
  the real parser; the dependency section names python-fido2, `hmac-secret`, `DEFAULT_RP_ID`, `--rp-id` and says the
  tool never contacts the site; the sponsorship caveat names Pimlico, quotes "Saving is paused" and says writes stop;
  the drill says "ten minutes", blocks `cryoshield.app` in the hosts file before `show`, covers `--testnet`,
  `--save-blob` and `--offline`, and tells readers to use a test vault; the status line no longer says testnet-only.
  Fails on the current README.
- [x] 1.2 Status line and intro bullet: OP Mainnet live since `v1.0.0` (2026-10-12), testnet preview host, audit
  pointer (D5).
- [x] 1.3 "Recovery drill" section (D3).
- [x] 1.4 "What CryoShield depends on" section: RP ID binding and python-fido2, the phishing residual, gas sponsorship,
  the dependency table (D2).
- [x] 1.5 "If you need your vault" links the drill.

## 2. Pointers

- [x] 2.1 `docs/launch/mainnet-release-checklist.md` 8.4 names the README drill as the monthly recovery check.
- [x] 2.2 `tools/recover/README.md` "Use" links the drill.

## 3. Verification

- [x] 3.1 `uv run --frozen pytest tests/test_root_readme.py tests/test_readme.py` passes; `uv run ruff check src tests`
  and `uv run mypy` clean; `openspec validate --all --strict` passes.

  2026-10-16: the new test failed 5 of 6 on the old README, then the whole recovery suite passed (962 tests, 7 opt-in
  skips); ruff and mypy clean; 48 OpenSpec items valid.
- [x] 3.2 Reply on #107 (marked `<!-- claude-pr-flow -->`): the library is python-fido2, with the PR link.
  Posted 2026-10-16 (issuecomment-6209021770), pointing at PR #109.

## 4. Review

- [x] 4.1 Security review recorded in `design.md` (claims and sources, social-engineering surface, drift).

## 5. ECC review follow-ups (review of #109)

- [x] 5.1 RP ID precedence worded as the code does it (finding 1); test asserts "tries the configured RP ID first".
- [x] 5.2 `--testnet` line scoped to pre-launch vaults; development-site vaults get `--rp-id` (finding 2); step 6
  keeps the step-3 flags (finding 3).
- [x] 5.3 Exact `paused` and `pausedCreate` strings, read from `strings.ts` by the test (finding 4).
- [x] 5.4 `gh attestation verify` in step 1, with what the checksum does not prove (finding 5).
- [x] 5.5 Test hardening: no `try`, temporary cwd, config assertions, placeholder guard, `--testnet` assert, UTF-8
  (findings 6–9); anchored status-line match for the CodeQL alert.
- [x] 5.6 Optional suggestions: `::1` hosts line, PIN-lock warning without a count, "stop using `cryoshield.app`".
