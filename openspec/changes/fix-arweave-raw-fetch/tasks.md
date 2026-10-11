# Tasks: fix-arweave-raw-fetch

## 1. Plan

- [x] 1.1 [rec] [fe] Proposal, design (live evidence), spec deltas (`vault-recovery`, `arweave-mirror-status`) and tasks. Verify: `openspec validate --all --strict`.

## 2. Recovery tool [rec]

- [x] 2.1 Tests first: `FakeArweave` answers `/<id>` with a 302 to another host and serves data on `/raw/<id>`; new `tests/test_arweave_raw.py` checks the fetch URL is `<gw>/raw/<id>`, a gateway that 302s even on `/raw/` is skipped (redirect refused, next gateway used), an unresolvable first gateway falls through to the second, and the defaults are `arweave.net` + `turbo-gateway.com` (no `ar-io.net`). Verify: they fail on the old code.
- [x] 2.2 `arweave.py` fetches `<gw>/raw/<id>`; `config.py` `ARWEAVE_GATEWAYS = ("https://arweave.net", "https://turbo-gateway.com")`. Verify: 2.1 and the full suite pass; ruff and mypy clean.
- [x] 2.3 Live opt-in test `tests/test_live_arweave.py` (`-m network --run-network`): every default gateway returns the dev vault's version-11 item `zIJNx…` (999 bytes, sha256 `68844c2d…`) through `Arweave.fetch`, and it decodes as a format-1 blob. Verify: passes live.

## 3. Web mirror [fe]

- [x] 3.1 Tests first (`test/mirror/mirror.test.ts`): `ensure()` reads `<host>/raw/<id>` with `redirect: 'error'`; a fake host that 302s `/<id>` and serves `/raw/<id>` gives `present` with no upload. The e2e `ArweaveStub` answers `/<id>` with a 302 to a sandbox host and serves `/raw/<id>`. Verify: unit tests fail on the old code.
- [x] 3.2 `src/mirror/mirror.ts` uses `/raw/` and `redirect: 'error'`. Verify: unit tests pass; e2e mirror specs (`10-flows`, `40-errors`) pass on desktop and mobile.

## 4. Docs and review [rec] [fe]

- [x] 4.1 Recovery docs and the mirror security-review note name `/raw/<id>`. Verify: no doc tells users to fetch `<gateway>/<id>` for data.
- [x] 4.2 Security review recorded in `design.md` (redirects, path, cap, authenticity, origins, privacy). Verify: no CRITICAL/HIGH/MEDIUM open.
