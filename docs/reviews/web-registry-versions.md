# Security review: `web-registry-versions` (task 7.1)

- **Reviewed by:** a maintainer acting as security reviewer, on 2026-10-08, at the founder's request. This record re-reads the merged code and collects the ECC review on PR #54 with each finding's current status. It is a read-only review: no code in `apps/web` was changed for it.
- **Change:** `openspec/changes/web-registry-versions` (proposal; design D1–D7, A1–A3 and the threat model; tasks).
- **Code:** `apps/web` on `main` at `226e13b`. Merged in PR #54 (`37f98fd`); the copy and paging follow-ups landed through `web-review-followups` (PR #56).
- **Inputs:**
  - the ECC review on PR #54 at `eacb65e`: 0 blocking, 9 advisory (code, security, TypeScript and React reviewers);
  - the merged code: `vite-plugins/registries.mjs`, `vite-plugins/deployment.ts`, `deploy/release-manifest.mjs`, `src/config/index.ts`, `src/chain/registry.ts`, `src/chain/history.ts`, `src/account/writes.ts`, `src/account/policy.ts`, `src/ui/operations.ts`, `src/ui/VaultsMenu.tsx`, `src/ui/UnlockFlow.tsx`, and `.github/scripts/deploy/smoke.sh`;
  - the tests: `test/build/registries.test.ts`, `test/chain/registry.test.ts`, `test/chain/history.test.ts`, `test/ui/create-v3.test.tsx`, `test/ui/vaults-v3.test.tsx`, and `.github/scripts/test/deploy-scripts.test.mjs`.
- **Task path:** task 7.1 named `apps/web/docs/security-review-registry-versions.md`. The record lives here instead, next to `docs/reviews/recover-registry-versions.md`, and the task text now points here.

## Scope

| Decision | What was checked | Code |
|---|---|---|
| D1: unknown ABIs refused | One parser for the build, the release manifest and both freshness tests. v1 and v2 have fixed kinds, and their `abiHash` must equal the exported ABI. For N ≥ 3 the kind is only the one whose ABI hash equals the entry's `abiHash`. A missing or unknown hash fails the build. Duplicate versions must agree. Two versions can't share an address. The newest must be kind 2. Near-miss keys fail. | `registries.mjs`, `deployment.ts` (`assertAbiCovers`, no v1 on OP Mainnet) |
| D2: newest authoritative, no fallback | Each id an older registry lists is checked against every newer registry, newest first, under any locator. Any error or contradiction from a registry that has an older one is `RegistryUnconfirmedError`, and the read fails. Kind-2 `getVaults` batches are row-count checked. Paging is bounded (`MAX_LOCATOR`, short and long pages re-read once, then refused). | `chain/registry.ts` (`candidatesFor`, `records`, `confirm`, `resolve`) |
| D3: writes to the newest only | Every write, the preflight, `vaultIdFor`, the sponsor allowlist, `saveNewVault`'s registry tag and the mirror key use `WRITE_REGISTRY`. `isReadOnly` and the vault list use `isOlder`. | `account/writes.ts`, `account/policy.ts`, `ui/operations.ts`, `ui/App.tsx`, `ui/VaultsMenu.tsx`, `ui/UnlockFlow.tsx` |
| D6: smoke test | `config.registries` is a non-empty list of `v<N>` + address entries, strictly newest first. v1 and v2 equal the record. Every address is on `/architecture`. An optional `REGISTRIES` must match exactly (malformed exits 2). | `smoke.sh` `check_registries` |

## Threat model check

