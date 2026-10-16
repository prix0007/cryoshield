# Tasks

## 1. Tests first

- [x] 1.1 `tools/recover/tests/test_root_readme.py`: the dependency section states `SHA-256("WebAuthn PRF" || 0x00 ||`,
  the locator-salt input from `derive.LOCATOR_SALT_INPUT`, the spec anchor `#3-single-prf-input-and-ctap-salt-mapping`
  and `derive.py`; the "A wrong RP ID does not look like a bad key" paragraph quotes the first sentence of
  `recover.NOT_LISTED` and `recover.DID_NOT_UNLOCK`, the prefix of `recover.NO_DISCOVERABLE_CREDENTIAL`, names
  `--vault-id` and `AES-256-GCM`. Fails on the current README.
- [x] 1.2 `tools/recover/tests/test_vault_id_binding.py`: `--blob-file` with a wrong `--vault-id` still exits 7 with no
  output, and the error names `--vault-id` and says the key is listed but did not unlock. Fails on the current message.
- [x] 1.3 `tools/recover/tests/test_recover.py`: `--vault-id` with a key the vault does not list exits 5 with the
  `NOT_LISTED` message.

## 2. Implementation

- [x] 2.1 `recover.py`: `NO_DISCOVERABLE_CREDENTIAL`, `NOT_LISTED` and `DID_NOT_UNLOCK` constants; the last one names
  `--vault-id` and the damaged-copy cause (D3, D4).
- [x] 2.2 README: the salt-mapping paragraph and the wrong-RP-ID paragraph in the RP ID subsection (D5).
- [x] 2.3 `tools/recover/README.md`: a troubleshooting entry for the "listed but did not unlock" message.

## 3. Verification

- [x] 3.1 `uv run --frozen pytest` (whole recovery suite), `uv run ruff check src tests`, `uv run ruff format --check`,
  `uv run mypy` clean; `openspec validate --all --strict` passes.

  2026-10-16: the new tests failed on the old code (ImportError on the missing constants, then the README
  assertions); then the whole recovery suite passed (966 tests, 7 opt-in skips); ruff, ruff format and mypy clean;
  49 OpenSpec items valid.

## 4. Review

- [x] 4.1 Security review recorded in `design.md` D6.
