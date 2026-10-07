# Design

## Context

See proposal.md for motivation and `specs/vault-recovery/spec.md` for requirements. Current state:

- The repo has no code yet. Two sibling changes are still in flight:
  - `add-vault-crypto-core` defines blob format v1, single-input PRF derivation, and `test-vectors/v1.json`, which is being produced now.
  - `add-vault-registry-contract` defines the `VaultRegistry` with `resolveLocator(bytes32) → bytes32[]`, `getVault(bytes32) → (owner, blob, version)`, and the `VaultCreated`/`VaultUpdated` events carrying `keccak256(blob)`.
- The durability-layer change (Arweave mirror) does not exist yet. This change defines the Arweave tags the tool will search for, and that change must adopt them.

Library facts this design relies on, verified Oct 2026:

- python-fido2 2.x (latest 2.2.1, released 2026-06-29) requires Python ≥ 3.10.
  - `Fido2Client` takes a `ClientDataCollector` (`DefaultClientDataCollector(origin)`) and a list of `Ctap2Extension`s. `HmacSecretExtension` must be enabled explicitly.
  - Its `prf` input is converted to the CTAP salt with `sha256(b"WebAuthn PRF\0" + input)`, the same mapping as in the vault-crypto spec.
  - `prf.eval` works without an allow list. Only `evalByCredential` requires one.
  - A PIN/UV protocol is required for the extension to be processed.
  - `get_assertion` returns an `AssertionSelection`. Extension outputs are computed per response from the same ceremony and PIN token, so several discoverable credentials need one tap.
  - `UserInteraction.request_pin` supplies the PIN.
  - NFC goes through PC/SC (`pyscard`).
- CTAP2 hmac-secret has two secrets per credential, CredRandomWithUV and CredRandomWithoutUV. The output differs depending on whether UV was performed (see D3).
- Arweave GraphQL endpoints:
  - `https://arweave.net/graphql`
  - `https://arweave-search.goldsky.com/graphql`

  Data is served at `https://<gateway>/<txid>`.
- Arbitrum One (chain ID 42161) public RPCs:
  - `https://arb1.arbitrum.io/rpc` (official, rate-limited)
  - `https://arbitrum-one-rpc.publicnode.com`
  - `https://arbitrum.drpc.org`

## Goals / Non-Goals

**Goals:**
- A second, independent implementation of format v1 that shares no code with the TypeScript library. It is cross-checked only through the vectors.
- At most two runtime dependencies for the core path (`fido2`, `cryptography`). The JSON-RPC client, ABI codec, and GraphQL client are built on the standard library (`urllib`, `json`).
- Pure, I/O-free core modules (format, derive, select) that can be unit-tested without hardware or network. Hardware and network sit behind small interfaces with fakes for tests.

**Non-Goals:**
- Any write path, wallet, or signing.
- Supporting non-FIDO2 or non-hmac-secret authenticators.
- Caching vault data on disk (the user may save a blob explicitly with `--save-blob`).

## Decisions

### D1. Package layout (`tools/recover/src/cryoshield_recover/`)
- `format.py`: decode v1, with bounds checks (the §5.1 check order and error codes).
- `derive.py`: CTAP salt, locator, wrap key.
- `vault.py`: unwrap, payload, padding, `open_vault`, and `select_vault` (§6.5, §8).
- `authdata.py`: UV-flag check on authenticator data (`USER_NOT_VERIFIED`, §3.1).
- `shamir.py`: GF(2^8) combine only.
- `candidates.py`: candidate sources, freshness classes, and ranking.
- `secure.py`: buffer wiping and core-dump disabling.
- `net.py`: urllib with no redirects, HTTPS only (except loopback), timeouts, and byte caps.
- `keccak.py`: see D6.
- `abi.py`: minimal codec for `bytes32`, `bytes32[]`, and `(address, bytes, uint32)`.
- `rpc.py`: JSON-RPC over `urllib` with timeouts and size caps.
- `chain.py`: registry calls, union across RPCs, chain-ID check, event logs.
- `arweave.py`: GraphQL query and capped data fetch.
- `authenticator.py`: python-fido2 wrapper behind a `PrfSource` protocol.
- `ui.py`: prompts, confirmation, messages, exit codes.
- `config.py`: baked-in defaults and flag parsing.
- `recover.py`: the orchestrator (flows of D4, D5, D7).
- `cli.py`: `argparse` entry point.