| Threat (design table) | Verdict |
|---|---|
| A stale, decryptable copy of a newer vault's id planted in an older registry | **Holds.** `candidatesFor` asks every newer registry about each older id, through `confirm`. The first registry that holds the id wins, whatever locator lists it there. Tests: "one id in all three registries", "a v1 id and a v2 id held by v3 under ANOTHER locator", "a v1 id held by v2 (not v3)". |
| A flaky or self-contradicting RPC answer for a newer registry | **Holds.** Errors, a listed id with no valid kind-2 record, a row-count mismatch, an empty or short page and a `locatorLength` above 100,000 all fail the read. Tests: "v3 unconfirmed (RPC error)", "v3 fails only when asked about an older id", "a malformed record in a newer registry", "a getVaults row-count mismatch". |
| A consistently **lying** RPC for a newer registry | **Residual, accepted (R1 below).** The design row says such an RPC "cannot get an older copy shown as current". That is true for an RPC that fails or contradicts itself, not for one that lies consistently. |
| A record entry with an unknown ABI | **Holds.** The build fails with "update the app". A missing `abiHash` counts as unknown. Tests: "refuses an unknown version", "a v3 whose abiHash is v1's … the newest registry must have the write interface". |
| A malformed or conflicting record | **Holds.** Duplicate version, shared address, bad key, non-object entry, bad address or block, and no registry are all refused (`registries.test.ts`). The deployment-record checker now also rejects a malformed `contracts.vaultRegistries` (see "Related" below). |
| A stale live build that misses a registry | **Partly, by design.** Shape, order and presence on `/architecture` are checked today. The exact list is only compared once `REGISTRIES` is wired: task 6.1, a release gate before any record lists a v3. |

No key material is involved: the change handles only public addresses, blocks and ABI hashes.

## Findings

Status: **Fixed** (where) · **Accepted** (with the rationale) · **Open** (tracked in task 6.3; none blocks).

### ECC review on PR #54 at `eacb65e` (0 blocking, 9 advisory), re-checked on `226e13b`

| # | Sev | Finding | Status |
|---|---|---|---|
| P1 | MED | On a single-registry chain (OP Mainnet: `[v2]`), and for the oldest registry of any list, the registry's own reads are not wrapped in `RegistryUnconfirmedError`. A raw RPC error then shows the generic network message instead of "couldn't confirm". | **Open** (UX only). The read still throws and fails closed, so no copy is shown. `guard` in `candidatesFor` still wraps only when `i < registries.length - 1`. `RegistryIncompleteError` is thrown for the oldest registry too ("also for the oldest registry" test). Fix: always wrap; add a `[v2]`-only test with a failing RPC. |
| P2 | MED | The read-only copy called every older-registry vault a "test" vault | **Fixed** in `web-review-followups` 1.6: "Read-only vault (older format)" (`strings-vaults.ts`, `strings.ts`; `test/ui/vaults-v3.test.tsx`). |
| P3 | MED | Kind-1 `getVault` calls run in one unbounded `Promise.all` when a kind-1 registry is the newer one | **Open, not reachable.** It needs a kind-1 registry between two others, that is a future registry shipped with the v1 ABI below a newer kind-2 one. The newest must be kind 2, and today's lists are `[v2, v1]` and `[v2]`. Fix before such a record exists: chunk by `GET_VAULTS_MAX`. |
| P4 | LOW | The near-miss key guard is case-sensitive (`VaultRegistryV3` is skipped silently) | **Open.** It is mitigated for committed public records: `check-deployments.sh` rejects any unknown key under `contracts` (CI, offline). |
| P5 | LOW | A record with v1 and v3 but no v2 builds, then fails in the release manifest and smoke test | **Open.** It fails closed before a release. |
| P6 | LOW | Without `REGISTRIES`, the smoke test never compares the newest (write) registry address | **Open = task 6.1** (release gate before any v3). |
| P7 | LOW | `registries[0]!` in a default parameter: an empty list throws a `TypeError` | **Open, not reachable in production** (the parser refuses an empty list; the config type is a non-empty tuple). |
| P8 | LOW | `isOlder(registry: string)` and `VaultLocation`'s identity-based read-only check are loosely typed | **Open.** |
| P9 | LOW | Stale comment at `operations.ts:82` ("only VaultRegistry v2 vaults can be edited") | **Open.** The code is right (`isOlder`); only the comment is stale. |

