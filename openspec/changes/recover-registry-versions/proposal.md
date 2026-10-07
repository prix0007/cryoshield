# Proposal: Recovery tool reads every registry version

## Why

The founder asked (2026-10-08): "make sure that recover tool uses the latest deployed version of contract or contract address for vault is configurable since we will have immutable updates if needed in contracts."

The registry upgrade policy is decided: registries are immutable and versioned. A future VaultRegistry v3 is a new contract deployed next to v1 and v2, and clients read every version. There is no admin, no proxy and no on-chain directory.

The recovery tool (`tools/recover`, PR #40) is hard-wired to exactly two versions:
- `NetworkPreset` and `Config` have one field pair for v1 (`registry`, `deploy_block`) and one for v2 (`registry_v2`, `deploy_block_v2`);
- `chain.Registries` takes `v2=` and `v1=`, and the cross-registry rule says "v2 is authoritative";
- the flags are `--registry` (v1), `--registry-v2`, `--deploy-block` and `--deploy-block-v2`.

So a v3 deployment would need a code change and a new release before the tool could see it. Until then, a user whose vault moved to v3 would be shown the older v2 copy, and the tool might call it current. The recovery tool is the guarantee that users survive CryoShield disappearing, so a new registry version must be usable without new code.

## What Changes

- **An ordered list of registries, newest first.** Each entry has a version (`v1`, `v2`, …), an address, a deploy block and an ABI kind. Presets list every version deployed on their chain. All reads (resolve, fetch, history) run over the list. The per-registry and per-RPC budgets from PR #40 stay as they are, per entry.
- **The newest registry holding a vault ID is authoritative.** This generalises "v2 is authoritative" (harden-gas-sponsorship D9). Every copy from an older registry is checked against the newer registries' agreed event history: it can be OUTDATED, UNMATCHED or UNVERIFIABLE, as today. If a newer registry's history can't be confirmed, no copy is called current, and copies from several registries are *contested*.
- **The latest deployment is always used.** Presets stay embedded in the tool, because the binary must work outside the repo. A parity test checks them against `contracts/deployments/<chainId>.json` in both directions. It reads the records with the same parser as `--deployment-file`, and it fails when a record lists a registry version the preset lacks. This change proposes a forward-compatible record key for v3 and later (`contracts.vaultRegistries`, design D5). It does not edit the records or `contracts/`.
- **Configurable without a code change:**
  - a repeatable `--registry ADDRESS[@DEPLOY_BLOCK][:vN[:abi=vK]]`, which adds a registry. An entry equal to a built-in one is that entry; any other is added beside the built-ins as an untrusted registry: it is read last and never makes a copy current (D10, after the security review). `--registries-only` uses only the given entries, and `--trust-custom-registries` opts in to ranking supplied entries by version;
  - `--deployment-file PATH`, which loads a `contracts/deployments/*.json` record or a saved `/release.json` and uses every registry in it;
  - `--registry-v2` and `--deploy-block-v2` stay as deprecated aliases, and so do `--registry ADDRESS` without a version and `--deploy-block`;
  - every address and block is validated. A missing deploy block means a search from block 0, with a warning, as today;
  - the startup summary lists every registry in use, with its source, before any network contact.
- **Unknown versions are refused, never guessed.** The tool knows the v1 and v2 ABIs. A version above 2 is accepted only when its ABI kind is known: given with `:abi=vK`, or from a deployment record whose `abiHash` equals a known ABI's hash, byte for byte. Otherwise the tool exits with "this tool doesn't know registry vN; update cryoshield-recover".

**Out of scope:**
- any change to the contracts, ABIs or deployment records (`contracts/`). The record key is a proposal for the contracts engineer;
- the web app. It reads `config.registryV1`/`config.registryV2` with a `'v1' | 'v2'` type, so it is not generic. This change only reports that (design, "Web app");
- an on-chain registry directory, proxies or admin keys (excluded by the upgrade policy);
- fetching `/release.json` over the network. `--deployment-file` reads a file the user saved, and the tool never contacts a CryoShield host;
- the vault format, vault-crypto and the payload codec.

**Runtime dependencies:** none added. The tool still talks only to the public RPCs and Arweave gateways it prints at startup. There is no CryoShield-operated backend, and no CryoShield URL is needed.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `vault-recovery`: adds requirements for an ordered list of registry versions, the newest-holder authority rule, preset parity with deployment records, configuration flags and deployment files, refusal of unknown versions, and a registry startup summary. `vault-recovery` is not yet in `openspec/specs/`. It is defined by the in-flight `add-desktop-recovery-tool` change, extended by `harden-recovery-network-trust`, and its v1 + v2 behaviour comes from `harden-gas-sponsorship`. So these are ADDED requirements with new names; they supersede the two-registry wording of "Built-in defaults with overrides" and of D9's "Same id in both registries" for the recovery tool.

## Impact

- **`tools/recover`:**
  - `config.py` (`RegistrySpec`, presets as lists, flag grammar);
  - a new `deployments.py` (the record and release-file parser);
  - `chain.py` (`Registries` over N registries, the generalised authority rule);
  - `recover.py` and `cli.py` (flags, aliases, startup summary);
  - the tests (a fake v3 registry with v2's ABI, the parity test, CLI tests; the anvil v1 + v2 e2e is unchanged in substance);
  - `README.md`.
- **Behavioural changes:**
  - `--deploy-block` or `--deploy-block-v2` without a matching registry in the final list is now a usage error, not a silent no-op;
  - `--registry ADDRESS` without `:vN` keeps its old meaning (v1), with a note, unless the address is a known entry's.
- **Follow-ups for others (not done here):**
  - contracts: adopt `contracts.vaultRegistries` for v3 and later in `deploy.sh`, `deployments/README.md` and the deployment-targets spec;
  - deploy: add `config.registries` to `/release.json`;
  - web: read a registry list.
