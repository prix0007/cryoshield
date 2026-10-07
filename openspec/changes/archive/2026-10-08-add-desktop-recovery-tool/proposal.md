# Proposal

## Why

CryoShield promises that a vault survives the company. Browser unlock depends on the CryoShield domain, because the PRF output is scoped to the RP ID and a web origin has to serve it. If the domain lapses, is hijacked, or the static site disappears, users need another way in that needs only their hardware key, a computer, and public infrastructure. This is PRD Phase 5 and the "Recovery without CryoShield: 100% of test vaults" success metric. It can run in parallel with the web app now that the vault format (`add-vault-crypto-core`) and the registry ABI (`add-vault-registry-contract`) are specified.

## What Changes

- Add an open-source Python (≥ 3.10) command-line tool, `cryoshield-recover`, in `tools/recover/`. It is managed with uv and tested with pytest.
- **Hardware-key access:** talk to the FIDO2 key directly over USB HID, or over NFC through PC/SC, using CTAP2 `hmac-secret`, with python-fido2. One tap evaluates the single global PRF input, using the CTAP salt mapping from the `vault-crypto` spec. The RP ID is baked in and can be overridden.
- **Keyless discovery:** with no other input, the tool asks the key for every discoverable credential for the RP ID. A single tap and PIN entry produce a PRF output for each of those credentials, and the tool derives one locator from each.
- **Fallback when credentials aren't discoverable:** the user supplies a `vaultId`, a credential ID, or a local blob file. The tool reads the blob first, then gets the credential IDs from it to build the allow list. This breaks the chicken-and-egg problem (credential IDs live inside the blob).
- **Chain read:** resolve locators and fetch blobs with `eth_call` to the registry's `resolveLocator` and `getVault`. The tool queries a built-in list of several public Arbitrum One RPCs, takes the union of the candidates they return, and checks the chain ID. The `--rpc` and `--registry` flags override the list and the address.
- **Arweave fallback:** when no RPC answers or no candidate authenticates, query Arweave GraphQL for transactions tagged `App-Name: CryoShield` and `CryoShield-Locator: <hex>`, then fetch each blob from a gateway. When a chain RPC is reachable, check each Arweave blob against the `keccak256` hash in the registry's `VaultCreated`/`VaultUpdated` events.
- **Decryption:** an independent Python implementation of vault format v1 that decodes, selects the authenticating candidate, and decrypts (mode 0x01 any-of-N, and mode 0x02 Shamir M-of-N with several taps). It must pass every case in `packages/vault-crypto/test-vectors/v1.json`.
- **Display:** a friendly terminal UX that prints secrets only after explicit confirmation, with an option to write them to a file with owner-only permissions instead.
- **Distribution:** install with `pipx`/`uvx` from PyPI or a git URL, plus reproducible single-file executables built with PyInstaller (Linux, macOS, Windows) from a hash-locked `uv.lock`, with published SHA-256 checksums.

**Out of scope:**
- Writing, updating, or re-keying vaults (no transactions, no wallet).
- Code signing and notarization of binaries.
- A GUI.
- Mobile platforms.
- Mirroring to Arweave or anchoring on L1 (durability-layer change). This tool only reads Arweave, and reads L1 anchors only if a later change defines them.
- Changes to the vault format, the contract, or the test vectors: those are owned by the sibling changes and only consumed here.
- Recovery when every enrolled key is lost (impossible by design).

**Runtime dependencies:**
- New Python dependencies: `fido2` (python-fido2 ≥ 2.0, by Yubico), `cryptography` (pyca), and optionally `pyscard` for NFC.
- New network dependencies at recovery time: public Arbitrum JSON-RPC endpoints and public Arweave gateways (GraphQL and data). Every endpoint is user-overridable, and nothing is contacted except these reads.
- **No CryoShield-operated backend is added or contacted.** The tool works with the CryoShield website and every CryoShield domain offline.

## Capabilities

### New Capabilities
- `vault-recovery`: independent, infrastructure-free recovery of a vault with only an enrolled hardware key. Covers key interaction (CTAP2 hmac-secret, discoverable and non-discoverable credentials), vault lookup from public chain RPCs with an Arweave fallback, integrity checks, decryption and candidate selection, safe secret display, configuration overrides, and reproducible distribution.

### Modified Capabilities
- None. This change consumes `vault-crypto` and `vault-registry` (both still in-flight changes) without changing their requirements. The cross-team spec requests are listed in design.md under "Dependencies on sibling changes."

## Impact

- **New code:** `tools/recover/` (Python package `cryoshield_recover`, tests, `pyproject.toml`, `uv.lock`, a PyInstaller spec, and a README).
- **Consumes:**
  - `packages/vault-crypto/test-vectors/v1.json` and `docs/spec/vault-format-v1.md`, read-only;
  - the registry ABI and deployed address from `contracts/`, read-only.
- **CI:** a new pytest job and a reproducible-build check (build twice, compare hashes).
- **Upstream asks (blocking parts of this change):**
  - the `vault-crypto` spec must mandate user verification for PRF ceremonies (see design D3);
  - the registry events need an indexed `vaultId`;
  - the durability-layer change must adopt the Arweave tag schema defined here.
