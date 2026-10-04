# cryoshield-recover

Unlock your CryoShield vault with **only your hardware key**, even if the CryoShield website and company no longer exist.

The tool works in four steps:
1. It asks your FIDO2 security key (e.g. a YubiKey 5) for the vault's secret-derivation value, using CTAP2 `hmac-secret` with your PIN.
2. It finds your encrypted vault on public blockchain servers (OP Sepolia by default during the test phase; see "Networks" below). If those can't be reached, it looks in the Arweave permanent archive.
3. It decrypts the vault on your computer.
4. It shows the secret only after you type `show`.

Nothing is ever sent anywhere except read-only lookups. No CryoShield server is involved.

- Vault format: [`docs/spec/vault-format-v1.md`](../../docs/spec/vault-format-v1.md)
- Test vectors: [`packages/vault-crypto/test-vectors/v1.json`](../../packages/vault-crypto/test-vectors/v1.json)

## Install

You need Python 3.10 or newer, or a single-file binary from the releases page.

```sh
# with uv (recommended): run without installing
uvx cryoshield-recover --version
# from the source repository instead of PyPI
uvx --from "git+https://github.com/<org>/cryoshield#subdirectory=tools/recover" cryoshield-recover --version
# with pipx
pipx install cryoshield-recover
# NFC readers (PC/SC) need the optional extra
pipx install "cryoshield-recover[nfc]"
```

**Dependency pinning.** `pipx` and `uvx` resolve dependencies themselves. They do **not** use this project's `uv.lock`, so they install the newest `fido2` and `cryptography` releases allowed by `pyproject.toml`.

For the exact, hash-checked dependency set, use one of:
- the single-file binary (built from `uv.lock`, see "Verifying a download");
- a clone of the tagged source, with `uv sync --frozen && uv run cryoshield-recover`.

**NFC.** The single-file binaries support **USB keys only**. For NFC readers (PC/SC), install with pipx and the `[nfc]` extra, as shown above.

## Use

Plug in your key (or put it on the NFC reader) and run:

```sh
cryoshield-recover
```

The tool lists the public servers it will contact. It then asks you to touch the key and enter its PIN, finds the vault, and asks you to type `show` before it prints anything. Anything other than `show` exits without displaying the secret.

### Other ways in

```sh
# Your key has no discoverable credential, but you wrote down the vault ID:
cryoshield-recover --vault-id 0x1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c5b6a7988
# You know the credential ID (hex or base64url):
cryoshield-recover --credential-id qEfv7-8OVCjN2K3o-4j-1mFD5f9wyS-1_k1XjHAIhmc
# Fully offline, from a saved copy of the encrypted vault (its vault ID is required, see below):
cryoshield-recover --blob-file my-vault.bin --vault-id 0x1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c5b6a7988 --offline
# Write the secret to a new file (permissions 0600) instead of the screen:
cryoshield-recover --output secret.txt
# Save the encrypted vault for future offline recovery (it is useless without your key):
cryoshield-recover --save-blob my-vault.bin
# Use your own node, or pick a network explicitly:
cryoshield-recover --rpc https://my-node.example/rpc
cryoshield-recover --testnet
cryoshield-recover --network op-mainnet
cryoshield-recover --chain-id 10
# Override the built-in contract address or site name:
cryoshield-recover --registry 0x0000000000000000000000000000000000000001 --rp-id cryoshield.app
```

Run `cryoshield-recover --help` for every option.

### Why the vault ID matters

Every vault is cryptographically bound to the **vault ID** it is registered under (vault-format-v1 §4.1). The ID is not stored inside the encrypted blob; the tool always takes it from where it found the blob:
- for a copy read from the blockchain, the registry's vault ID;
- for an Arweave copy, its `CryoShield-Vault-Id` tag;
- for a saved file, `--vault-id`.

So anyone can copy your public blob into their own vault, but that copy never decrypts. The tool ignores it, and can never be tricked into showing a stale or attacker-held clone.

The tool prints the vault ID after every unlock. Keep it together with any `--save-blob` file, because offline recovery from a file needs both.

