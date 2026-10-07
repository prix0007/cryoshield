# Spec Delta

## ADDED Requirements

### Requirement: Ordered registry versions
For the selected chain, the tool SHALL hold an ordered list of VaultRegistry deployments, newest first (by version, highest first). Each entry SHALL have a version (`v1`, `v2`, …), an address, a deploy block and an ABI kind. Built-in presets SHALL list every registry version deployed on their chain. The tool SHALL read every listed registry for each locator (and for `--vault-id`) and treat the candidates as one list. Each registry SHALL keep its own resolve and fetch time budgets, with per-RPC caps, so that one slow registry or RPC cannot starve another. A list SHALL hold at most 8 registries, with unique versions and unique addresses.

#### Scenario: Three registries are read
- **WHEN** the list holds v3 (with the v2 ABI), v2 and v1, and the user's vault exists only in v3
- **THEN** the tool reads all three registries, finds the vault in v3 and opens it

#### Scenario: Chain with only v2
- **WHEN** a preset lists only v2 (OP Mainnet)
- **THEN** only v2 is called, and no other registry address appears in any request

#### Scenario: Budgets stay per registry
- **WHEN** one registry's RPC hangs on every call
- **THEN** the other registries are still read within their own budgets, and the vault in them is found

### Requirement: Newest registry holding a vault ID is authoritative
For a vault ID with copies in several registries, the tool SHALL treat the newest registry that has an agreed, non-empty event history for that ID as authoritative. The tool SHALL classify every copy from an older registry against that history: VERIFIED only if it equals the latest blob, otherwise OUTDATED or UNMATCHED. A copy from a newer registry whose agreed history is empty SHALL be UNMATCHED. If the history of a newer registry cannot be confirmed before an authority is found, the tool SHALL NOT call any copy of that ID current. When the remaining copies come from more than one registry, they SHALL be marked contested, so the user must choose. For a list of v2 and v1, the outcomes SHALL equal the harden-gas-sponsorship rule ("v2 is authoritative").

#### Scenario: Copy superseded by a newer registry
- **WHEN** a vault ID has a copy in v2 and a newer copy in v3, and v3's history agrees on its latest blob
- **THEN** the v3 copy is shown as current and the v2 copy is OUTDATED

#### Scenario: Plant in the oldest registry
- **WHEN** someone registers a v3 vault's ID in v1 with an older blob, and v2's history for that ID is agreed empty
- **THEN** the v1 copy is classified against v3's history and is never called current, with a security warning

#### Scenario: Newest history unverifiable
- **WHEN** copies of one vault ID come from v3 and v2, and v3's event history cannot be confirmed
- **THEN** no copy is called current, both are contested, and in a non-interactive run the tool exits with code 12 without showing a secret

#### Scenario: Copy without history in a newer registry
- **WHEN** a server returns a v3 copy of an ID whose v3 history is agreed empty, and v2 holds the ID with an agreed history
- **THEN** the v3 copy is UNMATCHED and the v2 copy keeps its status

### Requirement: Built-in registry lists match the deployment records
The built-in presets SHALL be embedded in the tool and SHALL NOT be read from repository files at runtime. A test SHALL parse every `contracts/deployments/<chainId>.json` with the same parser as `--deployment-file`, and SHALL fail unless each preset's registry list equals the record's list (version, address, deploy block and ABI kind). The parser SHALL read the top-level v1 fields, `contracts.vaultRegistryV2`, and the forward-compatible keys `contracts.vaultRegistries.v<N>` and `contracts.vaultRegistryV<N>`. The test SHALL fail when a record lists a registry version that the preset lacks, when a record's chain has no preset, and when a record names a version this release cannot read.

#### Scenario: A new version is added to a record
- **WHEN** `contracts/deployments/11155420.json` gains `contracts.vaultRegistries.v3` and the op-sepolia preset is not updated
- **THEN** the parity test fails and prints the preset entry to add

