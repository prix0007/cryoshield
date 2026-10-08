# Design: The web app reads every registry version

## Context

- Policy (decided): registries are immutable and versioned; clients read every version; the newest registry holding a
  vault ID is authoritative (`recover-registry-versions` D2).
- Today (`main`): the app reads v2 then v1 and treats v2 as authoritative per vault ID (harden-gas-sponsorship D9); it
  writes only to v2. Record keys: top-level v1, `contracts.vaultRegistryV2`; proposed `contracts.vaultRegistries.v<N>`
  (`recover-registry-versions` D5, not yet adopted by contracts, follow-up 7.1).
- `/apps/web` `/app` initial JS budget has about 925 B of headroom (`scripts/verify-build.mjs`).

## Decisions

### D1. One registry-list parser, at build time

`vite-plugins/registries.mjs` (plain ESM with a `.d.mts`, so `release-manifest.mjs` can import it without a TS step):
`registryList(record, where, abiHashes)` returns `[{version: 'vN', n, abi: 1|2, address, deployBlock, txHash, abiHash,
key}]`, newest first.

- **Sources:** top-level `address` → v1; `contracts.vaultRegistryV<N>` → vN (v2 today); `contracts.vaultRegistries`
  (an object keyed `v<N>`) → vN. Keys and versions match `v[1-9][0-9]{0,2}` in full. The same version from two keys
  must be identical (address and deploy block), else the build fails. Two versions with one address fail.
- **ABI kinds (explicit, never guessed):** v1 is kind 1 and v2 is kind 2, and their `abiHash` must equal the hash of
  that kind's exported ABI (the existing drift check). For N ≥ 3 the kind is the one whose ABI hash equals the entry's
  `abiHash`; any other value (or none) fails the build: "The app doesn't know VaultRegistry vN (…); update the app".
- **Shape:** every address is `0x` + 40 hex, every `deployBlock` a safe integer ≥ 0, every entry an object. At least one
  registry, and the newest must be kind 2 (it takes every write).
- `deployment.ts` adds what needs viem: EIP-55 addresses, the hashes of the exported ABIs, the "the app's ABI fragments
  exist in the exported ABI" check per kind used, and "no v1 on OP Mainnet".
- Runtime config: `registries: [{version, abi, address, deployBlock}]`, newest first. `registryV1`/`registryV2` are
  removed. `src/config` exports `WRITE_REGISTRY` (the newest) and `isWritable(version)`.

*Alternative rejected:* a second parser in `release-manifest.mjs` (two parsers drift; one may accept what the other
refuses).

### D2. Reads: newest registry holding a vault ID wins

`createRegistryReader(transport, registries = config.registries)` walks the list newest first. For registry `i`:
1. resolve the locator (kind 2: `locatorLength` + 256-entry pages; kind 1: `resolveLocator`, capped at 16), and drop ids
   a newer registry already produced;
2. check the remaining ids against every newer registry `0 … i-1`, newest first (kind 2: `getVaults` in batches of 32;
   kind 1: `getVault`). An id a newer registry holds yields only that newer copy (under any locator);
3. fetch the rest from registry `i` itself.

Any error or inconsistency in a registry that is newer than another (every registry except the oldest) is
`RegistryUnconfirmedError`: the read fails, and no older copy is shown as current. This equals today's rule for
`[v2, v1]` (same calls in the same order; the existing tests keep their expectations). The result stays oldest first
(unlock reverses it).

`getVault`, `locatorsOf` default to the newest registry and take a version; `vaultOf` uses the newest.

Dates (`chain/history.ts`) take the same list and query each registry that has listed vaults.

### D3. Writes: newest registry only

`writes.ts` and `policy.ts` target `WRITE_REGISTRY`. `isReadOnly`, the vault list grouping, the single-vault auto-open
and the nonce pin compare with the newest version instead of the literal `'v2'`. A vault in any older registry is
read-only (as v1 is today).

### D4. `/release.json` and the release manifest

`config.registries: [{version, address, deployBlock, abiHash}]`, newest first, from the shared parser, next to the
unchanged `config.registry` (v1 or null) and `config.registryV2`. The recovery tool's release parser already accepts all
three and requires duplicates to agree. The legacy fields are kept for one release and can be removed by a later change
once the smoke test and the minimum supported recovery tool read `registries`.

### D5. Pages

- Architecture page: one `<tr>` per registry, newest first, row header `VaultRegistry vN`, value `ADDRESS` for the newest
  and `ADDRESS (read-only)` for older ones, generated from the parsed list (escaped: versions and addresses are already
  strictly validated). The "Deploy block" row is the newest registry's.
- Vault-location panel: the vault's registry address, and the note `Version N`, plus ` (read-only)` when it is not the
  newest. `Services.registries` becomes the list (`{version, address}`), newest first.