### This review

| # | Sev | Finding | Status |
|---|---|---|---|
| R1 | MED | A consistently lying RPC can answer "not here" (owner zero) for an id a newer registry holds, and serve an older registry's genuine, older copy as current: a rollback. The design's threat-model row overstates D2 on this point. | **Accepted, pre-existing.** D2 does not widen it. The app reads through one RPC, and the same RPC can already return an older blob from the newest registry directly, because `eth_call` results are not proven. Nothing can forge a blob that decrypts (AES-GCM and the vaultId binding). Writes are protected by the nonce pin and the STALE re-read (`docs/system-design.md`, "Writes start from the current blob"), and the recovery tool's RPC quorum is the way out. The on-chain fix is the `expectedVersion` compare-and-swap recommended for v3 (`web-review-followups` 4.1). Recommendation: when 6.1 is done, reword the design row as "fails or contradicts itself", and name the single-RPC rollback as a residual. |
| R2 | LOW | The paymaster provider's allowlist (`apps/web/docs/paymaster-policy.md`) names VaultRegistry v2. The client-side policy follows `WRITE_REGISTRY`, but the provider-side one does not. | **Open, v3 release step.** When v3 ships, the provider allowlist must move to v3 in the same release, and v2 must be removed from it. Otherwise new writes are refused (availability), or v2 calls stay sponsored (cost). Tracked with 6.1 in task 6.3. |
| R3 | INFO | An ABI-hash match is not a behaviour match (design A3) | **Accepted as designed.** It is now also enforced by tooling: `check-deployments.sh` fails on-chain on any `contracts.vaultRegistries` entry until the script is extended with that registry's build. A v3 can't pass the deployment-record verifier without a contracts change and its review. |

### Related: deployment-record key decided (`recover-registry-versions` 7.1)

On the same branch, `contracts.vaultRegistries.v<N>` is now the decided record key for v3 and later (`contracts/deployments/README.md`). `check-deployments.sh` accepts and validates that shape offline: keys `v3`…`v999`, exactly four fields, an `abiHash` of a committed registry ABI, the newest with the v2 ABI, distinct addresses. It rejects `contracts.vaultRegistryV<N>` as an unknown key, and refuses any v3 entry on-chain. That matches D1's refusals, so a record the checker passes is one the web build accepts.

## Task 7.1 checklist

- **D2: newest authoritative, no fallback on an unconfirmed newer registry:** pass. Every older id is checked against every newer registry under `confirm`, and no path catches `RegistryUnconfirmedError` to show an older copy (`UnlockFlow.tsx` maps it to `S.unlock.unconfirmed`). The 3-registry tests in `test/chain/registry.test.ts` cover the cases in the threat table. The v1 + v2 tests keep their expectations. Residual: R1 (accepted).
- **D1: unknown ABIs refused:** pass. One parser serves the build, the manifest and the freshness tests; unknown and missing `abiHash` fail; the newest must be kind 2. The app's ABI fragments are checked against each exported ABI it uses. v1 is refused on OP Mainnet.
- **D3 (checked with D2):** pass. No `'v1'`/`'v2'` literal decides a write or read-only state. The sponsor allowlist targets `WRITE_REGISTRY`. A v3 vault is created and tagged v3 (`create-v3.test.tsx`).
- **D6: smoke test:** pass for what it covers. The exact-list comparison is the 6.1 release gate.

## Verdict

**APPROVE. No open CRITICAL or HIGH.** The open items are MEDIUM or below:
- P1 (UX, fails closed);
- P3 (not reachable today);
- R1 (accepted, pre-existing);
- LOW tidy-ups;
- the v3 release steps (6.1, R2).

Tasks 6.1 and 6.2 stay open: both are gated on a v3 registry, which doesn't exist yet. Task 6.3 tracks the open MEDIUM and LOW items above.
