# Proposal: Harden recovery-tool network trust

## Why

The internal security audit (`docs/reviews/security-audit-2026-10.md`) proved two MEDIUM issues in the recovery tool. They break its central promise: it should show the *current* vault even when some public servers lie.
- **REC-M1:** one lying RPC out of three makes the tool show an older genuine blob.
  - With a self-reported version of 2^32−1 and a truncated `getLogs` history, the liar wins the version ranking.
  - When the two honest RPCs fail transiently, the liar's single answer is labelled `current`.
- **REC-M2:** one hostile Arweave GraphQL server can hide the genuine mirror. The tool merged records by tx id and kept the record with the smallest claimed size, so a claimed size of 0, or a relabelled `CryoShield-Vault-Id`, wins. Separately, 50 newer tagged transactions can bury the genuine one beyond the single `first: 50` page.

There are also two LOW findings:
- **REC-L1:** a hostile `eth_blockNumber` makes one RPC page `eth_getLogs` about 2,000 times.
- **REC-L2:** `createVault` accepts identical PRF outputs, so a "backup key" can be a copy of the first one.

Plus one INFO: a non-finite `--timeout` is accepted.

## What Changes

- **On-chain state quorum.** A chain copy is `current` only if at least `min(2, distinct configured RPCs)` RPCs return that exact blob for the vault ID, and no RPC returns a different one (or the agreed event history confirms it). Duplicate RPC URLs are counted once.
- **No ranking by self-reported versions.** Unverified copies are ranked by how many independent sources returned them (majority first), never by an RPC-reported or tag-reported version. If two different copies of the same vault decrypt with equal support and neither is verified, the user must choose explicitly after a clear warning. A non-interactive run refuses, with a new exit code.
- **Arweave per-server records.** Each GraphQL server's record for a tx is kept as a separate candidate; one server's metadata never overrides another's. Claimed sizes are ignored (downloads stay hard-capped at 1024 bytes). Search pages with cursors within a page and time budget, newest first, plus the oldest page, so newer spam cannot bury the original.
- **Event-history bounds.** The history lookup has one overall deadline. `latest` is cross-checked across RPCs, so an implausible head is refused. A history that can't fit the page budget fails at once.
- **REC-L2 (vault-crypto).** `createVault` rejects two credentials with equal PRF outputs (equal locators), with `INVALID_ARGUMENT`. This adds a new vector and mirrors the check in the Python reference generator and the recovery tool's test writer.
- **INFO.** `--timeout` must be finite and in (0, 300].

**Out of scope:** registry v2 and an on-chain paymaster (AA-*); web-app findings (WEB-*); L1 anchoring; any change to the vault format or the contract.

**Runtime dependencies:** none added. The tool still talks only to public RPCs and Arweave gateways; there is no CryoShield-operated backend.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `vault-recovery`: adds requirements for state quorum, version-independent ranking, explicit choice on unresolvable ties, per-server Arweave records with paging, and bounded history. The capability is still defined by the in-flight `add-desktop-recovery-tool` change, so these are ADDED requirements with new names. That change's "Disagreeing chain sources" text is amended to defer to them.
- `vault-crypto`: adds "Distinct key material at creation" (REC-L2).

## Impact

- **`tools/recover`:** `chain.py`, `candidates.py`, `recover.py`, `arweave.py`, `cli.py`, `ui.py`, `errors.py`; new regression tests from the audit proofs.
- **`packages/vault-crypto`:**
  - `src/vault.ts` (createVault check);
  - `scripts/gen-vectors.py` (mirrored check and a new `duplicate-prf` create case);
  - `test-vectors/v1.json` (regenerated; one case added, no existing bytes change);
  - `docs/spec/vault-format-v1.md` (create validation).
- **Behavioural change:** a new exit code, 12 (`AMBIGUOUS`), for an unresolvable tie in non-interactive mode.
