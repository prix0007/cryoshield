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
uvx --from "git+https://github.com/prix0007/cryoshield#subdirectory=tools/recover" cryoshield-recover --version
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

The tool lists the public servers it will contact. It then asks you to touch the key and enter its PIN, and finds every vault the key opens. It asks you to type `show` before it prints any secret. Anything other than `show` exits without displaying it.

### Several vaults, names and archived vaults

One key can open several vaults (one per vault you created with it).
- **Where the tool looks.** It searches the blockchain *and* the Arweave archive every time, and merges what it finds, so the list shows every vault the key opens. A verified blockchain copy is still preferred. If a source can't be reached or its search is cut short, the tool warns that the list may be incomplete.
- **Choosing a vault.** When the key opens more than one, the tool lists them. Each line starts with the status in a fixed column (`[ACTIVE  ]`, `[ARCHIVED]`, `[LOCKED  ]` for a vault that needs more keys), then the vault ID, the item count, how many keys it needs, whether its copy is confirmed current, and where that copy came from (a built-in registry, a SUPPLIED registry that is not built in, the Arweave archive or your file). "(may be outdated)" means a newer version may exist. `--list` shows the same "source:" line for each vault. The vault's name comes last, in quotes, so a name can never pass as a status. You pick one by number. Archived vaults are always listed.
- **Without a terminal.** With `--output` in a script, the tool can't ask. It stops with exit code 12 and prints only each vault's ID and freshness. Pass `--vault-id <id>` for the one you want.
- **`--list`.** This lists every vault the key opens and exits with code 0. It prints IDs, status, item and key counts, freshness and names, but no item labels and no secret values. It works in a pipe, and refuses `--output` and `--save-blob`.
- **What is shown before `show`.** The vault's status and name, and up to 10 item labels (each cut to 24 characters, then "+N more"), may appear above the confirmation prompt, so you can check that it is the right vault. Secret values never appear before you type `show`.
- **How secrets are shown.** After `show`, the status and name come first, then each item as `label: secret`. A secret with several lines is printed below its label, every line starting with `  | `, so no line of a secret can look like the tool's own output (such as a fake "END SECRETS" line). Copy the text after the prefix, or use `--output` for the exact bytes.
- **Raw fallback.** A vault made by a newer version of CryoShield, or one whose contents aren't a list of items (for example an old plain-text secret), is printed as its raw text, with a note, every line starting with `| ` for the same reason. The tool never refuses to show you your own data.
- **Text made safe.** Names and labels are printed with control, format, bidi and line-separator characters (Unicode Cc, Cf, Zl, Zp) removed. Joiners (U+200C, U+200D) are kept, so emoji sequences stay intact. Long runs of combining marks are cut to 3. A name with nothing visible left shows as "Unnamed vault" (unquoted): this covers spaces, marks, joiners, and blank-looking characters such as U+3164 and U+2800. Secret values keep their line breaks and tabs. A backslash is shown as `\\`, and every other such character as a visible `\uXXXX` escape (`\udxxx` for an unpaired surrogate in an old vault), so the value is unambiguous and inert. When anything was escaped, a note says so; use `--output` for the exact bytes.
- **What `--output` writes.** It writes the vault's decrypted contents exactly as stored (the payload JSON), so nothing is lost.

The payload format is `docs/spec/payload-v2.md`. The tool's codec passes every shared vector in `docs/spec/payload-vectors.json`, and its tests pin that file by SHA-256.

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
# List every vault this key opens (no secrets), then open one by its ID:
cryoshield-recover --list
cryoshield-recover --vault-id 0x1111111111111111111111111111111111111111111111111111111111111111
# Save the encrypted vault for future offline recovery (it is useless without your key):
cryoshield-recover --save-blob my-vault.bin
# Use your own node, or pick a network explicitly:
cryoshield-recover --rpc https://my-node.example/rpc
cryoshield-recover --testnet
cryoshield-recover --network op-mainnet
cryoshield-recover --chain-id 10
# Add a newer registry version next to the built-in ones (see "Override registries" below):
cryoshield-recover --registry 0x0000000000000000000000000000000000000003@123:v3:abi=v2
# Override the site name:
cryoshield-recover --rp-id cryoshield.app
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
- **Custom chains:** a `--chain-id` that matches no preset needs `--rpc`, and should come with `--registry` or `--deployment-file`. Such a chain never gets a built-in registry address.
- `--deployment-file` selects the network by the file's chain ID (see below); with `--network`, `--testnet` or `--chain-id` the two must match.

