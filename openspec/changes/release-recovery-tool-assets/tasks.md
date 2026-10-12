# Tasks

> Owners: **[ci]** CI/release, **[rec]** recovery tool, **[sec]** security review, **[owner]** repository owner.
> **TDD:** each test first, then the code.

## 1. Plan

- [x] 1.1 [ci] Proposal, design, spec deltas (`vault-recovery`, `ci-pipeline`) and tasks. Verify: `openspec validate --all --strict`.

## 2. Asset preparation script [ci]

- [x] 2.1 Tests first (`.github/scripts/test/recover-release.test.mjs`): `prepare(dir)` accepts exactly the 5 binaries, one `cryoshield_recover-<v>-py3-none-any.whl` and the matching `cryoshield_recover-<v>.tar.gz`; refuses a missing, extra, empty, non-regular or mismatched-version file and any pre-existing `.sha256`/`SHA256SUMS`; writes `<file>.sha256` (`<hex>  <file>`) for each and a sorted `SHA256SUMS`; the hashes match the bytes; with `--tag`, the tool version must equal the tag (D8). Verify: they fail.
- [x] 2.2 `.github/scripts/recover-release.mjs` (`BINARIES`, `prepare`, CLI). Verify: 2.1 passes (9 tests).

## 3. Workflow policy [ci]

- [x] 3.1 Tests first (`test/workflow-policy.test.mjs`, on the real `recover-release.yml`): failures for another trigger or release type, dispatch inputs, a missing owner/event gate, a missing `needs.detect` or `github.event_name == 'release'` conjunct on publish, `always()`, a top-level `||`, a write scope outside `publish`, an extra or missing scope on `publish`, a non-allow-listed or unpinned action in `publish`, `github.token` in a build job, any secret, an environment, `--clobber` / `gh release edit|delete-asset` / `git push` in a run step, an un-pinned publish run step, build tooling in publish, a checkout persisting credentials; the profile is bound to the file name; the "write scopes" test lists exactly the deployments-check and recover-release publish scopes. Verify: they fail.
- [x] 3.2 `RELEASE_ASSETS` profile in `workflow-policy.mjs` (+ digests in `currentDigests`, pinned in `privileged-run-steps.json` after review). Verify: 3.1 passes; `npm test --prefix .github/scripts` 418/418.

## 4. Workflow and build [ci] [rec]

- [x] 4.1 `tools/recover/scripts/build-binary.sh`: PyInstaller in `venv/Scripts` and a `cygpath -m` work directory on Windows. Verify: native macOS arm64 build prints `cryoshield-recover 1.0.0 (vault format v1)`; `bash -n`.
- [x] 4.2 `.github/workflows/recover-release.yml` (detect → binaries matrix + python-dist → publish | dry-run), in its own commit (the owner pushes workflow files). Verify: `node .github/scripts/workflow-policy.mjs .github` OK; actionlint OK; zizmor 1.30.1 pedantic: no findings.
- [x] 4.3 Local dry run: `uv build`, the macOS binary staged under the five names, `recover-release.mjs --tag v1.0.0` → 7 assets, `shasum -a 256 -c SHA256SUMS` all OK; the wheel runs (`uvx --from <wheel>` → `1.0.0`); `pytest -m release --run-release` passes; the macOS binary's smoke (`--help` 0; dev-vault lookup with no key → exit 3, no file written). Found and fixed: `uv build` writes a `.gitignore` into its output directory (the workflow uploads only `*.whl` and `*.tar.gz`).
- [x] 4.4 Version = tag (D8): `tools/recover` 1.0.0 in `pyproject.toml`, `__init__.py`, `uv.lock`; `tests/test_release_version.py` keeps them equal. Verify: recovery suite green.
- [ ] 4.5 [owner] CI dry run on all platforms: `gh workflow run recover-release.yml --ref main` after the workflow commit is on `main`. Verify: every binary job, the wheel job and the dry-run job green; the `recover-release-dry-run` artifact holds 7 files, 7 `.sha256` files and `SHA256SUMS`. Linux arm64, macOS x86_64 and Windows have not been built yet; a platform that fails is fixed or dropped in a follow-up before `v1.0.0`.

## 5. Docs [rec]

- [x] 5.1 `tools/recover/README.md`: Install without PyPI (wheel URL and source at a tag), Download section with the fixed links, verify (checksum, attestation), unsigned-program notes for macOS and Windows; `tests/test_readme_download.py`. Verify: it passes.
- [x] 5.2 `docs/launch/mainnet-release-checklist.md` 3.2 (dry run) and 3.3 (check the release's files), 5.2 pointer, `v1.0.0` throughout (also `docs/deploy.md`); `launch-op-mainnet` task 7.4 and runbook step 5. Verify: `openspec validate --all --strict`.

## 6. Security review [sec]

- [x] 6.1 Review against design.md D1–D9 (owner gate, write scopes, token placement, no secrets, no release/tag mutation, hash integrity, injection, dry run uploads nothing, version check, honest docs). Record in design.md → Security review. Verify: no open CRITICAL or HIGH.

## 7. Release [owner]

- [ ] 7.1 Push the workflow commit (agents cannot push `.github/workflows/`).
- [ ] 7.2 Keep GitHub "immutable releases" off for this repository (design D6).
- [ ] 7.3 On `v1.0.0`: confirm the 7 files, their `.sha256` files, `SHA256SUMS` and attestations are on the release; run your platform's program against the vault (checklist 3.3).
