# Spec Delta

## MODIFIED Requirements

### Requirement: Built-in defaults with overrides
The tool SHALL ship with a built-in RP ID, chain ID, list of registry deployments, a list of at least three independent public RPC endpoints, and at least two Arweave GraphQL/gateway endpoints. Every one of these SHALL be overridable or extendable by a command-line flag, without editing code. Registry overrides SHALL follow "Registry configuration without a code change" and "Supplied registries never outrank built-in ones".

#### Scenario: Override registry and RPC
- **WHEN** the user passes `--rpc <url>` (repeatable), `--registries-only --registry <address>@<block>:v2`, and `--rp-id <id>`
- **THEN** the tool uses only those values and reports them in its startup summary

#### Scenario: Defaults used
- **WHEN** the user passes no overrides
- **THEN** the tool uses the built-in defaults and prints which endpoints and registries it will contact before contacting any

## ADDED Requirements

### Requirement: Ordered registry versions
For the selected chain, the tool SHALL hold an ordered list of VaultRegistry deployments. Each entry SHALL have a version (`v1`, `v2`, …), an address, a deploy block and an ABI kind. Trusted entries (built-in) SHALL come first, newest version first, then untrusted (supplied) entries, newest first. Built-in presets SHALL list every registry version deployed on their chain. The tool SHALL read every listed registry for each locator (and for `--vault-id`) and treat the candidates as one list. Each registry SHALL keep its own resolve and fetch time budgets, with per-RPC caps, so that one slow registry or RPC cannot starve another. A list SHALL hold at most 8 registries, of which at most 4 are supplied entries that differ from the built-ins. Addresses SHALL be unique, and a version SHALL appear at most once among trusted and once among untrusted entries.

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
For a vault ID with copies in several registries, the tool SHALL walk the registries in list order (trusted first) and treat the first one with an agreed, non-empty event history for that ID as authoritative. The tool SHALL classify every copy from a later registry against that history: VERIFIED only if it equals the latest blob, otherwise OUTDATED or UNMATCHED. A copy from an earlier registry whose agreed history is empty SHALL be UNMATCHED. If a history cannot be confirmed before an authority is found, the tool SHALL NOT call any copy of that ID current. When the remaining copies come from more than one registry, they SHALL be marked contested, so the user must choose. For a list of v2 and v1, the outcomes SHALL equal the harden-gas-sponsorship rule ("v2 is authoritative").

#### Scenario: Copy superseded by a newer registry
- **WHEN** a vault ID has a copy in built-in v2 and a newer copy in built-in v3, and v3's history agrees on its latest blob
- **THEN** the v3 copy is shown as current and the v2 copy is OUTDATED

#### Scenario: Plant in the oldest registry
- **WHEN** someone registers a v3 vault's ID in v1 with an older blob, and v2's history for that ID is agreed empty
- **THEN** the v1 copy is classified against v3's history and is never called current, with a security warning

#### Scenario: Newest history unverifiable
- **WHEN** copies of one vault ID come from v3 and v2, and v3's event history cannot be confirmed
- **THEN** no copy is called current, both are contested, and in a non-interactive run the tool exits with code 12 without showing a secret

#### Scenario: Unverifiable middle registry
- **WHEN** v3's history for an ID is agreed empty, v2's cannot be confirmed, and only v1 holds a copy
- **THEN** the v1 copy is not called current, and it is not contested

#### Scenario: Copy without history in a newer registry
- **WHEN** a server returns a v3 copy of an ID whose v3 history is agreed empty, and v2 holds the ID with an agreed history
- **THEN** the v3 copy is UNMATCHED and the v2 copy keeps its status

### Requirement: Supplied registries never outrank built-in ones
A registry entry from `--registry` or `--deployment-file` whose version and address equal a built-in entry's SHALL be that built-in entry, with no warning. Its deploy block MAY be lower than the built-in block, and a higher block SHALL be refused with a usage error, because it could hide the vault's first events. Any other supplied entry SHALL be untrusted while the chain has a built-in registry. An untrusted registry:
- SHALL be read in addition to the built-in registries (never instead of one, unless `--registries-only` is given);
- SHALL be walked after every built-in registry;
- SHALL have its copies capped at UNVERIFIABLE and marked contested, never CURRENT or VERIFIED;
- SHALL have an empty event history treated as unverifiable, never as agreed empty;
- SHALL never be the basis of a VERIFIED Arweave copy.

On a chain without built-in registries, or with `--trust-custom-registries`, supplied entries SHALL be trusted, with a security warning. When the opened copy came from an untrusted registry, the tool SHALL repeat the warning next to the result, and next to the `--output` and `--save-blob` messages.