#### Scenario: No runtime read
- **WHEN** the tool runs with its defaults
- **THEN** it opens no file under `contracts/deployments`

### Requirement: Registry configuration without a code change
The tool SHALL accept a repeatable `--registry ADDRESS[@DEPLOY_BLOCK][:vN[:abi=vK]]`. By default each entry SHALL replace the base entry with the same version, or add that version. With `--registries-only`, only the given entries SHALL be used. `--deployment-file PATH` SHALL load a deployment record or a saved `/release.json`, use every registry in it as the base list, and refuse a chain ID that conflicts with `--network`, `--testnet` or `--chain-id`. `--registry-v2`, `--deploy-block-v2`, `--deploy-block` and `--registry ADDRESS` without a version SHALL keep working as deprecated aliases, each printing its new form. Every address, block and version SHALL be validated, with a usage error (exit code 2) on bad input. An entry without a deploy block, other than the built-in entry for the same version and address, SHALL search history from block 0, with a warning.

#### Scenario: Add a newer registry
- **WHEN** the user passes `--registry 0x…@500:v3:abi=v2` on op-sepolia
- **THEN** the list is v3, v2, v1, with v3 searched from block 500

#### Scenario: Replace one version
- **WHEN** the user passes `--registry 0x…:v2`
- **THEN** the built-in v2 entry is replaced, v1 stays, and a warning says v2's history is searched from block 0

#### Scenario: Only the given registries
- **WHEN** the user passes `--registries-only --registry 0x…@7:v2`
- **THEN** only that registry is read, and the startup summary names the built-in versions that were dropped

#### Scenario: Deployment file
- **WHEN** the user passes `--deployment-file 11155420.json` without `--network`
- **THEN** the op-sepolia preset's RPCs are used with every registry in the file, and a file for another chain together with `--network op-sepolia` is refused with exit code 2

#### Scenario: Deprecated alias
- **WHEN** the user passes `--registry-v2 0x… --deploy-block-v2 1`
- **THEN** v2 is that address from block 1, and a note shows `--registry 0x…@1:v2`

#### Scenario: Malformed entry
- **WHEN** the user passes `--registry 0x1234@-5:v0`
- **THEN** the tool exits with code 2 and shows the expected form, before any network contact

### Requirement: Unknown registry versions are refused
The tool SHALL know the read ABIs of VaultRegistry v1 and v2. For a version above 2, it SHALL use an ABI kind only when one is stated explicitly (`:abi=vK`), or when the entry's `abiHash` equals the pinned keccak256 of a known ABI file. Otherwise the tool SHALL exit with code 2 and the message "this tool doesn't know registry vN; update cryoshield-recover", and SHALL NOT guess or contact any server. The pinned ABI hashes SHALL be tested against `contracts/abi/VaultRegistry.json` and `contracts/abi/VaultRegistryV2.json`.

#### Scenario: Unknown version from the command line
- **WHEN** the user passes `--registry 0x…@1:v3` without `abi=`
- **THEN** the tool exits with code 2 and says it doesn't know registry v3 and should be updated

#### Scenario: New version with a known ABI in a record
- **WHEN** a deployment file lists v3 with an `abiHash` equal to VaultRegistryV2.json's hash
- **THEN** v3 is read with the v2 ABI

#### Scenario: New version with an unknown ABI in a record
- **WHEN** a deployment file lists v4 with an unknown `abiHash`
- **THEN** the tool exits with code 2 and names v4

### Requirement: Registries are announced at startup
Before contacting any server, the tool SHALL print every registry in use, newest first, with its version, address, first block searched and source (built-in, `--registry`, or the deployment file's name). The tool SHALL print a security note when any registry is not built in, because such a registry can decide which copy is current. The summary SHALL contain only public values.

#### Scenario: Supplied registry announced
- **WHEN** the user adds `--registry 0x…@500:v3:abi=v2`
- **THEN** the summary lists v3, v2 and v1 in that order with their sources, and a security note about supplied registries, before any request is sent