### D6. Smoke test

`smoke.sh` keeps every existing check and adds, from the live `/release.json`:
- `config.registries` is a non-empty list with unique `v<N>` versions, strictly newest first, and `0x` + 40-hex
  addresses;
- its v2 entry equals `REGISTRY_V2_ADDRESS`, its v1 entry equals `REGISTRY_ADDRESS` (absent when that is empty);
- every listed address is shown on `/architecture`;
- optional `REGISTRIES="v1=0x… v2=0x… v3=0x…"`: when set, the list equals it exactly (malformed → exit 2).

The deploy workflows' smoke steps are digest-pinned (`privileged-run-steps.json`, security review required), so this
change does not wire `REGISTRIES`; it is a follow-up task for when v3 ships. Until then a v3 is still checked for shape,
order and presence on `/architecture`.

### D7. Bundle

The runtime list replaces two config objects and two code paths with one loop, so the initial `/app` chunk must not
grow. The baseline in `verify-build.mjs` is not raised.

## Threat model

| Attacker / failure | Can | Cannot | Mitigation |
|---|---|---|---|
| A caller plants a newer vault's id in an older registry (v1 caller-chosen ids) with a stale, decryptable copy | Make the stale copy resolvable under the victim's locator | Have it shown: any newer registry that holds the id wins | D2 checks every older id against every newer registry |
| A flaky or lying RPC for a newer registry | Make the newer registry's answer fail or contradict itself | Get an older copy shown as current | D2: `RegistryUnconfirmedError`, never a fallback |
| A record entry with an unknown ABI (v3 with a new interface) | Mis-decode reads | Ship: the build fails | D1: unknown `abiHash` refused, never guessed |
| A malformed or conflicting record (duplicate version, duplicate address) | Point two versions at one contract | Ship | D1 refuses |
| A stale live build missing a registry | Serve a build that ignores v3 | Pass the smoke test once `REGISTRIES` is wired | D6 (follow-up wiring) |

No key material or secret is involved: the change handles only public addresses, blocks and ABI hashes.

## Risks / Trade-offs

- A newer registry that is down makes every unlock fail (as v2 does today). Accepted: never show a superseded copy.
- One extra `getVaults` per newer registry for ids found in an older one (batched; zero when no older registry lists
  anything).
- The "older test vault" wording would be shown for v2 vaults once v3 exists. Copy for that is out of scope (product).

## Assumptions

- **A1:** the record key for v3+ is not decided (7.1). The parser accepts both proposed shapes, like the recovery tool.
- **A2:** v1 on OP Mainnet stays refused (existing rule); no other per-version chain rule is added.
- **A3: an ABI match is not a behaviour match.** An `abiHash` equal to `VaultRegistryV2.json` proves only that v3's
  *interface* is v2's byte for byte, so the app can encode and decode its calls. It says nothing about the semantics
  (caps, events, who may write). A v3 whose behaviour differs (for example, a different `getVaults` limit or a new
  write rule) must ship with a new ABI file, so its hash matches nothing and the build fails until the app is
  updated. Reviewing a new registry's semantics stays a contracts and security-review task, never inferred from the
  hash.

## Implementation notes (frontend, 2026-10-08)

- `vite-plugins/registries.mjs` (+ `.d.mts`) is the one parser; `deployment.ts`, `release-manifest.mjs`, the test
  config fixture and both freshness tests (build and E2E) use it. `loadDeployment` returns `registries` (newest first)
  instead of `v1`/`v2`.
- Runtime: `config.registries`; `src/config` exports `WRITE_REGISTRY` and `isOlder(version)`. `RegistryVersion` is
  `` `v${number}` ``. `createRegistryReader(transport, registries = config.registries)`; `getVault`/`locatorsOf` default
  to the newest. `RegistryUnconfirmedError`'s message is the unconfirmed registry's version (the UI maps the class).
- `VaultLocation` takes `registries` and the vault's `registry` version and derives the address and "(read-only)" in
  its lazy chunk.
- **Bundle:** `VaultsMenu` must not value-import `ui/operations` (it made Rollup split the initial `/app` graph into
  shared chunks: +6.7 KB gzip). `isOlder` lives in `src/config`, which both graphs already share. Measured `/app`
  initial JS gzip: `main` (ec3cc62) 202,980 B (e2e) / 202,982 B (production); this change 203,030 B / 203,040 B
  (+50 B / +58 B: the extra newer-registry walk). The baseline is unchanged (875 B headroom).
- The `virtual:cryoshield-config` module type resolves to `any` under `tsc` (pre-existing, also on `main`), so new code
  annotates `RegistryConfig` explicitly.
