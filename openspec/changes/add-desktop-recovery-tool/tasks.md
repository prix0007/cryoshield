# Tasks

Every task is TDD: write the named failing test first, then implement until it passes. The test command is `uv run pytest` from `tools/recover/`. Hardware tests (`-m hardware`) are opt-in.

## 1. Scaffold

- [x] 1.1 Create `tools/recover/` with a `pyproject.toml` (hatchling, `requires-python >=3.10`, runtime dependencies `fido2>=2.0,<3` and `cryptography`, optional extra `nfc = ["pyscard"]`, dev dependencies `pytest`, `hypothesis`, `ruff`, `mypy`), the `src/cryoshield_recover/` package, and the `cryoshield-recover` script entry. Verify that `uv sync` produces a hash-locked `uv.lock` and that a smoke test `test_version.py` (red first) passes with `uv run cryoshield-recover --version` printing the version and "format v1".
- [x] 1.2 Add `tests/conftest.py` with markers `hardware` and `network`, both skipped by default. Verify that `uv run pytest` reports them as skipped and `uv run pytest -m hardware` selects them.

## 2. Test-vector harness (blocked until crypto marks v1.json stable)

- [x] 2.1 Write `tests/test_vectors_pin.py`: it loads `../../packages/vault-crypto/test-vectors/v1.json` and asserts its SHA-256 equals the pinned constant. Verify the test fails when the file is missing or altered (not skipped).
- [x] 2.2 Write a parametrized vector runner, `tests/test_vectors.py`, covering every positive and negative case: locator, wrap key, CTAP salt, decode, decrypt, mode 0x02, candidate lists, and error classes. Verify it is fully red before any implementation. Report any vector the spec doesn't explain to the crypto engineer, and never edit the vectors.

## 3. Derivations (pure)

- [x] 3.1 Write tests for `ctap_salt()`, then implement it as SHA-256("WebAuthn PRF" || 0x00 || SHA-256("cryoshield/v1/locator-salt")). Verify the CTAP-salt vector and a test asserting it equals python-fido2's internal PRF salt mapping for the same input.
- [x] 3.2 Write tests for `derive_locator(prf)` and `derive_wrap_key(prf, wrap_salt)`, then implement them with `cryptography` HKDF-SHA256 (empty salt / wrap salt; infos `cryoshield/v1/locator` and `cryoshield/v1/wrap`). Verify the locator and wrap-key vectors pass.

## 4. Format decoding (pure)

- [x] 4.1 Write decoder tests from the vectors (valid blobs; wrong magic; unknown version, suite, or mode; truncated blob; over 1024 bytes; out-of-range lengths), then implement the bounds-checked `decode_blob` returning a frozen dataclass. Verify the decoder vectors and the negative cases raise typed errors.
- [x] 4.2 Add a hypothesis property test: random bytes up to 2048 never raise anything but `FormatError`, and mutating any byte of a valid blob never crashes. Verify 10k examples pass.

## 5. Decryption and selection (pure)

- [x] 5.1 Write tests, then implement entry unwrap (AES-256-GCM, AAD = fixed header || credId) and payload decrypt (AAD = all bytes before the payload nonce, then strip the 2-byte length prefix and padding). Verify the mode 0x01 vectors, the header-tamper and wrapped-key-tamper vectors, and the wrong-key vector ("no matching key").
- [x] 5.2 Write tests, then implement `shamir.combine(shares)` over GF(2^8) per the spec's share encoding, plus the mode 0x02 open path that collects M shares. Verify the 2-of-3 vectors, a property test that every 2-subset reconstructs, and that 1 share yields "insufficient shares".
- [x] 5.3 Write tests, then implement `select(candidates, prf_outputs)` with source-ranking rules (on-chain current > verified-latest Arweave > unverified Arweave), counting ignored candidates. Verify the squatted-locator and no-candidate vectors and a ranking test where two sources both authenticate.
- [x] 5.4 Write a zeroization test: after success and after a forced failure, the caller-supplied PRF `bytearray`s and the derived-key buffers read as all zeros. Implement `try/finally` wiping across derive, decrypt, and select. Verify the test, plus a test that fails on any `logging` call whose arguments include `bytes`/`bytearray` from those modules.

## 6. Keccak and ABI (pure)

- [x] 6.1 Write tests with published Keccak-256 vectors (empty input, "abc", a 200-byte input), then implement `keccak.py`. Verify the vectors and that the `resolveLocator(bytes32)` and `getVault(bytes32)` selectors and event topics match the ABI JSON exported by `contracts/` (read-only).
- [x] 6.2 Write tests, then implement the minimal ABI codec: encode `bytes32` args; decode `bytes32[]` and `(address, bytes, uint32)`. Verify decoding against `cast abi-encode` fixtures, plus a hypothesis test showing malformed or oversized inputs (bad offsets, blob over 1024 bytes, list over 16 entries) raise `AbiError` only.