The vault *writer* used to check the create/addKey/update vectors lives only in `tests/support/writer.py`; it is not shipped.

*Alternative rejected:* `web3.py` and `eth-abi`. They are a large dependency tree for two `eth_call`s and one `eth_getLogs`, and they make reproducible builds harder.

### D2. PRF via python-fido2's `prf` extension, with the salt asserted
- Use `Fido2Client(device, DefaultClientDataCollector("https://" + rp_id), extensions=[HmacSecretExtension()], user_interaction=...)`, using the `prf` path only.
- Request `extensions={"prf": {"eval": {"first": SHA-256("cryoshield/v1/locator-salt")}}}`.
- The library applies the WebAuthn→CTAP salt mapping. A unit test pins that mapping against the vectors' CTAP-salt field and against python-fido2's `_prf_salt`, so a library change can't silently diverge.
- *Alternative rejected:* raw `hmacGetSecret` with our own salt. It is equivalent but duplicates the mapping.
- A software CTAP2 authenticator in the tests (PIN protocol 1 + hmac-secret) sits below the real python-fido2 client and returns the vector PRF output only for the exact `ctapSalt`. This proves end to end, without hardware, that the salt actually sent is the spec's.
- Windows: non-admin processes cannot open FIDO HID devices directly, so on Windows the tool uses python-fido2's `WindowsClient` (webauthn.dll) with the same `prf` input. The OS supplies the PIN UI.

### D3. Always perform user verification (adopted upstream in vault-format-v1 §3.1)
hmac-secret returns a different output with and without UV. The tool always sets `user_verification="required"`, which makes the YubiKey use CredRandomWithUV.

The browser must therefore do the same. This was requested from the crypto engineer and adopted:
- vault-format-v1 §3.1 requires `userVerification: "required"`;
- clients must check the UV flag in the authenticator data and fail with `USER_NOT_VERIFIED` (pinned by `authenticatorDataCases`).

The tool applies the same check to every assertion. There is no `--uv` override: an output obtained without UV can never open a vault.

Discoverable-credential creation on YubiKey already requires a PIN, so this costs users nothing extra.

### D4. Discoverable credentials answer the chicken-and-egg problem
Default flow:
1. One `get_assertion(rp_id, allow_credentials=[], prf.eval)`.
2. For each response in the `AssertionSelection`, read the PRF output and the credential ID, then derive the locator.
3. Look up all locators.

Explicit fallbacks, for keys whose credentials are not resident or were created by a future non-discoverable flow:
- `--vault-id <hex>`: `getVault` (or Arweave tag `CryoShield-Vault-Id`), then use the blob's credential IDs and RP ID as the allow list.
- `--credential-id <b64url|hex>`: use it as the allow list, then derive the locator and look up.
- `--blob-file <path> --vault-id <id>`: read locally, then use its credential IDs (fully offline with `--offline`). The vault ID is mandatory, because blobs are bound to it (vault-format-v1 §4.1, from `bind-vault-id-to-ciphertext`).

The blob always records credential IDs, so the vault ID or a saved blob is enough. The web app should show and offer to save the vault ID and blob (a web-app request, non-blocking).

### D5. Lookup strategy and trust model
- RPCs are untrusted.
  - Query every configured RPC in parallel, with a 10 s timeout, a 64 KB response cap, and at least two successful RPCs preferred.
  - Verify `eth_chainId`, then take the union of `resolveLocator` results and fetch each distinct `vaultId` once.
  - A lying RPC can only add junk, which AES-GCM rejects, or withhold. The union plus Arweave defeats withholding unless every source colludes.