### Networks

| Preset | Chain ID | Built-in public RPCs |
|---|---|---|
| `op-sepolia` (**default**, also `--testnet`) | 11155420 | sepolia.optimism.io, optimism-sepolia-rpc.publicnode.com, optimism-sepolia.drpc.org |
| `op-mainnet` | 10 | mainnet.optimism.io, optimism-rpc.publicnode.com, optimism.drpc.org |
| `arbitrum-one` | 42161 | arb1.arbitrum.io, arbitrum-one-rpc.publicnode.com, arbitrum.drpc.org |
| `arbitrum-sepolia` | 421614 | sepolia-rollup.arbitrum.io, arbitrum-sepolia-rpc.publicnode.com, arbitrum-sepolia.drpc.org |
| `anvil` | 31337 | 127.0.0.1:8545 (local development) |

The mainnet chain (Arbitrum One or OP Mainnet) is not decided yet.

**How the network is chosen,** first match wins:
1. `--network <preset>`;
2. `--testnet` (meaning `op-sepolia`);
3. `--chain-id` matching a preset;
4. the built-in default, `op-sepolia`.

**Overrides:**
- `--rpc` replaces the RPC list but keeps the preset's chain ID. These endpoints are labelled "user-supplied", and an RPC on a different chain is refused, with a hint.
- `--chain-id` together with `--network` or `--testnet` must match that preset's chain ID; otherwise the tool exits with a usage error. A preset's built-in registry is never used on another chain.
- **Custom chains:** a `--chain-id` that matches no preset needs `--rpc`, and should come with `--registry`. Such a chain never gets a built-in registry address.

**Built-in registry addresses** come from the project's deployment records at release time; the tool never reads files at runtime. If a network has no deployment in this release, blockchain lookup is off: the tool says so and points you to `--registry` and `--deploy-block`.

### Shamir (M-of-N) vaults

If the vault needs several keys, the tool asks for them one at a time: "Remove the current key and insert another one." It tells you if you insert a key it has already used.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | done; also returned when you chose not to show the secret |
| 2 | bad command-line usage |
| 3 | no security key found |
| 4 | PIN problem: too many wrong attempts, or the PIN is blocked |
| 5 | the key has no matching CryoShield credential |
| 6 | no blockchain or Arweave server could be reached |
| 7 | no vault unlocked with this key |
| 8 | unsupported key: no hmac-secret, no PIN, or no user verification |
| 9 | the secret was not output: not a terminal and no `--output`, or the output file already exists |
| 10 | unexpected internal error |
| 11 | cancelled |
| 12 | ambiguous: different copies of your vault decrypt, and the servers disagree about which is current (non-interactive runs only; interactively you are asked to choose) |

## Troubleshooting

- **Linux: key not detected.** Your user needs access to `/dev/hidraw*`. Install your distribution's `libfido2` or `yubikey-manager` package, which ships udev rules (`70-u2f.rules`), or add the [Yubico udev rules](https://github.com/Yubico/libfido2/blob/main/udev/70-u2f.rules). Then unplug and replug the key.
- **Windows.** Windows only lets administrators talk to security keys directly. As a normal user, the tool uses the Windows security-key dialog (`webauthn.dll`) instead, and Windows asks for your PIN itself.
- **"did not verify your PIN" / exit 8.** CryoShield vaults are bound to PIN-verified use of the key: with and without a PIN, a key produces different secrets. Set the same PIN you used when creating the vault.
- **Older YubiKeys.** Firmware below 5.2 has no `hmac-secret` and cannot be used.

## Privacy

