# Design: Recovery tool reads every registry version

## Context

- **Policy (decided):** registries are immutable and versioned. A new version is a new deployment next to the old ones, and clients read every version. There is no admin, no proxy and no on-chain directory.
- **Today (`main`, PR #40):**
  - `tools/recover` reads VaultRegistry v2 and then v1. `chain.Registries(v2, v1)` cross-checks every v1 copy against v2's agreed event history (harden-gas-sponsorship D9 and its 2026-10-07 implementation notes).
  - Presets carry `registry`/`deploy_block` and `registry_v2`/`deploy_block_v2`. A test checks them against `contracts/deployments/<chainId>.json` (the top-level `address` and `contracts.vaultRegistryV2`).
- **Deployment records** (`contracts/deployments/README.md`):
  - v1 is the top-level `{address, deployBlock, txHash, abiHash}`, only on chains where v1 exists;
  - v2 is `contracts.vaultRegistryV2`;
  - `abiHash` is the keccak256 of the exact bytes of `contracts/abi/<Name>.json`.
- **`/release.json`** (`apps/web/deploy/release-manifest.mjs`): `config.chainId`, `config.registry` (v1 `{address, deployBlock}` or `null`), and `config.registryV2`.
- **Constraints** (`openspec/config.yaml`):
  - no CryoShield backend;
  - recovery without CryoShield;
  - the tool needs no CryoShield URL and never reads repo files at runtime (the binary must work outside the repo).

## Goals / Non-Goals

**Goals:**
- Read any number of registry versions per chain, newest first, with the PR #40 budgets per registry.
- Generalise the authority rule to "the newest registry holding a vault ID is authoritative", with the same outcomes as today for v1 + v2.
- Make a new deployment usable without a code change: by a flag, or by loading a deployment record or a saved `/release.json`.
- Make CI fail when a deployment record has a registry version that the tool's presets lack.
- Refuse unknown ABIs instead of guessing.

**Non-Goals:** editing `contracts/` or the web app, an on-chain directory, network fetches of `/release.json`, and any vault-format change.

## Decisions

### D1. Registry model

`RegistrySpec(version: int, address: str, deploy_block: int, abi_kind: 1 | 2, block_known: bool, source: str)`.
- `version` ≥ 1 is the deployment's version (`v3` → 3). `abi_kind` is the read ABI the tool uses: 1 is the v1 views (`resolveLocator(bytes32)`, `getVault`), and 2 is the v2 views (paged `resolveLocator`, `locatorLength`, `getVaults`). Both share the `VaultCreated`/`VaultUpdated` event layout.
- A chain's list is sorted by `version`, descending, so the newest comes first. Versions and addresses are unique within a list; a duplicate is a usage error.
- At most `MAX_REGISTRIES = 8` entries. Each registry keeps its own resolve (30 s) and fetch (60 s) budgets and per-RPC caps, so the worst-case time grows with the count. The cap bounds that, and 8 is far above the expected v1–v3.
- `NetworkPreset.registries` and `Config.registries` replace the v1/v2 field pairs. `Config.has_registry` means "the list is non-empty".

*Alternatives rejected:*
- *Keep the v1/v2 fields and add `registry_v3`:* this repeats the problem at every version.
- *Order by deploy block:* versions are explicit in the records, and a block can be unknown (0).

### D2. Authority rule: the newest holder wins

For each vault ID, let `R0 … Rn-1` be the registries, newest first, and `j` the oldest registry that returned a copy. If `j = 0`, only the newest registry holds copies, and its own quorum and history reconcile decides, as today for v2-only IDs. Otherwise, walk `i = 0 … j-1` and read `Ri`'s agreed event history (`event_hashes`, cached, within the shared history deadline):
1. **`Ri`'s history is unverifiable (None):** no copy can be called current.
   - Copies in registries newer than `Ri` (whose histories agreed empty) are UNMATCHED.
   - Every other copy that was CURRENT or VERIFIED becomes UNVERIFIABLE.
   - If copies come from more than one of the remaining registries, they are all `contested`, so the user must choose, and ranking by server count never decides.
2. **`Ri`'s history is non-empty:** `Ri` is authoritative.
   - Copies in older registries are classified against its history: VERIFIED only if equal to its latest blob, then OUTDATED or UNMATCHED.
   - Copies in newer registries (whose histories agreed empty) are UNMATCHED.
   - `Ri`'s own copies keep their reconcile result.
3. **`Ri`'s history is agreed empty:** continue with `i + 1`.

If every newer history is agreed empty, copies in those newer registries are UNMATCHED (a copy without a history is a lie), and the oldest holder's own classification stands. This covers legacy v1-only vaults.

`Registries.event_hashes(vid)`, used to classify Arweave copies, walks newest first and returns the first history that is None or non-empty, or the last (empty) one.

For `[v2, v1]` this is exactly the PR #40 behaviour (unit tests keep their expectations):
- v2 None → contested if both hold copies;
- v2 non-empty → v1 classified against it;
- v2 empty → v2 copies UNMATCHED and v1 stands.

*Cost:* a copy found in an older registry costs one history lookup per newer registry until an authority is found. That is one extra lookup per id when v3 exists, within the existing history deadline.

*Trade-off:* with v3 listed, a v2-only vault whose v3 history can't be confirmed is no longer called current. It opens with the existing "could not confirm that this is the latest version" warning, and it is not contested, so no choice is forced. This is the price of never showing a copy that a newer registry has superseded.

### D3. Reads over the list

- **resolve:** every registry, newest first. The union keeps that order (v2 ids before v1 ids today).
- **fetch:**
  - kind-2 registries read every id (batched `getVaults`, cheap);
  - kind-1 registries read the ids that a kind-1 registry reported, or that no registry reported (`--vault-id` mode). They skip ids found only through kind-2 lists, as PR #40 skips "v2-only" ids for v1.
- **Budgets:** unchanged and per registry: resolve 30 s with 10 s per (RPC, locator), and fetch 60 s with 20 s per RPC. One shared session holds the RPC clients, the quorum and the history deadline.
- **Origins:** with more than one registry, each candidate's origin is labelled `registry vN: hosts`.

### D4. Presets: checked against the records, in both directions

Presets stay embedded Python data, because the binary must not read repo files at runtime (an existing test guards this). `tests/test_networks.py` parses every `contracts/deployments/<chainId>.json` with `deployments.parse_record`, the same code as `--deployment-file`. It asserts that each preset's list equals the record's list exactly: version, address, deploy block and ABI kind. On failure it prints the exact `RegistrySpec(...)` lines to paste. It also fails:
- when a record's chain has no preset;
- when a record names a version this release cannot read: an unknown version with an unknown `abiHash` (see D6). That release then needs new code, and CI says so.

*Alternative rejected:* *generate `config.py` at build time.* The build script would need the repo, and the parity test already makes drift impossible to merge. The release flow (record PR → failing parity test → preset update) is documented in the README.

### D5. Record key proposal (for the contracts engineer; not edited here)

Keep the existing keys forever. Records are append-only history, and old tools read them:
- the top-level fields for v1;
- `contracts.vaultRegistryV2` for v2.

For v3 and later, **propose**:

```jsonc
"contracts": {
  "vaultRegistryV2": { … },                 // unchanged
  "vaultRegistries": {                      // NEW: v3 and later, keyed "v<N>"
    "v3": { "address": "0x…", "deployBlock": 123, "txHash": "0x…", "abiHash": "0x…" }
  }
}
```

- The `v<N>` keys are what the tool's `:vN` syntax uses. A map keyed by version (not a list) keeps `deploy.sh`'s "merge, keys sorted" behaviour and makes duplicates impossible.
- `abiHash` is required. It is how a tool released before v3 can still read v3 safely when v3's ABI is byte-identical to v2's (D6).

The parser also accepts `contracts.vaultRegistryV<N>` keys (the `vaultRegistryV3` pattern), in case the contracts side prefers that. The same version under both keys with different values is an error.

For `/release.json`, **propose** `config.registries: [{ "version": "v3", "address", "deployBlock", "abiHash" }]` next to the existing `config.registry` and `config.registryV2`. The parser accepts `config.registry`, `config.registryV2`, `config.registryV<N>` and `config.registries`.

### D6. ABI kinds: refuse unknown versions, never guess

- Versions 1 and 2 have fixed ABI kinds 1 and 2.
- For version N ≥ 3, the kind comes from:
  1. an explicit `:abi=vK` on the flag (K ∈ {1, 2}), which is the user's statement;
  2. a record or release entry whose `abiHash` equals the pinned keccak256 of `contracts/abi/VaultRegistry.json` (kind 1) or `contracts/abi/VaultRegistryV2.json` (kind 2). This is the same ABI byte for byte, not a guess. A test pins both hashes against the files.
- Otherwise the tool refuses: "This tool doesn't know registry vN (address …). Update cryoshield-recover, or pass --registry ADDRESS@BLOCK:vN:abi=v2 if you know its read functions match v2." The exit code is 2 (USAGE), and nothing is contacted.
- A known version with an explicit `abi=` that differs from its own kind is a usage error.

### D7. CLI grammar and merge rules

- **`--registry SPEC`**, repeatable. `SPEC = ADDRESS ["@" BLOCK] [":v" N [":abi=v" K]]`.
  - `ADDRESS` is 0x and 40 hex digits; it is stored lower-case.
  - `BLOCK` is a decimal integer in [0, 2^63).
  - `N` is in [1, 999] with no leading zero.
  - Anything else is a usage error that quotes the expected form.
- **Base list:** the `--deployment-file` list if given, otherwise the selected preset's list (empty for a custom chain).
- **Default, merge by version:** each `--registry` entry replaces the base entry with the same version, or is added if that version is new. So `--registry ADDR@B:v3` adds v3 next to the built-in v1 and v2.
- **`--registries-only`:** the base list is ignored, and only the `--registry` entries (including the deprecated aliases) are used. It needs at least one `--registry`, and it can't be combined with `--deployment-file`, whose list is already explicit.
- **No `:vN`:**
  - if the address equals a base entry's address, that entry's version is used;
  - otherwise the version is 1. This is `--registry`'s meaning before this change; a note says so and suggests `:v2`.
- **No `@BLOCK`:**
  - if the (version, address) equals the base entry, its block is kept;
  - otherwise the block is 0, `block_known` is false, and a warning says history is searched from block 0 (as today).
- **Deprecated aliases** (each prints a one-line note with the new form):
  - `--registry-v2 A` is `--registry A:v2`;
  - `--deploy-block-v2 B` sets the block of the final v2 entry;
  - `--deploy-block B` sets the block of the final v1 entry.

  A block flag without that version in the final list is a usage error.

### D8. `--deployment-file PATH`

- **Reading:** at most 1 MiB of UTF-8 JSON, and the top level must be an object.
  - A file with a top-level `config` object holding `chainId` is a release file. A file with a top-level `chainId` is a deployment record. Anything else is a usage error.
  - Unrelated keys (wallets, files, treeHash) are ignored.
- **Chain:** the file's chain ID selects the network.
  - With `--network`, `--testnet` or `--chain-id`, the two must match, or it is a usage error.
  - Without them, the preset for that chain is used (its RPCs), or a custom chain, which needs `--rpc`.
- **Validation:** every address and block is validated as for the flag.
  - A missing `deployBlock` means block 0, with the warning.
  - An entry that is not an object, a version key that is not `v<N>`, a duplicate version or a duplicate address is an error.
  - A file with no registry is an error.
- **Not at runtime:** the file is read only when the user names it. The default run still reads no file (existing test).

### D9. Startup summary

Before any network contact, the tool prints every registry newest first, as `registry v3 0x… from block 123 (from --registry)`. The source is one of `built-in`, `from --registry` or `from <file name>`. Then it prints:
- the no-block warning, per entry;
- a SECURITY note when any registry is not built in: "A registry you supplied can decide which copy of a vault is current; use only addresses from a source you trust";
- a warning naming each built-in entry that is not used in this run (dropped by `--registries-only` or a deployment file, or replaced by another address).

Only public data is printed (addresses, blocks, the file's base name). RPC URLs are shown as hosts, as today.

### Web app (report only, not changed)

`apps/web` is not generic over registries:
- `src/config.ts` and `vite-env.d.ts` have `registryV1` and `registryV2`;
- `src/chain/registry.ts` reads `config.registryV2` then `config.registryV1`, with `RegistryVersion = 'v1' | 'v2'`;
- `src/ui/services.tsx` holds `registries: { v1, v2 }`;
- `deploy/release-manifest.mjs` reads only `contracts.vaultRegistryV2` and the top-level v1.

A v3 needs a web change (a separate change, owner frontend). This change does not touch it.

## Threat model

| Attacker / failure | Can | Cannot | Mitigation |
|---|---|---|---|
| A lying RPC claims an extra registry exists | Nothing: the tool never discovers registries on-chain (there is no directory) | Add a registry to the list | Registries come only from presets, flags or a file the user names |
| A malicious deployment file or `--registry` address, from social engineering ("use this new v9 address") | Run a contract that returns an older genuine blob of the victim's vault (old blobs are public in calldata) and fake events, so the "newest" registry vouches for a stale copy: a **rollback** | Forge a blob that decrypts (AES-GCM + the vaultId AAD binding), or learn anything (all reads are `eth_call`/`eth_getLogs`, and no secret leaves the process) | Explicit opt-in only, a startup SECURITY note for every non-built-in registry, and a README warning. Built-in presets are parity-checked against reviewed records |
| `--registries-only` or a file that omits the newest built-in registry (downgrade) | Hide the newer copy, so an older registry's copy looks current | Change built-in behaviour without the flag | A startup note names each dropped built-in version. Documented |
| A record or flag with an unknown ABI | Mis-decoding: wrong offsets, junk ids, or a missed vault | Run anything: decoding stays the bounded PR #40 codec | D6 refuses unknown versions without a known `abiHash` or an explicit `abi=` |
| A wrong (too high) deploy block | Hide the first events, so a newer registry's history looks empty and an older copy keeps its own status | Do this with built-in data (parity-checked) | No block means 0 with a warning. A user-given block is the user's statement (documented) |
| A hostile or huge file | Exhaust memory, or inject terminal escapes in errors | Execute code | A 1 MiB cap, JSON only, strict validation, and inert error text (addresses are validated before printing; other values are never echoed raw) |
| A v1 plant (caller-chosen id) of a v2 or v3 vault | Present a stale copy | Be called current while any newer registry holds the id with an agreed history | D2 checks every older copy against every newer registry |
| One slow registry | Spend its own budget | Starve other registries or RPCs | Per-registry and per-RPC budgets (unchanged); `MAX_REGISTRIES = 8` bounds the total |

Secrets: no change to key handling. The new code handles only public addresses, blocks and file names, and no new output path can include a PRF output, key or plaintext.

## Risks / Trade-offs

- **A newer registry's unverifiable history downgrades older copies to unverified** (D2) → accepted. They still open, with a warning, and contested copies need a choice. This is never worse than PR #40 for today's v1 + v2 lists.
- **A bare `--registry ADDRESS` means v1** (compatibility) → a note on every use, and the README recommends `:vN`.
- **Time scales with the number of registries** → bounded by `MAX_REGISTRIES`, and each registry's budgets are unchanged.
- **The record key is only a proposal** → the parser accepts both plausible shapes (`vaultRegistries.vN` and `vaultRegistryVN`), and the parity test fails loudly on any new shape it can't map.

## Migration

- Users: none. The defaults are the same, the old flags still work, and the deprecated ones print the new form.
- A v3 release:
  1. contracts add `contracts.vaultRegistries.v3` (with `abiHash`) to the records;
  2. the parity test fails and prints the preset line;
  3. the tool engineer adds it and releases.

  Older tool releases still read v3 with `--registry …:v3:abi=v2`, or with `--deployment-file` and the new record (no `abi=` needed when v3's `abiHash` is v2's).

## Implementation notes (recovery tool, 2026-10-08)

- `config.py`: `RegistrySpec`, `parse_registry_flag`, `apply_registry_flags`, `sort_registries`, `abi_kind_for`, and `ABI_HASHES` (pinned against `contracts/abi/*.json` by a test). `RegistrySpec` validates itself: version, address (not zero), block and ABI kind.
- `deployments.py`: one parser for records and release files. The parity test and `--deployment-file` both use it.
- `chain.Registries(registries)`: sorted newest first. `Registries.build(urls, chain_id, specs)` replaces the `v2=`/`v1=` keywords.
- A "dropped" built-in (D9) is any built-in entry whose version and address are not both in the final list. A built-in replaced by another address is announced too.
- `tests/support/fakes.py`: `FakeChain.add_registry()` serves a further v2-ABI registry (the fake v3) on the same node.
- The anvil v1 + v2 e2e uses the new `--registry ADDR@BLOCK:vN` and `--registries-only`. The v1-only anvil e2e still uses the bare `--registry ADDR --deploy-block N` form, so the deprecated path is covered end to end.

## Open Questions

- Contracts: do you adopt `contracts.vaultRegistries.v<N>` (proposed) or `contracts.vaultRegistryV<N>`? Both parse; please pick one in `deployments/README.md`.
- Deploy: add `config.registries` to `/release.json` when v3 ships.
