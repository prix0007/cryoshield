# Design: recovery tool release assets

## Context

- Releases are published only by the repository owner (`gh release create vX.Y.Z --target main --generate-notes`).
  The `release-tags` ruleset lets only admins create tags; `deploy.yml` deploys production on `release: published`.
- `tools/recover/scripts/build-binary.sh` already builds a single-file PyInstaller executable from `uv.lock`, pinned
  Python, pinned PyInstaller and `SOURCE_DATE_EPOCH`; `--docker` builds Linux bit-for-bit reproducibly in a
  digest-pinned image. Nothing ran it on release.
- `.github/scripts/workflow-policy.mjs` makes every non-privileged job read-only; the only write scope outside the
  privileged workflows is `deployments-check.yml`'s `issues: write`. Uploading needs `contents: write`, so this
  change needs a reviewed policy profile.
- Reference (founder's request): `prix0007/rhizomon` `release.yml` builds per-target archives with version-free names,
  a `.sha256` per file and `SHA256SUMS`, so its site links `releases/latest/download/<asset>`.

## Decisions

### D1. A separate workflow on the same release event, uploading only

`recover-release.yml` runs on `release: published` (types exactly `[published]`) and on an input-less
`workflow_dispatch` for the owner's dry run on `main` (D9); no other trigger. The release itself stays the owner's
action; the workflow only runs `gh release upload` against the release named by the run's own tag, and only for the
release event. Not folded into `deploy.yml`, so:
- a failed tool build can never block or roll back the production deploy, and vice versa;
- the Fly token's workflow keeps no write scope (its policy profile forbids one).

Gate: the first job runs only when `github.triggering_actor == github.repository_owner` and either the event is the
release at a `refs/tags/v*` ref or the event is the dispatch at `refs/heads/main`. For a release, `release-ref.sh`
(the same script as `deploy.yml`'s `detect`) checks the tag format, that it points at `github.sha`, and that the
commit is reachable from `main`. The publish job re-checks the tag (still the built commit) right before uploading.

Never replaces: `gh release upload` without `--clobber` fails on an existing name. A partial upload (for example a
network error after three files) therefore needs the owner to delete the uploaded files in the release page, then
"Re-run failed jobs". Accepted: replacing assets silently is the riskier failure.

### D2. Assets and names

| File | Built on | Notes |
|---|---|---|
| `cryoshield-recover-linux-x86_64` | `ubuntu-24.04`, `build-binary.sh --docker` | reproducible |
| `cryoshield-recover-linux-arm64` | `ubuntu-24.04-arm`, `--docker` (multi-arch image digest) | reproducible |
| `cryoshield-recover-macos-arm64` | `macos-15` | best effort |
| `cryoshield-recover-macos-x86_64` | `macos-15-intel` (`macos-13` is retired; PyInstaller cannot cross-compile) | best effort |
| `cryoshield-recover-windows-x86_64.exe` | `windows-2025` | best effort |
| `cryoshield_recover-<v>-py3-none-any.whl`, `cryoshield_recover-<v>.tar.gz` | `ubuntu-24.04`, `uv build` | standard names |
| `<file>.sha256` for each of the 7 files, `SHA256SUMS` | publish job | from the uploaded bytes |

Binaries carry no version, so `https://github.com/prix0007/cryoshield/releases/latest/download/<file>` always
points at the newest release (rhizomon's scheme). The wheel and sdist keep their standard names: pip and pipx
reject a wheel whose file name is not `name-version-tags.whl`, and a renamed copy would be a second, confusing file.
The README links the release page for them.

The tool's version equals the release tag it is attached to (D8).

`releases/latest` is the newest published, non-prerelease release. If that release's asset workflow failed, the
"latest" links 404 until the owner re-runs it; the checklist checks the downloads right after publishing.

### D3. Integrity

- The publish job computes every checksum itself from the downloaded bytes (it trusts no hash file from a build job),
  checks the exact file set (no missing, extra, empty or oddly named file), writes `<file>.sha256`
  (`<hex>  <file>`, `shasum -a 256 -c` format) and `SHA256SUMS` (sorted).
- `actions/attest-build-provenance` signs SLSA build provenance for the 7 files through GitHub's Sigstore instance.
  `gh attestation verify <file> --repo prix0007/cryoshield` proves the file came from this repository's workflow at
  the tagged commit. It does not prove the code is safe, and the README says so.
- Reproducible rebuild remains Linux only (`build-binary.sh --docker --check`).
- Release guard: `pytest -m release --run-release` must pass (the default network has registries) before anything
  is built.
- Build backend: `uv build` installs `hatchling==1.32.4` (pinned) in an isolated environment; hatchling's own
  dependencies are resolved at build time, not hash-locked. Accepted LOW (pure-Python packaging code on a read-only
  job; the wheel's contents are the repository's own source).

### D4. Least privilege, enforced by the workflow policy

`RELEASE_ASSETS` profile in `workflow-policy.mjs`, for `recover-release.yml` only:
- triggers only `release` with `types: [published]` and an input-less `workflow_dispatch`;
- jobs without `needs`: the owner conjunct and the parenthesised "release at v* or dispatch at main" conjunct; jobs
  with `needs`: `needs.detect.outputs.deploy == 'true'` as a top-level conjunct, no top-level `||`, no
  `always()/failure()/cancelled()`; `publish` also `github.event_name == 'release'`;
- every job except `publish` holds exactly `contents: read`; `publish` holds exactly `contents: write`,
  `id-token: write`, `attestations: write`;
- `publish` may use only `actions/checkout`, `actions/download-artifact` and `actions/attest-build-provenance`, all
  SHA-pinned; its run steps are digest-pinned in `privileged-run-steps.json`; it may not run build tooling;
- `github.token` only in `detect` and `publish` (never in a job that runs PyInstaller or dependency code);
- no secrets context, no `secrets: inherit`, no environment, every checkout `persist-credentials: false`;
- no run step may contain `--clobber`, `gh release create|edit|delete|delete-asset`, `git tag` or `git push`.

The "only write scope" test now lists exactly two: `deployments-check.yml:report-failure:issues` and the three
`recover-release.yml:publish` scopes.

### D5. Unsigned binaries (founder decision, not done here)

The macOS and Windows binaries are not code-signed or notarized; that needs a paid Apple Developer account and a
Windows code-signing certificate. macOS refuses a quarantined unsigned file opened from Finder, and Windows SmartScreen
warns. The README says this plainly and gives the honest path: verify the checksum first, then `curl` (no quarantine
flag) or `xattr -d com.apple.quarantine` on macOS, "More info → Run anyway" on Windows. Signing can be added later
without changing file names.

### D6. GitHub "immutable releases" must stay off

With immutable releases enabled, assets cannot be added once a release is published, so every upload would fail.
The repository does not enable it today. Recorded in the checklist; switching to it would need a draft-release flow
(the owner creates a draft, the workflow uploads, the owner publishes), which is a separate change.

### D7. Hardware coverage

CI runs `--version` on every binary it builds (in `build-binary.sh`). It cannot press a security key. Before launch the
founder runs at least the binary for their own platform against the dev vault (checklist 3.2); the other platforms'
binaries are untested with a real key until a user or a later test runs them. The README's Windows note (normal users
go through `webauthn.dll`) applies to the frozen binary, which bundles the same `fido2` code.

### D8. The tool's version is the release tag (founder, 2026-10-12)

The first production release is `v1.0.0`. Files attached to it that print `cryoshield-recover 0.1.0` would make users
doubt they have the right download, so:
- this change bumps `tools/recover` to `1.0.0` (`pyproject.toml`, `__init__.__version__`, `uv.lock`); a test keeps
  the three equal and plain semver;
- on a release, the publish job refuses to upload when the wheel's version is not the tag without its `v`
  (`recover-release.mjs --tag`), naming the three files to bump.

Cost, accepted: every later release (`v1.0.1`, …) needs the tool's version bumped first, even when only the web app
changed. The checklist says so. The bump points are `pyproject.toml`, `__init__.__version__`, the `cryoshield-recover`
entry in `uv.lock`, and the README's pinned install lines (pipx wheel URL, `uvx … @vX.Y.Z`, the "files on release"
sentence); `tests/test_release_version.py` fails when any of them disagree, so a forgotten one cannot reach a tag
(2026-10-19, after `v1.0.1` and `v1.0.2` shipped with no assets). If it is forgotten, `deploy.yml` still deploys the site and only the asset upload
fails; bump, then publish a new patch release (the old release keeps no assets, and `releases/latest` moves on).
Rejected: an independent tool version (confusing on a `v1.0.0` download page); deriving the version from the tag at
build time (the source at the tag would then disagree with the files built from it).

### D9. Owner dry run before release day (founder, 2026-10-12)

The first real release must not be the first time the workflow runs. `workflow_dispatch` on `main` (owner only, no
inputs) runs the same `detect` (as a dry run: the commit is main's HEAD, the tag `dry-run`), the same five binary jobs
and the wheel job, then a `dry-run` job (exactly `contents: read`, no token) that checks the file set and writes the
checksums with the same script, without the tag check, and keeps everything as one workflow artifact
(`recover-release-dry-run`, 7 days). It never uploads to a release and makes no attestation; `publish` runs only for
the release event (a policy-checked conjunct).

Every binary job smoke-tests its file: `--version`, `--help`, and a real lookup of the founder's dev vault on OP
Sepolia with no key attached, which must end with exit code 3 ("No security key found") and write no file. That proves
the frozen program starts, reaches the network, and loads the FIDO2/HID stack on each platform. A network outage turns
it into exit 6 and fails the job: re-run.

`fail-fast: false`, so a dry run reports every platform. A release still needs all five (the publish job checks the
set); a platform that cannot be made reliable is dropped in a follow-up change, not silently skipped.

## Risks

| Risk | Mitigation |
|---|---|
| A compromised build dependency poisons a binary | `uv.lock` hashes; pinned PyInstaller, Python, image digest; Linux reproducible; provenance shows what built it. Residual: macOS/Windows not reproducible (LOW). |
| Someone other than the owner triggers an upload | owner + v* tag + on-main gate in the first job; tags are admin-only; no dispatch trigger. |
| Assets replaced after users verified them | no `--clobber`; policy forbids it and any release edit/delete. |
| Upload fails, "latest" links 404 | checklist step checks downloads after publishing; owner re-runs. |
| Write token reaches third-party build code | build jobs are `contents: read` with no token reference; publish runs no build tooling. |

## Security review

Reviewer: agent (security-review task 6.1), 2026-10-12, after implementation. Scope: `recover-release.yml`,
`recover-release.mjs`, the `RELEASE_ASSETS` policy profile and its pinned digests, the `build-binary.sh` change, the
version bump, README and checklist instructions.

| Check | Result |
|---|---|
| Trigger reachable only by the owner on a v* tag on main | PASS: release:published only; first-job conjuncts enforced by policy; `release-ref.sh` on main reachability; ruleset admin-only tags. |
| Write scopes confined | PASS: only `publish` holds write scopes; policy test fails on any other write. |
| No secrets | PASS: no secrets context anywhere (policy-enforced). |
| Token never in build jobs | PASS: policy forbids `github.token` outside `detect`/`publish`; checkout credentials not persisted. |
| No release/tag mutation, no asset replacement | PASS: run-step pattern ban plus digest pinning of every publish step. |
| Integrity of uploaded bytes | PASS: hashes computed from the uploaded bytes; exact file set checked; provenance signed per file. |
| Script injection | PASS: all `${{ }}` values pass through `env:`; `release-ref.sh` validates the tag format; asset names are fixed in the script. |
| Honest docs | PASS: no signing or audit claims; attestation described as provenance, not safety. |
| Dry run cannot publish (D9) | PASS: `publish` requires `github.event_name == 'release'` (policy-checked); the dry-run job holds exactly `contents: read` and no token; the dispatch is owner-only, on `main`, input-less. |
| Version check (D8) | PASS: `--tag` validated against a strict `vX.Y.Z` pattern before use; mismatch refuses the upload. |
| Exact file set | PASS: a stray `.gitignore` from `uv build` was refused in the local dry run; the workflow now uploads only `*.whl`/`*.tar.gz` from that job. |

Accepted LOW: hatchling's transitive build deps not hash-locked (D3); macOS/Windows builds not reproducible; binaries
unsigned (D5, founder decision); partial-upload recovery is manual (D1); a forgotten version bump leaves a release
without files (D8); a network outage fails the smoke test (re-run, D9). Linux arm64, macOS x86_64 and Windows builds are
first exercised by the owner's dry run (task 4.5). No CRITICAL, HIGH or MEDIUM open.