- Arweave GraphQL is untrusted in the same way:
  - Query `transactions(tags:[{name:"App-Name",values:["CryoShield"]},{name:"CryoShield-Locator",values:[<hex>]}], first: 50, sort: HEIGHT_DESC)`.
  - Read the `data.size` field first and skip anything over 1024 bytes.
  - Fetch the data with a hard 1024-byte read cap.
- Event hashes:
  - `eth_getLogs` on the registry, filtered by event topic and an indexed `vaultId`, from the deployment block.
  - Public RPCs cap block ranges, so the tool pages in chunks and treats failure as "unverifiable", never as an error.
  - **Request to the solidity engineer:** make `vaultId` an `indexed` event parameter in `VaultCreated`, `VaultUpdated`, and the locator-added event, and publish the deployment block number with the address.
- Arweave tag schema, which the durability change must adopt:
  - `App-Name: CryoShield`
  - `CryoShield-Format: 1`
  - `CryoShield-Vault-Id: 0x<64 hex>`
  - `CryoShield-Locator: 0x<64 hex>` (one tag per locator)
  - `CryoShield-Version: <uint>`
  - All hex is lowercase and 0x-prefixed.

### D6. Keccak-256 implemented in-tree
- `cryptography` and `hashlib` provide only NIST SHA3, whose padding differs from Keccak, so the tool needs its own Keccak-256.
- It is used only for event-hash comparison and selector constants: integrity, not secrecy.
- The implementation is a small, pure-Python Keccak-f[1600] (about 80 lines), tested against published Keccak-256 vectors (empty string, `"abc"`, and the selectors `resolveLocator(bytes32)` and `getVault(bytes32)` cross-checked against the Foundry ABI).
- *Alternative rejected:* `pycryptodome`. It is a third crypto dependency with C extensions, for a non-secret hash.

### D7. Independent Shamir combine
- Implement Lagrange interpolation at x = 0 over GF(2^8), reconstruction only.
- The field polynomial and share byte layout are taken from the `vault-crypto` spec and vectors (the 1-byte x plus 32 bytes from that spec).
- No Python library is known to match the `shamir-secret-sharing` (Privy) encoding.
- Constant-time behaviour is not a goal: it runs once, locally, on the user's machine.

### D8. Defaults and release pinning

> **Superseded by `target-op-sepolia` (design D2):** there are per-chain presets (anvil, op-sepolia, op-mainnet, arbitrum-sepolia, arbitrum-one), `DEFAULT_NETWORK = "op-sepolia"`, and `--testnet` means op-sepolia. The selection order is `--network` > `--testnet` > `--chain-id` matching a preset > the default. Security review (target-op-sepolia): `--network`/`--testnet` with a conflicting `--chain-id` is a usage error, so a preset's registry is never used on another chain. A non-preset `--chain-id` is a `custom` network: it requires `--rpc`, carries no built-in registry, and its endpoints are labelled user-supplied. A preset without an embedded deployment record refuses chain mode with a clear message. The text below describes the original Arbitrum-only plan.
- `config.py` bakes in:
  - RP ID: the production RP ID from the web-app change (placeholder `cryoshield.app` until decided);
  - chain ID 42161;
  - the registry address and deployment block, filled at release from `contracts/` deployment output and guarded by a test that fails if they are still placeholders in a release build;
  - three RPCs and two Arweave endpoints.
- Every value has a flag. `--testnet` switches to an Arbitrum Sepolia preset.