**Built-in registries.** Each preset lists every VaultRegistry version deployed on its chain, newest first:

| Preset | Registries (newest first) |
|---|---|
| `op-sepolia` | v2 `0xa622c92d3d5b54aea081cf410224a8a2ecb08cb7` (from block 49755277), v1 `0xb43f58cf17e64b603ae5588a1dd17e96a0849e44` (from block 49568053) |
| `anvil` | v2 `0xa622…cb7` (block 2), v1 `0xb43f…9e44` (block 1) |
| `op-mainnet`, `arbitrum-one`, `arbitrum-sepolia` | none yet: blockchain lookup is off, and the tool says so |

They are copied from the project's deployment records (`contracts/deployments/<chainId>.json`) at release time; the tool never reads files at runtime unless you name one.

**Several registry versions.** Registries are immutable. A new version is a new contract deployed next to the old ones, and no admin can move or change it. New vaults are saved in the newest version, and vaults saved earlier stay where they were, readable forever. The tool reads every listed version, newest first, and treats what it finds as one list, so you never need to know where your vault is. A network may have only some of them (OP Mainnet has only v2). In v2 anyone can add entries to a key's lookup list, so the tool reads long lists in pages. Each registry has its own time limits for looking up the list and for reading the vaults, and no single server may use more than a share of either, so one slow, stuck or spamming server cannot stop the others from finding your vault. Entries reported by more servers are read first, then the oldest and newest entries of each list before the ones in the middle. If a list is so long that only part of it is read (the oldest and newest entries), the tool says so, and `--vault-id` always works.

### Override registries

You normally need none of this: the built-in list is the project's latest deployment. Use it when a newer registry exists than this release knows, or to point at your own deployment.

**`--registry ADDRESS[@DEPLOY_BLOCK][:vN[:abi=vK]]`** (repeatable):
- `ADDRESS` is the contract address (0x and 40 hex digits).
- `@DEPLOY_BLOCK` is the block it was deployed in. The tool searches update history from there. Without it, history is searched from block 0, which is slow and may fail on public servers; the tool warns.
- `:vN` is the registry version (`v1`, `v2`, `v3`, …). Without it, an address that matches a built-in entry keeps that entry's version, and any other address is read as **v1** (what `--registry` meant before versions), with a note.
- `:abi=vK` says which known read functions a newer version uses (`v1` or `v2`). The tool knows the v1 and v2 registries. For an unknown version without `abi=`, it stops with "this tool doesn't know registry vN; update cryoshield-recover" and contacts nothing. It never guesses.

**How a registry you supply is treated:**
- If its version and address equal a built-in entry's, it *is* that built-in entry. You may give a lower start block (it only searches more), but not a higher one: that could skip your vault's first records, so the tool refuses it.
- Any other registry is **added next to the built-in ones, never instead of them**. It is read *after* them, and it can never make a copy count as current. A copy found only there opens with a warning, and a copy in a built-in registry is always preferred. So a wrong address, for example one from a phishing message, cannot make the tool show you an older version of your secrets in place of the current one.
- **`--registries-only`** reads only the registries you supply (and warns about each built-in one left out).
- **`--trust-custom-registries`** lets supplied registries rank by version and vouch for a copy, as if they were built in. Use it only for a newer official deployment that this release doesn't know yet, with the address from the project's own deployment records. The tool prints a SECURITY warning.
- On a network with no built-in registry (for example OP Mainnet in this release), the registries you supply are all there is, so they are trusted, with the same warning.
- At most 4 supplied registries that differ from the built-ins per run.

```sh
# A v3 registry was deployed after this release; its read functions match v2's:
cryoshield-recover --registry 0x0000000000000000000000000000000000000003@123:v3:abi=v2
# Use only your own deployment of v2:
cryoshield-recover --registries-only --registry 0x0000000000000000000000000000000000000002@1:v2
```

