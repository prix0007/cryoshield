# Spec Delta

## ADDED Requirements

### Requirement: Live registry check covers every built-in registry
The recovery tool's opt-in live test (`pytest -m network`) SHALL read every registry in the built-in OP Sepolia preset, newest first, through the same `Registries` reader the CLI uses, and SHALL confirm on at least two built-in RPCs that each registry answers as its ABI kind expects for an unknown locator (v1: `resolveLocator` empty; v2: `locatorLength` 0 and `getVaults([])` empty). An offline test that runs by default SHALL build the same reader and assert that it covers exactly the preset's registries, so a change to the preset's shape fails the default test run.

#### Scenario: Preset fields renamed
- **WHEN** the preset's registry fields change shape and the live test still names the old ones
- **THEN** the default offline test run fails, without needing `-m network`

#### Scenario: Live run on OP Sepolia
- **WHEN** a maintainer runs `uv run --frozen pytest -m network tests/test_live_op_sepolia.py`
- **THEN** registries v2 and v1 are both checked on at least two built-in RPCs, and a random locator resolves to no vault