### D9. Terminal UX
- A step-by-step narrative: "Insert your key", "Touch your key now", PIN prompt with `getpass`, "Looking up your vault on 3 public servers…".
- Confirmation is typed (`show`), not y/N.
- Plaintext is decoded as UTF-8 if valid, otherwise shown as hex.
- `--output` writes the file with `os.open(O_CREAT|O_EXCL, 0o600)`.
- Exit codes are documented in the README.
- The UI is plain text (no curses), so it works over SSH and in recovery shells.

### D10. Distribution
- `pyproject.toml` (hatchling) defines `[project.scripts] cryoshield-recover = "cryoshield_recover.cli:main"`, and `uv.lock` is committed with hashes.
- Users install with `pipx install cryoshield-recover` or `uvx cryoshield-recover`, or from git with `uvx --from git+https://…#subdirectory=tools/recover`.
- Single-file builds use PyInstaller `--onefile`, with:
  - `SOURCE_DATE_EPOCH` set and `PYTHONHASHSEED=0`;
  - a pinned PyInstaller and pinned Python;
  - `uv sync --frozen` (dependencies installed only from the hash-locked lockfile);
  - built inside a pinned container image on Linux.
- CI builds twice and compares SHA-256. macOS and Windows reproducibility is best effort and documented if unattainable.
- Signing and notarization are out of scope. Checksums are published.
- *Alternative rejected:* Nuitka. Its reproducibility is less established, and its build chain is heavier.

### D11. Testing strategy
- Core modules are tested with pytest against `v1.json`, which is loaded from `packages/vault-crypto/test-vectors/v1.json` with a pinned SHA-256.
- Property tests use `hypothesis`, a dev dependency only: the decoder never raises anything but typed errors, and the ABI decoder is total.
- `FakePrfSource` returns vector PRF outputs keyed by credential ID.
- `FakeRpc` and `FakeArweave` are in-process HTTP servers on localhost, so `urllib` paths are exercised for real.
- Hardware tests are marked `@pytest.mark.hardware` and skipped by default. One of them is the manual "web-created vault on Arbitrum Sepolia, website offline" end-to-end test.

## Threat / Abuse Considerations

- **Malicious RPC or gateway:** it can withhold candidates, inject junk, or send oversized or malformed responses.
  - Mitigations: union across sources, chain-ID check, hard size caps, total ABI decoder, AES-GCM authentication. Junk never yields plaintext.
  - Residual risk: a DoS if every source withholds. The user can then supply `--rpc` for their own node or use `--blob-file`.
- **Rollback (an old authenticated blob served as current):** an old blob authenticates because it is genuine.
  - Mitigations: prefer on-chain `getVault` (current state), check Arweave against event hashes, and warn "outdated" or "unverifiable".
  - Residual risk: offline or Arweave-only recovery may show an older version, and the tool says so.
- **Phishing fork of the tool:** an attacker distributes a modified binary that exfiltrates the PRF output.
  - Mitigations: reproducible builds, published checksums, PyPI trusted publishing from CI, and README verification steps. Signing is out of scope (accepted risk).
- **RP ID confusion:** a user could pass `--rp-id` for a malicious RP. This only changes which credential is used locally and cannot leak anything off-device. The blob's RP ID wins when known.
- **PRF output exposure in memory:** Python cannot guarantee zeroization (immutable `bytes` copies inside python-fido2 and `cryptography`).
  - Mitigations: keep our copies in `bytearray`s, overwrite them, drop references, disable core dumps (`resource.setrlimit(RLIMIT_CORE, 0)` on POSIX), and never log.
  - Residual risk: documented as best effort.
- **Shoulder-surfing and terminal scrollback:** typed confirmation, a warning to clear scrollback, and an `--output` file alternative.
- **Dependency compromise:** only two runtime dependencies, hash-locked, with versions pinned in `uv.lock` and reviewed in the security review.
- **Error oracles:** these are irrelevant because everything is local, but the tool still reports only "no matching vault", not per-candidate reasons, to keep output clean.
- **Network privacy:** RPC and Arweave providers see the locator, and so learn that someone is recovering that vault from that IP. This is documented. `--rpc` can point to the user's own node or a Tor-routed endpoint (via `HTTPS_PROXY`).