## 7. Network clients (local fake servers)

- [x] 7.1 Write tests against an in-process `FakeRpc` HTTP server, then implement `rpc.py` (urllib JSON-RPC, 10 s timeout, 64 KB response cap, no redirects to non-HTTPS). Verify timeout, oversize, malformed-JSON, and JSON-RPC-error cases all map to `RpcError`.
- [x] 7.2 Write tests, then implement `chain.py`: an `eth_chainId` check, parallel `resolveLocator` across RPCs with union and dedupe, `getVault` per distinct vaultId, and paged `eth_getLogs` for event hashes by indexed vaultId. Verify the wrong-chain RPC is ignored, the withholding-RPC scenario still finds the vault, a malicious-ABI RPC is discarded, and log-range errors give "unverifiable".
- [x] 7.3 Write tests against `FakeArweave` (GraphQL plus data), then implement `arweave.py` with the D5 tag query, a `data.size` pre-check, and a hard 1024-byte read cap. Verify that tagged blobs are returned, that over-1024-byte transactions are skipped without full download, and that the keccak comparison classifies results as verified/current, outdated, or unverifiable.
- [x] 7.4 Write a traffic-capture test: run a full recovery with fakes and assert captured requests contain only the allowed methods and none of the PRF, key, or plaintext bytes. Verify it passes.

## 8. Authenticator

- [x] 8.1 Define the `PrfSource` protocol as one ceremony, `get(rp_id, allow) -> list[Assertion(cred_id, prf)]`, where an empty `allow` means discoverable credentials. Add `FakePrfSource` from the vectors. Verify the orchestrator tests in 9.x can use it.
- [x] 8.2 Write tests with a mocked `Fido2Client`, then implement `Fido2PrfSource`:
  - USB HID enumeration (and `CtapPcscDevice` when the `nfc` extra is installed), and `WindowsClient` on Windows;
  - `HmacSecretExtension` with a `prf.eval.first` input (the `prf` path only; raw hmac-secret is not needed);
  - `user_verification="required"`;
  - an empty allow list for discovery, iterating `AssertionSelection` responses;
  - a PIN via `getpass` with retries shown;
  - a clear error if `hmac-secret` is not in `get_info().extensions`.

  - rejection of any assertion whose authenticator data lacks the UV flag (`USER_NOT_VERIFIED`, vault-format-v1 §3.1).

  Verify the tests for: several responses, one ceremony; no credentials; wrong PIN retry; PIN blocked; unsupported key; missing UV flag.
- [ ] 8.3 Hardware test (`-m hardware`): on a YubiKey 5 (firmware ≥ 5.2) with a credential made by the web app (or a vector-equivalent fixture created with python-fido2 using UV required), assert the tool's PRF output gives the same locator as the browser. Verify the test passes and record the result (key model and firmware) in `tools/recover/docs/manual-yubikey-test.md`.

## 9. Orchestration and CLI

- [x] 9.1 Write tests, then implement `config.py` with defaults (RP ID, chain 42161, registry address and deployment block, at least 3 RPCs, 2 Arweave endpoints, a `--testnet` preset) and the flags `--rpc`, `--registry`, `--rp-id`, `--chain-id`, `--arweave`, `--vault-id`, `--credential-id`, `--blob-file`, `--offline`, `--output`, `--save-blob`, and `--verbose` (no `--uv` flag: UV is now mandatory in the vault-format spec, so a no-UV diagnostic mode would only produce outputs that can never open a vault). Verify the override tests and a release test that fails while the registry address is a placeholder (marked `release`).
- [x] 9.2 Write orchestrator tests with fakes for each flow: keyless discovery to chain; chain down to Arweave; `--vault-id` to allow list; `--credential-id`; `--blob-file --offline` (asserting zero network calls); blob RP ID differing from config; and mode 0x02 sequential taps, including the same key tapped twice. Implement `recover.py`. Verify all flows pass.
- [x] 9.3 Write UX tests (captured stdio, pseudo-TTY), then implement `ui.py`. Cover: endpoints listed before contact; typed `show` confirmation; decline leading to no plaintext and exit 0; non-TTY without `--output` refusing; `--output` creating a 0600 file with `O_EXCL` and never overwriting; UTF-8 versus hex display; documented exit codes for each failure; Linux udev hint when no device is found. Verify all pass.
- [x] 9.4 Write a `--verbose` log-scrubbing test (full recovery with fakes, assert no secret bytes or PIN in the logs), plus a crash-path test (an exception injected after PRF yields zeroized buffers and a secret-free message). Implement core-dump disabling on POSIX. Verify the tests pass.