#### Scenario: Phished newer version
- **WHEN** the user passes `--registry 0xATTACKER@N:v99:abi=v2`, and that contract serves an older genuine blob with a matching history while built-in v2 holds the current blob
- **THEN** the built-in v2 copy is shown, and the v99 copy is OUTDATED and contested

#### Scenario: Copy only in a supplied registry
- **WHEN** the vault exists only in a supplied v3 registry
- **THEN** it opens with a "could not confirm" warning and a security warning naming the supplied registry, repeated next to `--output` and `--save-blob`

#### Scenario: Raised deploy block
- **WHEN** the user passes the built-in v2 address with a block above the built-in deploy block
- **THEN** the tool exits with code 2, naming the built-in block

#### Scenario: Supplied v1 beside the built-in v1
- **WHEN** the user passes `--registry 0x…@5:v1` for an empty contract, and the genuine vault is in the built-in v1
- **THEN** both are read and the genuine vault opens

#### Scenario: Deployment file restating the built-ins
- **WHEN** `--deployment-file` names a record equal to the built-in entries
- **THEN** every entry is built-in and no security warning is printed

### Requirement: Built-in registry lists match the deployment records
The built-in presets SHALL be embedded in the tool and SHALL NOT be read from repository files at runtime. A test SHALL parse every `contracts/deployments/<chainId>.json` with the same parser as `--deployment-file`, and SHALL fail unless each preset's registry list equals the record's list (version, address, deploy block and ABI kind). The parser SHALL read the top-level v1 fields, `contracts.vaultRegistryV2`, and the forward-compatible keys `contracts.vaultRegistries.v<N>` and `contracts.vaultRegistryV<N>`. The test SHALL fail when a record lists a registry version that the preset lacks, when a record's chain has no preset, and when a record names a version this release cannot read.

#### Scenario: A new version is added to a record
- **WHEN** `contracts/deployments/11155420.json` gains `contracts.vaultRegistries.v3` and the op-sepolia preset is not updated
- **THEN** the parity test fails and prints the preset entry to add

#### Scenario: No runtime read
- **WHEN** the tool runs with its defaults
- **THEN** it opens no file under `contracts/deployments`

### Requirement: Registry configuration without a code change
The tool SHALL accept a repeatable `--registry ADDRESS[@DEPLOY_BLOCK][:vN[:abi=vK]]`, which adds a registry to the list. With `--registries-only`, only the supplied entries SHALL be used. `--deployment-file PATH` SHALL load a deployment record or a saved `/release.json` and supply every registry in it. It SHALL refuse a chain ID that conflicts with `--network`, `--testnet` or `--chain-id`. The file SHALL be bounded and strict: at most 1 MiB, duplicate JSON keys refused, excessive nesting refused, and every value matched in full (a trailing newline is invalid). `--registry-v2`, `--deploy-block-v2`, `--deploy-block` and `--registry ADDRESS` without a version SHALL keep working as deprecated or shorthand forms, each printing a note with the explicit form. Every address, block and version SHALL be validated, with a usage error (exit code 2) on bad input. An entry without a deploy block, other than a built-in entry, SHALL search history from block 0, with a warning.

#### Scenario: Add a newer registry
- **WHEN** the user passes `--registry 0x…@500:v3:abi=v2` on op-sepolia
- **THEN** the list is v2, v1 (built-in), then v3 (supplied), with v3 searched from block 500

#### Scenario: Only the given registries
- **WHEN** the user passes `--registries-only --registry 0x…@7:v2`
- **THEN** only that registry is read, and the startup summary names the built-in versions that were dropped

#### Scenario: Deployment file
- **WHEN** the user passes `--deployment-file 11155420.json` without `--network`
- **THEN** the op-sepolia preset's RPCs are used with every registry in the file, and a file for another chain together with `--network op-sepolia` is refused with exit code 2

#### Scenario: Deprecated alias
- **WHEN** the user passes `--registry-v2 0x… --deploy-block-v2 1`
- **THEN** that address is read as a supplied v2 from block 1, and a note shows `--registry 0x…@1:v2`

#### Scenario: Malformed entry
- **WHEN** the user passes `--registry 0x1234@-5:v0`, or a valid entry followed by a newline
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
Before contacting any server, the tool SHALL print every registry in use, in list order, with its version, address, first block searched and source (built-in, `--registry`, or the deployment file's quoted name with control characters removed). It SHALL mark untrusted entries as supplied. The tool SHALL print a security note when any supplied entry differs from the built-ins, and a warning naming built-in entries left out by `--registries-only`. The summary SHALL contain only public values.

#### Scenario: Supplied registry announced
- **WHEN** the user adds `--registry 0x…@500:v3:abi=v2`
- **THEN** the summary lists v2 and v1 (built-in), then v3 marked supplied, and a security note, before any request is sent
