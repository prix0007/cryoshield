# Spec Delta

## MODIFIED Requirements

### Requirement: Installable and reproducible distribution
Every published CryoShield release SHALL carry the recovery tool as downloadable files: a single-file executable for Linux (x86_64, arm64), macOS (arm64, x86_64) and Windows (x86_64) under fixed, version-free names, plus the Python wheel and source archive. Each file SHALL have a published SHA-256 (a `.sha256` file and a `SHA256SUMS` list) and a build-provenance attestation that ties it to this repository's workflow and the tagged commit. The tool's version SHALL equal the release tag the files are attached to (tag `vX.Y.Z`, version `X.Y.Z`); a release whose tool version differs SHALL get no files. The documentation SHALL NOT tell users to install from a package index the tool is not published on. Single-file executables SHALL be built from the hash-locked lockfile; two clean Linux builds of the same commit SHALL produce identical SHA-256 hashes.

#### Scenario: Stable download link
- **WHEN** a user opens `https://github.com/prix0007/cryoshield/releases/latest/download/cryoshield-recover-linux-x86_64`
- **THEN** they get the executable from the newest release, and its checksum file at the same path with `.sha256` appended

#### Scenario: Verify a download
- **WHEN** a user runs `shasum -a 256 -c <file>.sha256` or `gh attestation verify <file> --repo prix0007/cryoshield`
- **THEN** both succeed for a file downloaded from the release, and fail for a modified file

#### Scenario: uvx run
- **WHEN** a user with only uv installed runs `uvx --from "git+https://github.com/prix0007/cryoshield@<release-tag>#subdirectory=tools/recover" cryoshield-recover --version`
- **THEN** the tool runs and prints its version and the format versions it supports

#### Scenario: Install the wheel
- **WHEN** a user runs `pipx install` with the release's wheel URL
- **THEN** the tool installs and `cryoshield-recover --version` prints its version and the format versions it supports

#### Scenario: Version matches the release
- **WHEN** the owner publishes `v1.0.0` and `tools/recover` is version `1.0.0`
- **THEN** the files are attached and each program prints `cryoshield-recover 1.0.0`; with any other tool version, nothing is uploaded and the run names the files to bump

#### Scenario: Reproducible build
- **WHEN** CI builds the Linux single-file executable twice from the same commit in clean environments
- **THEN** both artifacts have the same SHA-256