## 10. Distribution and docs

- [x] 10.1 Write `tools/recover/README.md` covering install (`pipx`, `uvx`, the git URL), usage for each flow, exit codes, Linux udev rules, the NFC extra, Windows notes, privacy notes (RPCs see the locator; `HTTPS_PROXY`), verifying checksums, and a "reimplementing" pointer to the spec and vectors. Verify that a test runs every documented command example's `--help` and `--version` forms successfully.
- [x] 10.2 Add the PyInstaller build in `scripts/build-binary.sh` (flags in the script, entry `scripts/entry.py`):
  - pinned Python and PyInstaller;
  - `uv sync --frozen`;
  - `SOURCE_DATE_EPOCH` set and `PYTHONHASHSEED=0`;
  - a pinned container image on Linux.

  Verify that `scripts/build-binary.sh --docker --check` gives two identical Linux builds, that a fresh container reproduces the same hash, and that the binary runs `--version` and reaches device enumeration offline. (The CI job that runs this is part of 10.3.)
- [ ] 10.3 Add a CI workflow (`.github/workflows/`, outside `tools/recover`, so it needs the overwatcher) for pytest on Linux, macOS, and Windows with Python 3.10–3.13, plus `ruff`, `mypy --strict` on `src/`, and the `build-binary.sh --docker --check` reproducibility job (x86_64 via `--platform linux/amd64`). Verify the workflow passes on all matrix cells (hardware and network tests skipped).

## 11. Integration

- [x] 11.0 Software CTAP2 authenticator (`tests/support/soft_ctap.py`: PIN protocol 1 + hmac-secret) under the real python-fido2 client, returning the vector PRF output only for the exact `ctapSalt`. Verify `tests/test_soft_ctap.py`: the salt sent equals `ctapSalt`; several discoverable credentials in one ceremony; allow-list selection; wrong and blocked PIN; missing UV flag rejected.
- [x] 11.3 Local-chain end-to-end with anvil: deploy the real `VaultRegistry` from `contracts/`, store the any-of-2 vector vault behind a squatter's junk entry, then recover through the real CLI via `eth_call` (keyless, and `--vault-id` after an `updateVault`), using the software CTAP device. Verify `tests/test_anvil_e2e.py` passes, including the unenrolled-key and wrong-chain-ID cases.
- [ ] 11.1 Run an end-to-end recovery on Arbitrum Sepolia (`-m hardware -m network`): create a vault with the web app (or a vector-equivalent script) on Sepolia with 2 YubiKeys, block every CryoShield domain in `/etc/hosts`, and recover it with each key via `--testnet` (discoverable flow), and via `--vault-id`. Verify that both keys decrypt and record the run in `tools/recover/docs/manual-yubikey-test.md`.
- [ ] 11.2 Run an Arweave-only recovery: use the same vault with every RPC overridden to an unreachable host, and the blob mirrored on Arweave with the D5 tags. Verify the tool recovers from Arweave and warns "freshness unverifiable". If the durability layer isn't ready, use a manually uploaded test transaction.

## 12. Security review fixes (round 1: CHANGES REQUESTED)

Each fix has a regression test, written first, in `tests/test_review_fixes.py`.

- [x] 12.1 HIGH: contain hostile JSON. `net.loads_untrusted` maps ValueError, RecursionError, OverflowError and non-finite numbers to `NetError`. `arweave._as_int` accepts only sane integers, a malformed node is skipped, duplicate tx ids keep the smallest size claim, and per-source failures are contained in `Registry._map` and `Arweave._query`. Verify the `[`×60000, NaN, Infinity, 1e999, huge-int, and bad-UTF-8 RPC and GraphQL cases, plus full recovery continuing past a hostile source.
- [x] 12.2 HIGH: no silent rollback. When RPCs return different blobs for a vault ID, `Registry._reconcile` compares each with the latest agreed event hash, demotes the non-matching ones, and warns visibly. Ranking prefers the higher version within a freshness class. Verify the lying-state and lagging-node tests and the ranking test.
- [x] 12.3 MEDIUM: make remote text inert. `text.sanitize` strips C0/C1 controls, DEL and format characters; it is applied in `Console.info`/`warn` and to RPC error messages. Verify the sanitize unit test and an end-to-end CLI test with OSC/CSI sequences in an RPC error.
- [x] 12.4 MEDIUM: choose RP IDs safely. `Recovery._rp_id_order` tries the configured RP ID, then chain, file and Arweave, capped at 3 and announced. Verify the attacker-tagged Arweave copy, chain-first, and next-RP-ID-on-no-credential tests.
- [x] 12.5 LOW: event history counts only when at least 2 RPCs (or the only one configured) return identical histories; otherwise it is unverifiable, and unmatched is reported only on an agreed empty history. Verify the agreement and unmatched tests.
- [x] 12.6 LOW: supply chain.
  - hatchling pinned (`==1.32.4`);
  - the Docker base image pinned by digest;
  - `uv` installed with `--require-hashes`;
  - `binutils` pinned to `2.40-2`;
  - NFC dropped from the binary (`--exclude-module fido2.pcsc`; documented as USB-only);
  - README states that pipx/uvx do not use `uv.lock`.

  Verify that `scripts/build-binary.sh --docker --check` is still reproducible.