**`--deployment-file PATH`** uses every registry in a saved file. The file is either:
- a deployment record from the source repository (`contracts/deployments/<chainId>.json`), or
- the web app's `/release.json` saved to disk.

The file's chain ID selects the network. Entries equal to the built-in ones count as built-in (no warning); any other entry is treated like a `--registry` you supplied. A newer version in a record is read only when its `abiHash` equals the v1 or v2 ABI's, byte for byte; otherwise the tool asks you to update it. The `abiHash` only tells the tool which read functions to use: it is **not checked against the contract on-chain**, and a wrong one just makes the reads fail or find nothing. `--registry` entries still apply on top. The file must be plain JSON under 1 MiB, with no repeated keys.

```text
cryoshield-recover --deployment-file ./11155420.json
cryoshield-recover --deployment-file ./release.json --registry 0x…@123:v3:abi=v2
```

**Deprecated, still working:** `--registry-v2 ADDRESS` (now `--registry ADDRESS:v2`), `--deploy-block-v2 N` and `--deploy-block N` (now `@N` on the entry for v2 or v1). Each prints the new form. Note that a `--registry-v2` address that differs from the built-in one is now read *next to* the built-in v2, as a supplied registry; it no longer replaces it (use `--registries-only` for that).

At startup the tool prints every registry it will read (built-in first, then supplied ones marked "(supplied)"), with its first block and where it came from (built-in, `--registry`, or the file's name). It prints a SECURITY note whenever a supplied registry differs from the built-in ones, and repeats it next to the result, and next to the `--output` and `--save-blob` messages, if your vault came from one.

**Time limits.** Each registry has its own time limits for looking up and reading vaults. The search of update records (event history) has **one 60-second limit shared by every registry** in the run. With several registries, that limit can run out: the tool then can't confirm which copy is current. It says so and asks you to choose when copies disagree; it never guesses. Retry with fewer registries or a faster `--rpc`.

### How a new registry version gets picked up

1. The project deploys the new registry next to the old ones and adds it to `contracts/deployments/<chainId>.json`. Until the contracts side decides otherwise, the proposed key is `contracts.vaultRegistries.v3`.
2. A test in this tool compares every preset with those records. It fails, printing the exact entry to add, until the preset lists the new version. So a release can't ship without the latest deployment.
3. A new release of this tool reads the new version by default.
4. Older releases can read it too, with `--registry ADDRESS@BLOCK:v3:abi=v2`, or with `--deployment-file` and the new record. The record needs no `abi=` when its `abiHash` shows the v2 ABI. Because such a release doesn't know the new registry, it treats it as supplied: the vault opens with a warning but is never called current. Add `--trust-custom-registries` only if the address comes from the project's records.

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
| 12 | ambiguous: the key opens several vaults and none was chosen with `--vault-id`, or different copies of your vault decrypt and the servers disagree about which is current (non-interactive runs only; interactively you are asked to choose) |

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

A vault ID found in several registry versions is settled by the **newest built-in registry that holds it** (registries you supply come after all built-in ones; see "Override registries"). Anyone can register any ID in v1, and a vault that moved to a newer registry leaves its old copy behind. So every copy from an older registry is checked against each newer registry's on-chain history, newest first, even when no copy could be read from the newer one:
- if a newer registry has a history for that ID, it decides: an older copy is shown as an older (or unmatched) copy, with a security warning;
- if a newer registry's history can't be confirmed, no copy of that vault is called current. When copies come from more than one registry, you are asked to choose;
- a copy a server claims is in a newer registry, while that registry's history shows no such vault, is ignored.

With today's v1 and v2, this is "v2 decides".

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
- **Vault contents.** The decrypted buffers of every vault found, chosen or not, are wiped, and they are parsed in place (never copied to `bytes`). But listing a vault (for `--list` and the chooser) parses its whole payload with Python's JSON parser, which creates strings for its labels **and its secret values**, even for vaults you don't open. They can't be wiped. A parser that skips the secret strings would be a second, hand-written JSON reader next to the one the shared vectors verify, so the tool doesn't use one.
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
