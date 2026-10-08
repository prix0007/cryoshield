# Tasks

## 1. Live check over every registry [rec]

- [x] 1.1 Show the failure: `uv run --frozen pytest -m network tests/test_live_op_sepolia.py` fails with `AttributeError: 'NetworkPreset' object has no attribute 'registry'`.
- [x] 1.2 Test first: add the offline test `test_live_check_covers_every_builtin_registry` (no `network` marker) that calls the live module's `live_registries()` and asserts versions `[2, 1]`, the preset addresses and ABI kinds. See it fail (no `live_registries`). Then rewrite the live test to use `Registries.build(P.rpcs, P.chain_id, P.registries)` and check each registry by ABI kind (v1 `resolveLocator`; v2 `locatorLength` and `getVaults([])`), plus `MAX_BLOB_SIZE` and `Registries.resolve`. Move the `network` marker to the live test. Verify: `uv run --frozen pytest -q` (offline) and, opt-in, `uv run --frozen pytest -m network tests/test_live_op_sepolia.py`.

## 2. Integration

- [x] 2.1 `uv run --frozen pytest -q`, `uv run --frozen ruff check` and `ruff format --check` on the file if configured, `openspec validate --all --strict`. Record the numbers in the PR.