- [x] 12.7 LOW: whole-request deadline (2× timeout) on top of per-read timeouts, using a `read1` loop. Verify the trickling-server test.
- [x] 12.8 LOW: README "Memory-wiping limits" section covering the PIN string, library `bytes` copies, display copies, Shamir share slices, and swap/hibernation. Verify by review.

## 13. Adopt bind-vault-id-to-ciphertext

- [x] 13.1 Re-pin the regenerated v1.json, and pass the vaultId through `wrap_aad`/`payload_aad`, `open_vault`, `open_decoded`, `matching_entries`, and `select_vault((vaultId, blob)…)`, with `validate_vault_id` giving `INVALID_ARGUMENT` for one that is not 32 bytes or is all zero. The test-only writer follows §4.1, §6.6 and §6.7 (validation order; the new payload nonce must differ). Verify all vectors pass, including the wrong-vaultId open, add-key and update cases (both modes), invalid vaultIds, and the clone select cases.
- [x] 13.2 Recovery opens every candidate under its source's vaultId: the registry key, the exact Arweave tag, or `--vault-id` for files. It ignores untagged copies and deduplicates by (vaultId, blob). `--blob-file` requires `--vault-id`, and a zero `--vault-id` is rejected. Verify `tests/test_vault_id_binding.py`: clone listed first, clone only, `--vault-id` pointing at a clone, Arweave clone tag, tag-selected Arweave copy, and file with missing, correct or wrong vaultId.
- [x] 13.3 Update the README ("Why the vault ID matters", offline example), the spec, and the design. Verify that `openspec validate --strict` and the README command test pass.

## 14. Security review

- [x] 14.1 Security review: run the `ecc:security-reviewer` agent (and `ecc:python-reviewer`) over `tools/recover/`, with a checklist covering:
  - the CTAP salt and UV handling;
  - the RP ID override;
  - RPC, GraphQL, and gateway input handling (size caps, ABI bounds, redirects, TLS verification left on);
  - candidate selection and rollback warnings;
  - zeroization, logging, and core dumps;
  - the plaintext display and output-file permissions;
  - dependency pinning and hashes in `uv.lock`;
  - reproducible-build integrity;
  - absence of any CryoShield-hosted endpoint.

  Verify that every CRITICAL/HIGH finding is resolved with a regression test, and record the review in `docs/reviews/recovery-tool-v1.md`.

## 15. Review round 2 close-out (APPROVED; LOWs and quality)

- [x] 15.1 L1: when the selected copy is not chain-verified and a different blob for the same vaultId also decrypts, show a visible "older copy may be shown" warning. Verify `test_two_different_decrypting_copies_without_chain_warn` and the no-warning case.
- [x] 15.2 L2: history agreement needs `min(2, configured RPCs)`, so 1 answer out of 3 is unverifiable. Verify `test_history_agreement_counts_configured_rpcs`.
- [x] 15.3 L3: collapse `\n`, `\r` and `\t` in remote error text. Verify `test_remote_error_text_has_no_line_breaks`.
- [x] 15.4 Quality fixes:
  - decode and open in separate `try` blocks in `_select`;
  - typed `_report` and an `_emit` helper;
  - explicit factory keyword arguments;
  - typed `ArweaveTx` callables;
  - `secure.wipe` in `authenticator`;
  - a debug log when core dumps can't be disabled;
  - the Arweave fallback handles only new candidates.

  Verify `test_select_never_reuses_stale_decoded_vault`, `test_secure_logs_only_core_dump_failures`, and `mypy --strict`.
- [x] 15.5 Write the review record `docs/reviews/recovery-tool-v1.md` covering both rounds and the residual risk. Verify the file exists and is linked from the security-review task.