- **Vault cloning** (from the web-app review; fixed by `bind-vault-id-to-ciphertext`):
  - Anyone can copy a public blob into their own vault ID, with its own consistent events, so the latest-event-hash check alone could show a stale or attacker-held clone.
  - Blobs are now bound to their vault ID through both AADs. The tool opens each candidate only under the vault ID it was found under: the registry key, the exact Arweave tag, or `--vault-id` for files.
  - Untagged copies are ignored.
  - Candidates are deduplicated by (vault ID, blob). Deduplicating by blob alone would let a clone listed first displace the genuine copy; a regression test caught exactly that.
- **Review round 1 hardening:**
  - **Hostile parse inputs.** Deep nesting, non-finite numbers and oversized integers can't escape the network layer; each source is contained individually.
  - **Rollback by one RPC.** Disagreeing copies are reconciled against an event history that several RPCs agree on, or flagged as unverifiable with the higher version preferred.
  - **Terminal injection.** All status output is sanitized.
  - **RP ID redirection through `--vault-id`.** The configured RP ID is tried first, then on-chain, file, and Arweave, capped at 3.
  - **Slow-drip servers.** A whole-request deadline stops them.
  - **Build inputs.** These are pinned by digest or hash.
  - **Residual risk.** If every RPC lies consistently about both state and history, the user can be shown an older genuine version. The countermeasures are `--rpc` with a trusted node, and the L1 anchor (future).

## Risks / Trade-offs

- [A vault was created by a client that ignored the UV rule (D3)] → The tool cannot open it, and no flag can help. Mitigated upstream by the spec's mandatory UV-flag check in the web app.
- [Vectors change while being produced in parallel] → The SHA-256 pin makes changes deliberate. The vector-runner tasks start only after the crypto engineer marks v1.json stable.
- [Public RPC rate limits or `eth_getLogs` range limits] → Several RPCs, paged log queries, and graceful "unverifiable".
- [Arweave tag schema not adopted by the durability change] → The fallback finds nothing, so the tag schema is a coordination item in the proposal impact.
- [Windows WebAuthn API differences (PRF support depends on the Windows build)] → Use the `WindowsClient` path, list it in the compatibility matrix, and recommend Linux or macOS in the docs if unsupported.
- [PyInstaller output isn't bit-reproducible on macOS or Windows] → Guaranteed on Linux, best effort elsewhere, documented.
- [Placeholder registry address shipped] → A release-build test fails on placeholders.

## Dependencies on sibling changes (requests)

1. **vault-crypto (crypto engineer), all resolved:**
   - `userVerification: "required"` is mandated, and the UV-flag check pins it;
   - the GF(2^8) polynomial 0x11B and the `x || y` share layout are specified;
   - `ctapSalt` and `credId` are in v1.json;
   - error codes are named.

   The tool pins v1.json by SHA-256.
2. **vault-registry (solidity engineer), resolved:**
   - `vaultId` is indexed in all events;
   - the ABI JSON and `deployments/<chainId>.json` (`address`, `deployBlock`, `abiHash`) are published.

   Still needed: Arbitrum One and Sepolia deployment records, to fill in D8 at release.
3. **Durability layer (future):** adopt the Arweave tag schema in D5.
4. **Web app (future, non-blocking):** let the user view and save the vault ID and blob file, and use the production RP ID baked into D8.

## Migration Plan

This is a new tool, so there is nothing to migrate.

1. Release to PyPI and GitHub releases, with single-file binaries and checksums, after the security-review task.
2. The tool's v1 decoding must be maintained for as long as v1 vaults exist.

Rollback: yank the release. Previously downloaded binaries keep working because they depend on no CryoShield service.

## Open Questions

- Final production RP ID and registry address: filled in at release (D8). This doesn't change the design.