- The public RPC and Arweave servers see your vault **locator**, a public lookup value, and your IP address. So they can tell that someone is looking up that vault.
- They never see your PIN, the key's secret output, any decryption key, or your secret.
- To hide your IP, use `--rpc` with your own node, or set `HTTPS_PROXY` to a proxy you trust (for example Tor's HTTP tunnel).

## Security notes

- The encrypted blob is public on purpose. Without your key it is useless.
- Junk vaults filed under your locator by others are ignored automatically.
- Secrets are kept in memory only and overwritten after use. Core dumps are disabled.
- Python cannot guarantee that no copy survives in memory, so close the terminal when you are done.
- The tool never writes your secret to disk unless you pass `--output`. It never overwrites an existing file.

## How the tool decides which copy is current

Public servers are untrusted, and a lying or stale server can serve an *older* genuine copy of your vault, which still decrypts. The tool therefore labels a copy **current** only when:
- at least two different blockchain servers (or the only one you configured) return exactly that copy, and no server returns a different one; or
- it matches the latest on-chain update record that several servers agree on.

Versions reported by a server are never trusted for ranking. If servers disagree and the chain can't settle it, the tool prefers the copy more servers returned and warns you. On an exact tie it asks you to choose, showing only where each copy came from (never the secret). In a non-interactive run it stops with exit code 12.

Every Arweave search server's answer is kept separately, so one bad server cannot hide the genuine mirror. Searches are paged and time-bounded, and claimed sizes are ignored; downloads are capped at 1 KB anyway.

**Expected when the blockchain is unreachable:** Arweave mirrors can't be ordered reliably, because heights and tags come from the search servers. So:
- if two or more different mirrored versions of your vault decrypt, the tool asks you to choose;
- if a search was cut short by its budget, it asks you to confirm the copy;
- in a non-interactive run, it stops with exit code 12.

This is normal, not an attack. Retry when the chain is reachable to get a verified answer.

## Memory-wiping limits

The tool overwrites the buffers it controls as soon as they are no longer needed: PRF outputs, wrapping keys, data keys, Shamir shares, and the decrypted secret. This is best effort, and these copies are known to escape it:

- **Your PIN.** `getpass` returns an immutable Python string. python-fido2 hashes it and keeps it inside its own objects. Neither can be wiped.
- **Library copies.** python-fido2 returns the PRF output as immutable `bytes`, and `cryptography`'s AES-GCM takes and returns immutable `bytes`. The tool copies these into wipeable buffers, but the originals stay in memory until the garbage collector reuses it.
- **Display.** Printing the secret creates a decoded `str`, plus copies in the terminal and its scrollback. Writing to `--output` puts the secret on disk, and the file is never shredded.
- **Shamir shares.** Combining shares uses slices of the unwrapped buffers, which are short-lived copies the tool does not wipe individually.
- **The operating system.** Memory can be swapped to disk or captured in hibernation images. Core dumps are disabled, but swap and hibernation are not.

To limit exposure, recover on a computer you trust, close the terminal afterwards, and reboot if you are worried about memory forensics.

## Verifying a download

Each release lists the SHA-256 of every binary. Compare it before running:

```sh
shasum -a 256 cryoshield-recover        # macOS / Linux
certutil -hashfile cryoshield-recover.exe SHA256   # Windows
```

You can rebuild the Linux binary yourself from the tagged source:
- `scripts/build-binary.sh --docker` builds it in a base image pinned by digest, with hash-checked `uv`, a pinned `binutils`, and every Python dependency from `uv.lock`;
- `scripts/build-binary.sh --docker --check` builds twice and compares the hashes.

Binaries are not code-signed yet.

## Reimplementing

To build your own recovery tool, follow the spec and pass every case in the test vectors. This tool is an independent second implementation of the format. It shares no code with the TypeScript library and is cross-checked only through those vectors.

## Development

```sh
uv sync
uv run pytest                  # unit, vector, property, fake-network, software-CTAP and anvil tests
uv run pytest -m hardware      # with a real YubiKey (see docs/manual-yubikey-test.md)
uv run ruff check src tests && uv run mypy
```

The anvil end-to-end test (`tests/test_anvil_e2e.py`) runs automatically when Foundry (`anvil` and `forge`) is installed. It works as follows:
1. Deploys the real `VaultRegistry`.
2. Stores a vector vault behind a squatter's junk entry.
3. Recovers the vault with the real CLI. The real python-fido2 client talks to a software CTAP2 authenticator (`tests/support/soft_ctap.py`) that returns the vector PRF output, and only when it receives exactly the spec's `ctapSalt`.
